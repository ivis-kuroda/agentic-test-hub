from __future__ import annotations

import pytest

from agentic_test_hub_runner import ExecutionResult, check_assertion


def test_violated_when_the_operation_did_not_complete() -> None:
    result = ExecutionResult(operation="x", ok=False, duration_ms=0, failure="host unreachable")
    outcome = check_assertion({"kind": "contains", "value": "x"}, result)
    assert outcome.verdict == "violated"
    assert "host unreachable" in outcome.why


def test_natural_always_needs_judgement() -> None:
    result = ExecutionResult(operation="x", ok=True, duration_ms=0, stdout="anything")
    outcome = check_assertion({"kind": "natural", "text": "looks right"}, result)
    assert outcome.verdict == "needs_judgement"
    assert outcome.why == "looks right"


@pytest.mark.parametrize(
    ("rows", "count", "verdict"),
    [([{"n": 1}], 1, "satisfied"), ([{"n": 1}, {"n": 2}], 1, "violated"), (None, 0, "violated")],
)
def test_row_count(rows, count, verdict) -> None:
    result = ExecutionResult(operation="x", ok=True, duration_ms=0, rows=rows)
    outcome = check_assertion({"kind": "row_count", "count": count}, result)
    assert outcome.verdict == verdict


def test_equals_against_the_single_returned_cell() -> None:
    result = ExecutionResult(operation="x", ok=True, duration_ms=0, rows=[{"count": 3}])
    assert check_assertion({"kind": "equals", "value": 3}, result).verdict == "satisfied"
    assert check_assertion({"kind": "equals", "value": "3"}, result).verdict == "satisfied"
    assert check_assertion({"kind": "equals", "value": 4}, result).verdict == "violated"


def test_contains_searches_body_and_stdout() -> None:
    result = ExecutionResult(operation="x", ok=True, duration_ms=0, body={"message": "not found"})
    assert (
        check_assertion({"kind": "contains", "value": "not found"}, result).verdict == "satisfied"
    )
    assert check_assertion({"kind": "contains", "value": "nope"}, result).verdict == "violated"


def test_matches_reports_an_invalid_pattern_as_violated() -> None:
    result = ExecutionResult(operation="x", ok=True, duration_ms=0, stdout="abc")
    outcome = check_assertion({"kind": "matches", "pattern": "("}, result)
    assert outcome.verdict == "violated"
    assert "not a valid expression" in outcome.why


def test_matches_a_valid_pattern() -> None:
    result = ExecutionResult(operation="x", ok=True, duration_ms=0, stdout="order-42 accepted")
    assert (
        check_assertion({"kind": "matches", "pattern": r"order-\d+"}, result).verdict == "satisfied"
    )
    assert (
        check_assertion({"kind": "matches", "pattern": r"order-[a-z]+"}, result).verdict
        == "violated"
    )
