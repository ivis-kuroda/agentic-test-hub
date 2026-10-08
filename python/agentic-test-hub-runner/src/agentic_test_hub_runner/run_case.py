"""
Running one resolved case: preparing its preconditions, running its action,
judging every expectation, collecting evidence and reaching a verdict.
Mirrors `packages/runner/src/run-case.ts`, with one deliberate difference:

**This module never resolves overrides.** `packages/runner`'s own
`runCase(testCase, baseline, ...)` calls `applyOverrides` itself, because
that logic — and the schema it operates on — is TypeScript-only by design
(see the plan this package was built from: "resolution/derivation stays
TS-only ... run once at generation time"). By the time a Python test calls
this module, `ath-generate-test` has already computed the resolved baseline
(`ResolvedBaseline`, inlined by the CLI's Python template as `RESOLVED`) and
the mechanically-derived action params (`deriveActionParams`, inlined as
`ACTION_PARAMS`) — this function's own job is only to *run* that already-
resolved data and judge the result, exactly like the TypeScript version does
after its own `applyOverrides` call returns.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, replace
from typing import Any

from .assertion import AssertionOutcome
from .evidence import (
    COLLECTED_BY_OPERATION,
    BrowserSession,
    ObserveOptions,
    added_lines,
    collector_extension,
    collector_text,
    observe_browser,
    observe_from_result,
    unified_diff,
)
from .evidence_store import Phase
from .expectation import check_expectation
from .policy import DEFAULT_VERDICT_POLICY, VerdictPolicy
from .registry import ExecutorRegistry
from .run_scope import with_evidence_target, with_run_scope
from .state import PreparationReport, prepare_states
from .template import render_deep
from .types import ExecutionContext, ExecutionResult
from .verdict import EvidenceWaiver, Observation, Verdict, VerdictResult, evaluate_verdict

_VERDICT_RANK = {"pass": 0, "inconclusive": 1, "fail": 2}


def worst_verdict(verdicts: list[Verdict]) -> Verdict:
    """The worst of several verdicts, `pass` being the best case."""
    worst: Verdict = "pass"
    for verdict in verdicts:
        if _VERDICT_RANK[verdict] > _VERDICT_RANK[worst]:
            worst = verdict
    return worst


def _verdict_of_outcome(outcome: AssertionOutcome) -> Verdict:
    if outcome.verdict == "violated":
        return "fail"
    if outcome.verdict == "needs_judgement":
        return "inconclusive"
    return "pass"


@dataclass(frozen=True)
class ExpectationOutcome:
    expectation: dict[str, Any]
    outcome: AssertionOutcome


def compose_verdict(
    expectations: list[ExpectationOutcome], evidence: VerdictResult | None = None
) -> Verdict:
    """Composes expectation outcomes and, optionally, an evidence verdict."""
    verdicts = [_verdict_of_outcome(entry.outcome) for entry in expectations]
    if evidence is not None:
        verdicts.append(evidence.verdict)
    return worst_verdict(verdicts)


@dataclass(frozen=True)
class RunOptions:
    """Options shared by `run_case` and `run_step`/`run_scenario`."""

    browser_session: BrowserSession | None = None
    policy: VerdictPolicy | None = None
    observe: ObserveOptions | None = None
    evidence_dir: str | os.PathLike[str] | None = None
    """Where to save evidence files; falls back to the `ATH_EVIDENCE_DIR`
    environment variable, and `None` with the variable unset saves nothing."""


@dataclass(frozen=True)
class CaseRunResult:
    """What running one case established."""

    case_id: str
    preparation: PreparationReport
    action: ExecutionResult | None
    expectations: list[ExpectationOutcome]
    observations: list[Observation]
    evidence: VerdictResult
    verdict: Verdict
    evidence_index: str | None = None
    """Path of this run's `index.json` when evidence was saved, else `None`."""


def wants_before(plan: dict[str, Any], context: ExecutionContext) -> bool:
    """
    Whether collectors are read before the action as well as after.

    Always for `timing: before_and_after`. Also whenever evidence is being
    saved (unless the plan says `on_failure`, which cannot know before the
    action whether anything will fail), because the owner wants every saved
    run to show the data and logs before and after. `before`, `after` and
    `each_step` therefore all behave as before-and-after when saving, and as
    after-only otherwise; `each_step` is not implemented in Python.
    """
    timing = plan.get("timing", "after")
    if timing == "before_and_after":
        return True
    return context.evidence is not None and timing != "on_failure"


def _collector_params(call: dict[str, Any], context: ExecutionContext) -> dict[str, Any]:
    # A collector's params may reference the run's own scopes (for example
    # `{{run.startedAt}}` to read only what this run logged).
    return render_deep(call.get("params", {}), context.scopes)


def _save_output(
    context: ExecutionContext, phase: Phase, source: str, name: str, result: ExecutionResult
) -> str:
    text = collector_text(result)
    if context.evidence is not None:
        context.evidence.save(
            phase=phase,
            source=source,
            name=name,
            data=text,
            ext=collector_extension(text),
        )
    return text


def collect_before(
    plan: dict[str, Any], registry: ExecutorRegistry, context: ExecutionContext
) -> dict[str, ExecutionResult]:
    """
    Reads the collector channels before the action, saving each output as
    `before-...` evidence. A collector that cannot be read is skipped with a
    warning in the evidence index: a missing "before" must not break a run
    (the verdict falls back to judging the whole "after" output).

    @returns: The outputs by source, for `collect_evidence` to diff against.
    """
    results: dict[str, ExecutionResult] = {}
    if not wants_before(plan, context):
        return results
    for source in COLLECTED_BY_OPERATION:
        call = context.manifest.evidence.get(source)
        if source not in plan.get("sources", []) or call is None:
            continue
        try:
            result = registry.run(call["operation"], _collector_params(call, context), context)
        except Exception as cause:
            if context.evidence is not None:
                context.evidence.store.warn(
                    f"could not collect {source} before the action: {cause}"
                )
            continue
        results[source] = result
        _save_output(context, "before", source, call["operation"], result)
    return results


def collect_evidence(
    plan: dict[str, Any],
    registry: ExecutorRegistry,
    context: ExecutionContext,
    options: RunOptions,
    before: dict[str, ExecutionResult] | None = None,
) -> list[Observation]:
    """
    Collects the evidence a plan calls for.

    `db_records`/`app_log`/`db_log` are gathered by running their declared
    collector operation; `browser_console`/`browser_network` come from a
    live session (never opened or closed here); `screenshot` is never
    gathered here, same limitation as the TypeScript original.

    @param before: Outputs from `collect_before`. When present, a unified
        diff of before and after is saved next to them, and with
        `timing: before_and_after` the `app_log` verdict reads only the lines
        added since `before`.
    """
    before = before or {}
    observations: list[Observation] = []
    if options.browser_session is not None:
        observations.extend(observe_browser(options.browser_session, options.observe))
    for source in COLLECTED_BY_OPERATION:
        if source not in plan.get("sources", []):
            continue
        call = context.manifest.evidence.get(source)
        if call is None:
            continue
        result = registry.run(call["operation"], _collector_params(call, context), context)
        judged = result
        before_result = before.get(source)
        if (
            source == "app_log"
            and plan.get("timing") == "before_and_after"
            and before_result is not None
            and before_result.ok
            and result.ok
        ):
            delta = added_lines(collector_text(before_result), collector_text(result))
            judged = replace(result, stdout=delta, stderr=None)
        observations.append(observe_from_result(source, judged, options.observe))
        after_text = _save_output(context, "after", source, call["operation"], result)
        if before_result is not None and context.evidence is not None:
            context.evidence.save(
                phase="after",
                source=source,
                name=call["operation"],
                data=unified_diff(collector_text(before_result), after_text),
                ext="diff",
                role="diff",
            )
    return observations


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


def run_case(
    test_case: dict[str, Any],
    resolved: dict[str, Any],
    action_params: dict[str, Any],
    registry: ExecutorRegistry,
    context: ExecutionContext,
    options: RunOptions | None = None,
) -> CaseRunResult:
    """
    Runs one already-resolved case: prepares its preconditions, runs its
    action with `action_params`, judges every expectation, collects
    evidence and reaches an overall verdict.

    @param test_case: The case's own data (`id`, `expect`, `polarity`,
        `evidence`, `evidenceWaivers`) — its `overrides`/`baseline` fields,
        if present, are not read here; they were already applied when
        `resolved`/`action_params` were computed at generation time.
    @param resolved: The baseline with overrides already applied
        (`preconditions`, `action`, `context`, `config`) — `ResolvedBaseline`
        inlined by the CLI.
    @param action_params: The mechanically-derived params for `resolved`'s
        action, from `deriveActionParams` at generation time.
    """
    options = options or RunOptions()
    context = with_evidence_target(
        with_run_scope(context), options.evidence_dir, test_case["id"], "case"
    )
    policy = options.policy or context.manifest.policy or DEFAULT_VERDICT_POLICY

    preparation = prepare_states(resolved.get("preconditions", []), registry, context)
    if not preparation.ready:
        return CaseRunResult(
            case_id=test_case["id"],
            preparation=preparation,
            action=None,
            expectations=[],
            observations=[],
            evidence=evaluate_verdict(policy, test_case.get("polarity", "nominal"), []),
            verdict="inconclusive",
            evidence_index=evidence_index_of(context),
        )

    action_ref = resolved.get("action")
    if action_ref is None:
        raise ValueError(f"case {test_case['id']}'s baseline declares no action to run")

    plan = test_case.get("evidence") or _DEFAULT_EVIDENCE_PLAN
    before = collect_before(plan, registry, context)

    action = registry.run(action_ref["operation"], action_params, context)

    expectations: list[ExpectationOutcome] = []
    for expectation in test_case["expect"]:
        if expectation["kind"] == "operation_result":
            subject = registry.run(expectation["operation"], expectation.get("params", {}), context)
        else:
            subject = action
        expectations.append(
            ExpectationOutcome(expectation, check_expectation(expectation, subject))
        )

    observations = collect_evidence(plan, registry, context, options, before)
    waivers = [
        EvidenceWaiver(source=waiver["source"], reason=waiver["reason"])
        for waiver in test_case.get("evidenceWaivers", [])
    ]
    evidence = evaluate_verdict(policy, test_case.get("polarity", "nominal"), observations, waivers)

    return CaseRunResult(
        case_id=test_case["id"],
        preparation=preparation,
        action=action,
        expectations=expectations,
        observations=observations,
        evidence=evidence,
        verdict=compose_verdict(expectations, evidence),
        evidence_index=evidence_index_of(context),
    )


def evidence_index_of(context: ExecutionContext) -> str | None:
    """Path of the run's `index.json`, or `None` when evidence is not being saved."""
    return str(context.evidence.store.index_path) if context.evidence is not None else None
