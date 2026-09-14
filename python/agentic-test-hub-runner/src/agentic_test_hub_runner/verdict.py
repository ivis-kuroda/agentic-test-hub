"""
Judging collected evidence against a policy, mirroring
`packages/core/src/derive/verdict.ts`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from .policy import VerdictPolicy

EvidenceSource = Literal[
    "screenshot", "browser_console", "browser_network", "db_records", "app_log", "db_log"
]
Polarity = Literal["nominal", "error"]
SourceCondition = Literal[
    "clean",
    "expected_error",
    "matches_expectation",
    "success_response",
    "error_response",
    "expected_change",
    "no_residual_change",
    "informational",
]
Verdict = Literal["pass", "fail", "inconclusive"]

_DEFAULT_INSUFFICIENT_ALONE = ["screenshot"]
_DEFAULT_NON_WAIVABLE = ["browser_console", "app_log", "db_records"]


@dataclass(frozen=True)
class Observation:
    """What one evidence channel actually showed."""

    source: EvidenceSource
    collected: bool
    errors: list[str] = field(default_factory=list)
    status: int | None = None
    matched_expectation: bool | None = None
    intended_changes: int | None = None
    residual_changes: int | None = None
    suppressed: int | None = None


@dataclass(frozen=True)
class EvidenceWaiver:
    source: EvidenceSource
    reason: str


@dataclass(frozen=True)
class ConditionFailure:
    """Why a single source did not meet its condition."""

    source: EvidenceSource
    condition: SourceCondition
    why: str


@dataclass(frozen=True)
class VerdictResult:
    """The result of judging a run, with its reasoning intact."""

    verdict: Verdict
    failures: list[ConditionFailure] = field(default_factory=list)
    missing: list[EvidenceSource] = field(default_factory=list)
    decided_by: list[EvidenceSource] = field(default_factory=list)
    waived: list[EvidenceWaiver] = field(default_factory=list)


def _check_condition(condition: SourceCondition, observation: Observation) -> str | None:
    errors = observation.errors
    if condition == "informational":
        return None
    if condition == "clean":
        return None if len(errors) == 0 else f"{len(errors)} error(s) reported"
    if condition == "expected_error":
        if len(errors) == 0:
            return "no error was reported, but one was expected"
        return (
            None
            if observation.matched_expectation is True
            else "an error was reported but it is not the expected one"
        )
    if condition == "matches_expectation":
        return (
            None
            if observation.matched_expectation is True
            else "does not match the stated expectation"
        )
    if condition == "success_response":
        status = observation.status
        if status is None:
            return "no response status was observed"
        return None if 200 <= status < 300 else f"status {status} is not a success"
    if condition == "error_response":
        status = observation.status
        if status is None:
            return "no response status was observed"
        return None if status >= 400 else f"status {status} is not a rejection"
    if condition == "expected_change":
        return (
            None
            if (observation.intended_changes or 0) > 0
            else "the intended data change was not observed"
        )
    if condition == "no_residual_change":
        residual = observation.residual_changes or 0
        return None if residual == 0 else f"{residual} unintended change(s) remain"
    raise ValueError(f"unknown source condition: {condition}")


def evaluate_verdict(
    policy: VerdictPolicy,
    polarity: Polarity,
    observations: list[Observation],
    waivers: list[EvidenceWaiver] | None = None,
) -> VerdictResult:
    """
    Judges collected evidence against a policy.

    Three properties, same as the TypeScript original: missing evidence never
    passes (a binding source not collected yields `inconclusive`); weak
    evidence never passes alone (if every deciding source is one the policy
    marks `insufficientAlone`, the result is `inconclusive`); failures name
    their channel.
    """
    waivers = waivers or []
    rules: dict[EvidenceSource, SourceCondition] = policy.get("rules", {}).get(polarity, {})
    seen = {observation.source: observation for observation in observations}
    waived_by_source = {waiver.source: waiver for waiver in waivers}
    non_waivable = policy.get("nonWaivable", _DEFAULT_NON_WAIVABLE)
    insufficient_alone = policy.get("insufficientAlone", _DEFAULT_INSUFFICIENT_ALONE)

    failures: list[ConditionFailure] = []
    missing: list[EvidenceSource] = []
    decided_by: list[EvidenceSource] = []
    waived: list[EvidenceWaiver] = []

    for source, condition in rules.items():
        if condition == "informational":
            continue

        waiver = waived_by_source.get(source)
        if waiver is not None:
            if source in non_waivable:
                failures.append(
                    ConditionFailure(
                        source, condition, f"this channel cannot be waived: {waiver.reason}"
                    )
                )
            else:
                waived.append(waiver)
            continue

        observation = seen.get(source)
        if observation is None or not observation.collected:
            missing.append(source)
            continue

        decided_by.append(source)
        why = _check_condition(condition, observation)
        if why is not None:
            failures.append(ConditionFailure(source, condition, why))

    if failures:
        return VerdictResult("fail", failures, missing, decided_by, waived)
    if missing:
        return VerdictResult("inconclusive", failures, missing, decided_by, waived)

    weak_only = len(decided_by) > 0 and all(source in insufficient_alone for source in decided_by)
    if len(decided_by) == 0 or weak_only:
        return VerdictResult("inconclusive", failures, missing, decided_by, waived)

    return VerdictResult("pass", failures, missing, decided_by, waived)
