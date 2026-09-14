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

from dataclasses import dataclass
from typing import Any

from .assertion import AssertionOutcome
from .evidence import (
    COLLECTED_BY_OPERATION,
    BrowserSession,
    ObserveOptions,
    observe_browser,
    observe_from_result,
)
from .expectation import check_expectation
from .policy import DEFAULT_VERDICT_POLICY, VerdictPolicy
from .registry import ExecutorRegistry
from .state import PreparationReport, prepare_states
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


def collect_evidence(
    plan: dict[str, Any], registry: ExecutorRegistry, context: ExecutionContext, options: RunOptions
) -> list[Observation]:
    """
    Collects the evidence a plan calls for.

    `db_records`/`app_log`/`db_log` are gathered by running their declared
    collector operation; `browser_console`/`browser_network` come from a
    live session (never opened or closed here); `screenshot` is never
    gathered here, same limitation as the TypeScript original.
    """
    observations: list[Observation] = []
    if options.browser_session is not None:
        observations.extend(observe_browser(options.browser_session, options.observe))
    for source in COLLECTED_BY_OPERATION:
        if source not in plan.get("sources", []):
            continue
        call = context.manifest.evidence.get(source)
        if call is None:
            continue
        result = registry.run(call["operation"], call.get("params", {}), context)
        observations.append(observe_from_result(source, result, options.observe))
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
        )

    action_ref = resolved.get("action")
    if action_ref is None:
        raise ValueError(f"case {test_case['id']}'s baseline declares no action to run")

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

    plan = test_case.get("evidence") or _DEFAULT_EVIDENCE_PLAN
    observations = collect_evidence(plan, registry, context, options)
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
    )
