"""
Judging an `Assertion` against what an operation produced, mirroring
`packages/runner/src/assert.ts`.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from typing import Any, Literal

from .paths import get_result_at_path
from .types import ExecutionResult

AssertionVerdict = Literal["satisfied", "violated", "needs_judgement"]


@dataclass(frozen=True)
class AssertionOutcome:
    """An assertion's outcome, with the reasoning behind it."""

    verdict: AssertionVerdict
    why: str


def subject_of(result: ExecutionResult) -> tuple[Any, str]:
    """Picks the value an assertion compares against, and where it came from."""
    if result.rows is not None:
        first = result.rows[0] if result.rows else None
        columns = list(first.values()) if first is not None else []
        if len(result.rows) == 1 and len(columns) == 1:
            return columns[0], "the single returned cell"
        return result.rows, "the returned rows"
    if result.body is not None:
        return result.body, "the response body"
    return (result.stdout or "").strip(), "standard output"


def text_of(result: ExecutionResult) -> str:
    """Text an assertion can search, whatever the operation produced.

    Shared with `expectation.py`'s `text`/`error_message` kinds, so the two
    never drift on what counts as searchable text.
    """
    parts = [result.stdout or "", result.stderr or ""]
    if result.rows is not None:
        parts.append(json.dumps(result.rows))
    elif result.body is not None:
        parts.append(json.dumps(result.body))
    return "\n".join(part for part in parts if part)


def _subject_for(at: str | None, result: ExecutionResult) -> tuple[bool | None, Any, str]:
    """The value an assertion judges: what `at` selects, else `subject_of`.

    Returns `(True, value, source)`, or `(None, None, why)` when `at` names
    nothing in the result.
    """
    if at is None:
        value, source = subject_of(result)
        return True, value, source
    present, value = get_result_at_path(result, at)
    if not present:
        return None, None, f'nothing at "{at}" in the result'
    return True, value, f'"{at}"'


def _text_of_subject(value: Any) -> str:
    return value if isinstance(value, str) else json.dumps(value)


def _loosely_equal(a: Any, b: Any) -> bool:
    return a == b or str(a) == str(b)


def _to_number(value: Any) -> float | None:
    """Reads a value as a finite number, refusing blanks and booleans."""
    if isinstance(value, bool):
        return None
    if isinstance(value, str) and not value.strip():
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def check_assertion(assertion: dict[str, Any], result: ExecutionResult) -> AssertionOutcome:
    """Judges an assertion against what an operation produced."""
    if not result.ok:
        return AssertionOutcome(
            "violated", f"the operation did not complete: {result.failure or 'no reason given'}"
        )

    kind = assertion["kind"]

    if kind == "natural":
        return AssertionOutcome("needs_judgement", assertion["text"])

    if kind == "row_count":
        if result.rows is None:
            return AssertionOutcome("violated", "the operation returned no rows to count")
        count = assertion["count"]
        return (
            AssertionOutcome("satisfied", f"{count} row(s), as expected")
            if len(result.rows) == count
            else AssertionOutcome(
                "violated", f"expected {count} row(s) but found {len(result.rows)}"
            )
        )

    if kind == "equals":
        subject = _subject_for(assertion.get("at"), result)
        if subject[0] is None:
            return AssertionOutcome("violated", subject[2])
        value, source = subject[1], subject[2]
        expected = assertion["value"]
        return (
            AssertionOutcome("satisfied", f"{source} equals the expected value")
            if _loosely_equal(value, expected)
            else AssertionOutcome(
                "violated", f"{source} is {json.dumps(value)}, expected {json.dumps(expected)}"
            )
        )

    if kind == "one_of":
        subject = _subject_for(assertion.get("at"), result)
        if subject[0] is None:
            return AssertionOutcome("violated", subject[2])
        value, source = subject[1], subject[2]
        values = assertion["values"]
        return (
            AssertionOutcome("satisfied", f"{source} is one of the accepted values")
            if any(_loosely_equal(value, candidate) for candidate in values)
            else AssertionOutcome(
                "violated",
                f"{source} is {json.dumps(value)}, expected one of {json.dumps(values)}",
            )
        )

    if kind == "keys":
        subject = _subject_for(assertion.get("at"), result)
        if subject[0] is None:
            return AssertionOutcome("violated", subject[2])
        value, source = subject[1], subject[2]
        if not isinstance(value, dict):
            return AssertionOutcome(
                "violated", f"{source} is not an object, so it has no keys to compare"
            )
        expected_keys = set(assertion["value"])
        actual_keys = set(value)
        missing = sorted(expected_keys - actual_keys)
        extra = sorted(actual_keys - expected_keys)
        return (
            AssertionOutcome("satisfied", f"{source} has exactly the expected keys")
            if not missing and not extra
            else AssertionOutcome(
                "violated",
                f"{source} keys differ: missing {json.dumps(missing)}, "
                f"unexpected {json.dumps(extra)}",
            )
        )

    if kind == "compare":
        subject = _subject_for(assertion.get("at"), result)
        if subject[0] is None:
            return AssertionOutcome("violated", subject[2])
        value, source = subject[1], subject[2]
        number = _to_number(value)
        if number is None:
            return AssertionOutcome(
                "violated", f"{source} is {json.dumps(value)}, which is not a number"
            )
        op, bound = assertion["op"], assertion["value"]
        holds = {
            "lt": number < bound,
            "lte": number <= bound,
            "gt": number > bound,
            "gte": number >= bound,
        }[op]
        return (
            AssertionOutcome("satisfied", f"{source} ({number:g}) is {op} {bound:g}")
            if holds
            else AssertionOutcome("violated", f"{source} is {number:g}, expected {op} {bound:g}")
        )

    if kind in ("contains", "matches"):
        at = assertion.get("at")
        if at is None:
            text = text_of(result)
        else:
            subject = _subject_for(at, result)
            if subject[0] is None:
                return AssertionOutcome("violated", subject[2])
            text = _text_of_subject(subject[1])
        if kind == "contains":
            value = assertion["value"]
            return (
                AssertionOutcome("satisfied", f'output contains "{value}"')
                if value in text
                else AssertionOutcome("violated", f'output does not contain "{value}"')
            )
        pattern = assertion["pattern"]
        try:
            compiled = re.compile(pattern)
        except re.error as cause:
            return AssertionOutcome("violated", f"the pattern is not a valid expression: {cause}")
        return (
            AssertionOutcome("satisfied", f"output matches /{pattern}/")
            if compiled.search(text)
            else AssertionOutcome("violated", f"output does not match /{pattern}/")
        )

    raise ValueError(f"unknown assertion kind: {kind}")
