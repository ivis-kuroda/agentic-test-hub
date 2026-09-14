"""
Judging any of the seven `Expectation` kinds against what an operation
produced, mirroring `packages/runner/src/expectation.ts`.
"""

from __future__ import annotations

import re
from typing import Any

from .assertion import AssertionOutcome, check_assertion, text_of
from .types import ExecutionResult


def _match_text(match: str, text: str, value: str) -> AssertionOutcome:
    if match == "regex":
        try:
            compiled = re.compile(value)
        except re.error as cause:
            return AssertionOutcome("violated", f"the pattern is not a valid expression: {cause}")
        return (
            AssertionOutcome("satisfied", f"text matches /{value}/")
            if compiled.search(text)
            else AssertionOutcome("violated", f"text does not match /{value}/")
        )

    satisfied = text == value if match == "exact" else value in text
    verb = "equal" if match == "exact" else "contain"
    return (
        AssertionOutcome("satisfied", f'text {verb}s "{value}"')
        if satisfied
        else AssertionOutcome("violated", f'text does not {verb} "{value}"')
    )


def _text_for_stream(result: ExecutionResult, stream: str | None) -> str:
    if stream == "stdout":
        return result.stdout or ""
    if stream == "stderr":
        return result.stderr or ""
    return "\n".join(part for part in (result.stdout or "", result.stderr or "") if part)


def check_expectation(expectation: dict[str, Any], result: ExecutionResult) -> AssertionOutcome:
    """
    Judges an expectation against what an operation produced.

    Covers all seven expectation kinds, unlike `check_assertion`, which only
    judges the `Assertion` union nested inside an `operation_result`
    expectation. For `operation_result` itself, this delegates to
    `check_assertion` directly — the caller (`run_case`/`run_step`) is
    responsible for having already run `expectation["operation"]` with
    `expectation["params"]` and passing *that* result here.
    """
    if not result.ok:
        return AssertionOutcome(
            "violated", f"the operation did not complete: {result.failure or 'no reason given'}"
        )

    kind = expectation["kind"]

    if kind == "http_status":
        if result.status is None:
            return AssertionOutcome("violated", "no HTTP status was observed")
        expected = expectation["status"]
        return (
            AssertionOutcome("satisfied", f"status is {expected}, as expected")
            if result.status == expected
            else AssertionOutcome("violated", f"status is {result.status}, expected {expected}")
        )

    if kind == "text":
        # Nothing narrows an ExecutionResult to one region of a page yet, so
        # a scoped claim cannot be settled by comparison.
        scope = expectation.get("scope")
        if scope is not None:
            return AssertionOutcome(
                "needs_judgement", f'scope "{scope}" is not yet checkable mechanically'
            )
        return _match_text(
            expectation.get("match", "contains"), text_of(result), expectation["value"]
        )

    if kind == "error_message":
        return _match_text(
            expectation.get("match", "contains"), text_of(result), expectation["value"]
        )

    if kind == "stdout_contains":
        text = _text_for_stream(result, expectation.get("stream"))
        value = expectation["value"]
        return (
            AssertionOutcome("satisfied", f'output contains "{value}"')
            if value in text
            else AssertionOutcome("violated", f'output does not contain "{value}"')
        )

    if kind == "operation_result":
        return check_assertion(expectation["assert"], result)

    if kind == "ai_judgement":
        return AssertionOutcome(
            "needs_judgement", f"({expectation['aspect']}) {expectation['value']}"
        )

    if kind == "unspecified":
        return AssertionOutcome("needs_judgement", expectation["text"])

    raise ValueError(f"unknown expectation kind: {kind}")
