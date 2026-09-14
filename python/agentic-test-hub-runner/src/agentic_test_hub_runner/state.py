"""
Preparing declared states before a case's action runs, mirroring
`packages/runner/src/state.ts`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Literal

from .assertion import check_assertion
from .types import ExecutionContext

if TYPE_CHECKING:
    from .registry import ExecutorRegistry

StateStatus = Literal["already_satisfied", "established", "unsatisfied", "needs_judgement"]

_COST_ORDER = {"low": 0, "medium": 1, "high": 2}


@dataclass(frozen=True)
class StateOutcome:
    """The outcome of preparing one state."""

    state: str
    status: StateStatus
    why: str
    ensured: bool


def ensure_state(
    state: str, provider: dict, registry: ExecutorRegistry, context: ExecutionContext
) -> StateOutcome:
    """Brings a declared state about, checking before and, if setup ran, after."""

    def verify() -> tuple[str, str]:
        verify_call = provider["verify"]
        result = registry.run(verify_call["operation"], verify_call.get("params", {}), context)
        outcome = check_assertion(verify_call["assert"], result)
        return outcome.verdict, outcome.why

    before_verdict, before_why = verify()
    if before_verdict == "satisfied":
        return StateOutcome(state, "already_satisfied", before_why, ensured=False)
    if before_verdict == "needs_judgement":
        return StateOutcome(state, "needs_judgement", before_why, ensured=False)

    ensure_call = provider["ensure"]
    registry.run(ensure_call["operation"], ensure_call.get("params", {}), context)

    after_verdict, after_why = verify()
    if after_verdict == "satisfied":
        return StateOutcome(state, "established", after_why, ensured=True)
    return StateOutcome(
        state,
        "needs_judgement" if after_verdict == "needs_judgement" else "unsatisfied",
        after_why,
        ensured=True,
    )


@dataclass(frozen=True)
class PreparationReport:
    """What preparing a case's preconditions established."""

    outcomes: list[StateOutcome] = field(default_factory=list)
    ready: bool = True


def prepare_states(
    states: list[str], registry: ExecutorRegistry, context: ExecutionContext
) -> PreparationReport:
    """Prepares every state a case requires, cheapest first, stopping at the
    first one that cannot be reached."""
    providers = []
    for state in states:
        provider = context.manifest.states.get(state)
        if provider is None:
            raise ValueError(
                f'state "{state}" is required but plugin "{context.manifest.name}" '
                "does not provide it"
            )
        providers.append((state, provider))

    providers.sort(key=lambda entry: _COST_ORDER[entry[1].get("cost", "medium")])

    outcomes: list[StateOutcome] = []
    for state, provider in providers:
        outcome = ensure_state(state, provider, registry, context)
        outcomes.append(outcome)
        if outcome.status in ("unsatisfied", "needs_judgement"):
            return PreparationReport(outcomes, ready=False)
    return PreparationReport(outcomes, ready=True)
