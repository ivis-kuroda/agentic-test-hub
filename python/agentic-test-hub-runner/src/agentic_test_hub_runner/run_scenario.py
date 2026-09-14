"""
Running a scenario: its preconditions once, then every step in order,
threading each step's `produces` into later steps. Mirrors
`packages/runner/src/run-scenario.ts` — a scenario's steps declare their
actions directly (no baseline/overrides to resolve), so unlike `run_case.py`
this module needs no generation-time-resolved input at all.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Any

from .expectation import check_expectation
from .policy import DEFAULT_VERDICT_POLICY, VerdictPolicy
from .registry import ExecutorRegistry
from .run_case import (
    ExpectationOutcome,
    RunOptions,
    collect_evidence,
    compose_verdict,
    worst_verdict,
)
from .state import PreparationReport, prepare_states
from .types import ExecutionContext, ExecutionResult
from .verdict import EvidenceWaiver, Verdict, VerdictResult, evaluate_verdict

_NO_ACTION = ExecutionResult(operation="(none)", ok=True, duration_ms=0)

_DEFAULT_EVIDENCE_PLAN = {
    "sources": [
        "screenshot",
        "browser_console",
        "browser_network",
        "db_records",
        "app_log",
        "db_log",
    ],
    "timing": "after",
}


def _get_at_path(action: ExecutionResult, path: str) -> tuple[bool, Any]:
    """Reads a dotted path out of an `ExecutionResult` (e.g. `body.id`)."""
    first, *rest = path.split(".")
    if not hasattr(action, first):
        return False, None
    current: Any = getattr(action, first)
    for segment in rest:
        if not isinstance(current, dict) or segment not in current:
            return False, None
        current = current[segment]
    return True, current


@dataclass(frozen=True)
class StepRunResult:
    """What running one step established."""

    step_id: str
    expectations: list[ExpectationOutcome]
    verdict: Verdict
    produced: dict[str, Any] = field(default_factory=dict)
    skipped: dict[str, str] | None = None
    action: ExecutionResult | None = None


def run_step(
    step: dict[str, Any], registry: ExecutorRegistry, context: ExecutionContext
) -> StepRunResult:
    """Runs one scenario step: its action (if any), every expectation, then
    extracts whatever it `produces` via a dotted path into its own result."""
    action_ref = step.get("action")
    action = (
        _NO_ACTION
        if action_ref is None
        else registry.run(action_ref["operation"], action_ref.get("params", {}), context)
    )

    expectations: list[ExpectationOutcome] = []
    for expectation in step["expect"]:
        if expectation["kind"] == "operation_result":
            subject = registry.run(expectation["operation"], expectation.get("params", {}), context)
        else:
            subject = action
        expectations.append(
            ExpectationOutcome(expectation, check_expectation(expectation, subject))
        )

    produced: dict[str, Any] = {}
    for name, path in step.get("produces", {}).items():
        present, value = _get_at_path(action, path)
        if present:
            produced[name] = value

    return StepRunResult(
        step_id=step["id"],
        action=action,
        expectations=expectations,
        verdict=compose_verdict(expectations),
        produced=produced,
    )


@dataclass(frozen=True)
class ScenarioRunResult:
    """What running one scenario established."""

    scenario_id: str
    preparation: PreparationReport
    steps: list[StepRunResult]
    verdict: Verdict
    evidence: VerdictResult | None = None


def run_scenario(
    scenario: dict[str, Any],
    registry: ExecutorRegistry,
    context: ExecutionContext,
    options: RunOptions | None = None,
) -> ScenarioRunResult:
    """
    Runs a scenario: its preconditions once, then every step in order,
    threading each step's `produces` into the next steps' `context.scopes["step"]`
    and skipping (not running) a step whose dependency did not pass.

    Evidence is collected once, after the last step, and judged under the
    last step's polarity — a scenario has no polarity of its own.
    """
    options = options or RunOptions()
    policy: VerdictPolicy = options.policy or context.manifest.policy or DEFAULT_VERDICT_POLICY

    preparation = prepare_states(scenario.get("preconditions", []), registry, context)
    if not preparation.ready:
        return ScenarioRunResult(scenario["id"], preparation, [], verdict="inconclusive")

    step_scope: dict[str, Any] = {}
    step_results: list[StepRunResult] = []
    passed_steps: set[str] = set()

    for step in scenario["steps"]:
        depends_on = step.get("dependsOn", [])
        unmet = next((dep for dep in depends_on if dep not in passed_steps), None)
        if unmet is not None:
            step_results.append(
                StepRunResult(
                    step_id=step["id"],
                    expectations=[],
                    verdict="inconclusive",
                    skipped={"reason": f"depends on step {unmet}, which did not pass"},
                )
            )
            continue

        step_context = replace(
            context,
            scopes={**context.scopes, "step": {**(context.scopes.get("step") or {}), **step_scope}},
        )
        result = run_step(step, registry, step_context)
        step_results.append(result)
        if result.verdict == "pass":
            passed_steps.add(step["id"])
        step_scope.update(result.produced)

    worst_step = worst_verdict([result.verdict for result in step_results])
    plan = scenario.get("evidence") or _DEFAULT_EVIDENCE_PLAN
    should_collect = plan.get("timing") != "on_failure" or worst_step == "fail"

    evidence: VerdictResult | None = None
    if should_collect:
        last_step = scenario["steps"][-1]
        observations = collect_evidence(plan, registry, context, options)
        waivers = [
            EvidenceWaiver(source=waiver["source"], reason=waiver["reason"])
            for waiver in scenario.get("evidenceWaivers", [])
        ]
        evidence = evaluate_verdict(
            policy, last_step.get("polarity", "nominal"), observations, waivers
        )

    verdict = worst_verdict([worst_step] if evidence is None else [worst_step, evidence.verdict])

    return ScenarioRunResult(
        scenario_id=scenario["id"],
        preparation=preparation,
        steps=step_results,
        evidence=evidence,
        verdict=verdict,
    )
