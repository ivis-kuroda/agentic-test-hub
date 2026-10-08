"""
Running a scenario: its preconditions once, then every step in order,
threading each step's `produces` into later steps. Mirrors
`packages/runner/src/run-scenario.ts` — a scenario's steps declare their
actions directly (no baseline/overrides to resolve), so unlike `run_case.py`
this module needs no generation-time-resolved input at all.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field, replace
from typing import Any

from .expectation import check_expectation
from .paths import get_result_at_path
from .policy import DEFAULT_VERDICT_POLICY, VerdictPolicy
from .registry import ExecutorRegistry
from .run_case import (
    ExpectationOutcome,
    RunOptions,
    collect_before,
    collect_evidence,
    compose_verdict,
    evidence_index_of,
    with_browser_session,
    worst_verdict,
)
from .run_scope import with_evidence_target, with_run_scope
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


def _extract(
    action: ExecutionResult, name: str, production: str | dict[str, str]
) -> tuple[bool, Any, str | None]:
    """Evaluates one `produces` entry as `(present, value, failure)`. A dotted
    path that is absent just produces nothing. `{from, pattern}` takes group 1
    of the pattern from the path's value and must succeed: an absent path, a
    non-scalar value, a pattern that does not match or has no group 1 yields
    a `failure` reason, which fails the step."""
    if isinstance(production, str):
        present, value = get_result_at_path(action, production)
        return present, value, None
    present, value = get_result_at_path(action, production["from"])
    if not present:
        return False, None, f'produces "{name}": "{production["from"]}" is absent from the result'
    if not isinstance(value, (str, int, float)) or isinstance(value, bool):
        return False, None, f'produces "{name}": "{production["from"]}" is not a scalar value'
    match = re.search(production["pattern"], str(value))
    if match is None or match.lastindex is None or match.group(1) is None:
        return (
            False,
            None,
            f'produces "{name}": pattern /{production["pattern"]}/ did not match "{value}"',
        )
    return True, match.group(1), None


@dataclass(frozen=True)
class StepRunResult:
    """What running one step established."""

    step_id: str
    expectations: list[ExpectationOutcome]
    verdict: Verdict
    produced: dict[str, Any] = field(default_factory=dict)
    skipped: dict[str, str] | None = None
    action: ExecutionResult | None = None
    error: str | None = None
    """Why the step failed outside its expectations: the message of what a
    cleanup step raised, or the reason a `{from, pattern}` production did not
    yield a value (the verdict is then `fail`)."""


def run_step(
    step: dict[str, Any], registry: ExecutorRegistry, context: ExecutionContext
) -> StepRunResult:
    """Runs one scenario step: its action (if any), every expectation, then
    extracts whatever it `produces` via a dotted path into its own result.
    A `{from, pattern}` production that yields nothing fails the step."""
    action_ref = step.get("action")
    action = (
        _NO_ACTION
        if action_ref is None
        else registry.run(action_ref["operation"], action_ref.get("params", {}), context)
    )

    expectations: list[ExpectationOutcome] = []
    for expectation in step.get("expect", []):
        if expectation["kind"] == "operation_result":
            subject = registry.run(expectation["operation"], expectation.get("params", {}), context)
        else:
            subject = action
        expectations.append(
            ExpectationOutcome(expectation, check_expectation(expectation, subject))
        )

    produced: dict[str, Any] = {}
    failures: list[str] = []
    for name, production in step.get("produces", {}).items():
        present, value, failure = _extract(action, name, production)
        if failure is not None:
            failures.append(failure)
        elif present:
            produced[name] = value

    return StepRunResult(
        step_id=step["id"],
        action=action,
        expectations=expectations,
        verdict="fail" if failures else compose_verdict(expectations),
        produced=produced,
        error="; ".join(failures) if failures else None,
    )


@dataclass(frozen=True)
class ScenarioRunResult:
    """What running one scenario established."""

    scenario_id: str
    preparation: PreparationReport
    steps: list[StepRunResult]
    verdict: Verdict
    evidence: VerdictResult | None = None
    cleanup: list[StepRunResult] = field(default_factory=list)
    """The cleanup steps, in order; empty when there were none or preparation failed."""
    evidence_index: str | None = None
    """Path of this run's `index.json` when evidence was saved, else `None`."""


def run_scenario(
    scenario: dict[str, Any],
    registry: ExecutorRegistry,
    context: ExecutionContext,
    options: RunOptions | None = None,
) -> ScenarioRunResult:
    """Runs a scenario (see `_run_scenario`), then closes any browser session
    the registry's executors opened — also when a step raised."""
    try:
        return _run_scenario(scenario, registry, context, options)
    finally:
        registry.close_all()


def _run_scenario(
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

    The scenario's `cleanup` steps always run afterwards, after evidence
    collection, even when a step failed or raised (the exception then
    propagates). A cleanup step that does not complete or breaks an
    expectation downgrades the verdict to at most `inconclusive`. If the
    preconditions are not met nothing ran, so no cleanup runs either. A `run`
    scope (`startedAt`, `id`) is added to `context` unless it has one.
    """
    options = options or RunOptions()
    context = with_evidence_target(
        with_run_scope(context), options.evidence_dir, scenario["id"], "scenario"
    )
    policy: VerdictPolicy = options.policy or context.manifest.policy or DEFAULT_VERDICT_POLICY

    preparation = prepare_states(scenario.get("preconditions", []), registry, context)
    if not preparation.ready:
        return ScenarioRunResult(
            scenario["id"],
            preparation,
            [],
            verdict="inconclusive",
            evidence_index=evidence_index_of(context),
        )

    step_scope: dict[str, Any] = {}
    step_results: list[StepRunResult] = []
    cleanup_results: list[StepRunResult] = []
    passed_steps: set[str] = set()

    def step_context(directory: str | None = None, step_id: str | None = None) -> ExecutionContext:
        """The context for one step, saving evidence into that step's own
        directory; with no step it is the scenario-level context."""
        scoped = replace(
            context,
            scopes={**context.scopes, "step": {**(context.scopes.get("step") or {}), **step_scope}},
        )
        if directory is None or step_id is None or context.evidence is None:
            return scoped
        return replace(scoped, evidence=context.evidence.for_step(directory, step_id))

    plan = scenario.get("evidence") or _DEFAULT_EVIDENCE_PLAN
    try:
        before = collect_before(plan, registry, step_context())
        for number, step in enumerate(scenario["steps"], start=1):
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

            result = run_step(
                step, registry, step_context(f"{number:02d}-{step['id']}", step["id"])
            )
            step_results.append(result)
            if result.verdict == "pass":
                passed_steps.add(step["id"])
            step_scope.update(result.produced)

        worst_step = worst_verdict([result.verdict for result in step_results])
        should_collect = plan.get("timing") != "on_failure" or worst_step == "fail"

        evidence: VerdictResult | None = None
        if should_collect:
            last_step = scenario["steps"][-1]
            observations = collect_evidence(
                plan, registry, step_context(), with_browser_session(options, registry), before
            )
            waivers = [
                EvidenceWaiver(source=waiver["source"], reason=waiver["reason"])
                for waiver in scenario.get("evidenceWaivers", [])
            ]
            evidence = evaluate_verdict(
                policy, last_step.get("polarity", "nominal"), observations, waivers
            )
    finally:
        # Runs whether the steps passed, failed or raised; a raise then
        # continues to propagate once the leftovers have been dealt with.
        for number, cleanup_step in enumerate(scenario.get("cleanup", []), start=1):
            cleanup_context = step_context(
                f"cleanup-{number:02d}-{cleanup_step['id']}", cleanup_step["id"]
            )
            cleanup_results.append(_run_cleanup_step(cleanup_step, registry, cleanup_context))
            step_scope.update(cleanup_results[-1].produced)

    verdicts: list[Verdict] = [worst_step]
    if evidence is not None:
        verdicts.append(evidence.verdict)
    # Cleanup can only make the verdict less certain, never fail the scenario.
    if any(_cleanup_did_not_succeed(result) for result in cleanup_results):
        verdicts.append("inconclusive")

    return ScenarioRunResult(
        scenario_id=scenario["id"],
        preparation=preparation,
        steps=step_results,
        evidence=evidence,
        verdict=worst_verdict(verdicts),
        cleanup=cleanup_results,
        evidence_index=evidence_index_of(context),
    )


def _cleanup_did_not_succeed(result: StepRunResult) -> bool:
    """Whether a cleanup step failed to complete or broke an expectation."""
    return (
        result.error is not None
        or (result.action is not None and not result.action.ok)
        or result.verdict != "pass"
    )


def _run_cleanup_step(
    step: dict[str, Any], registry: ExecutorRegistry, context: ExecutionContext
) -> StepRunResult:
    """Runs a cleanup step, recording anything it raises so later steps still run."""
    try:
        result = run_step(step, registry, context)
    except Exception as cause:
        return StepRunResult(
            step_id=step["id"], expectations=[], verdict="inconclusive", error=str(cause)
        )
    # run_step's expectations-only verdict ignores an action that did not
    # complete; for cleanup that is exactly the failure worth reporting.
    if result.action is not None and not result.action.ok and result.verdict == "pass":
        return replace(result, verdict="inconclusive")
    return result
