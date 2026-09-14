"""
Judging an `Assertion` against what an operation produced, mirroring
`packages/runner/src/assert.ts`.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Literal

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
        value, source = subject_of(result)
        expected = assertion["value"]
        matches = value == expected or str(value) == str(expected)
        return (
            AssertionOutcome("satisfied", f"{source} equals the expected value")
            if matches
            else AssertionOutcome(
                "violated", f"{source} is {json.dumps(value)}, expected {json.dumps(expected)}"
            )
        )

    if kind == "contains":
        text = text_of(result)
        value = assertion["value"]
        return (
            AssertionOutcome("satisfied", f'output contains "{value}"')
            if value in text
            else AssertionOutcome("violated", f'output does not contain "{value}"')
        )

    if kind == "matches":
        text = text_of(result)
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
