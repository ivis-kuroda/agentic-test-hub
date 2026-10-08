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


def _res(**kwargs) -> ExecutionResult:
    return ExecutionResult(operation="x", ok=True, duration_ms=12.5, **kwargs)


@pytest.mark.parametrize(
    ("assertion", "result", "verdict"),
    [
        (
            {"kind": "equals", "at": "body.error", "value": "bad"},
            _res(body={"error": "bad"}),
            "satisfied",
        ),
        (
            {"kind": "equals", "at": "body.error", "value": "bad"},
            _res(body={"error": "x"}),
            "violated",
        ),
        ({"kind": "equals", "at": "body.missing", "value": 1}, _res(body={}), "violated"),
        ({"kind": "equals", "at": "status", "value": 201}, _res(status=201), "satisfied"),
        ({"kind": "equals", "at": "exitCode", "value": 0}, _res(exit_code=0), "satisfied"),
        ({"kind": "equals", "at": "exit_code", "value": 0}, _res(exit_code=0), "satisfied"),
        ({"kind": "contains", "at": "stdout", "value": "ok"}, _res(stdout="all ok"), "satisfied"),
        (
            {"kind": "contains", "at": "body.msg", "value": "no"},
            _res(body={"msg": "ok"}),
            "violated",
        ),
        (
            {"kind": "matches", "at": "body.id", "pattern": r"^\d+$"},
            _res(body={"id": 42}),
            "satisfied",
        ),
        (
            {"kind": "equals", "at": "body.e.1.m", "value": "b"},
            _res(body={"e": [{"m": "a"}, {"m": "b"}]}),
            "satisfied",
        ),
        (
            {"kind": "equals", "at": "body.e.2.m", "value": "b"},
            _res(body={"e": [{"m": "a"}]}),
            "violated",
        ),
        ({"kind": "keys", "value": ["b", "a"]}, _res(body={"a": 1, "b": 2}), "satisfied"),
        ({"kind": "keys", "value": ["a"]}, _res(body={"a": 1, "b": 2}), "violated"),
        ({"kind": "keys", "value": ["a", "b"]}, _res(body={"a": 1}), "violated"),
        ({"kind": "keys", "at": "body.x", "value": ["k"]}, _res(body={"x": {"k": 1}}), "satisfied"),
        ({"kind": "keys", "value": ["a"]}, _res(body=[1]), "violated"),
        ({"kind": "one_of", "values": [200, 204], "at": "status"}, _res(status=204), "satisfied"),
        ({"kind": "one_of", "values": ["200"], "at": "status"}, _res(status=200), "satisfied"),
        ({"kind": "one_of", "values": [200, 204], "at": "status"}, _res(status=500), "violated"),
        ({"kind": "compare", "op": "lt", "value": 100, "at": "durationMs"}, _res(), "satisfied"),
        ({"kind": "compare", "op": "gt", "value": 100, "at": "duration_ms"}, _res(), "violated"),
        (
            {"kind": "compare", "op": "lte", "value": 5, "at": "body.n"},
            _res(body={"n": "5"}),
            "satisfied",
        ),
        (
            {"kind": "compare", "op": "gte", "value": 5, "at": "body.n"},
            _res(body={"n": 4}),
            "violated",
        ),
        (
            {"kind": "compare", "op": "lt", "value": 5, "at": "body.n"},
            _res(body={"n": "abc"}),
            "violated",
        ),
        (
            {"kind": "compare", "op": "lt", "value": 5, "at": "body.n"},
            _res(body={"n": ""}),
            "violated",
        ),
        (
            {"kind": "compare", "op": "lt", "value": 5, "at": "body.n"},
            _res(body={"n": True}),
            "violated",
        ),
    ],
)
def test_at_and_new_assertion_kinds(assertion, result, verdict) -> None:
    assert check_assertion(assertion, result).verdict == verdict


def test_at_reads_response_headers_case_insensitively() -> None:
    result = ExecutionResult(
        operation="x", ok=True, duration_ms=1, headers={"location": "/items/7"}
    )
    assertion = {"kind": "matches", "at": "headers.Location", "pattern": r"/items/\d+$"}
    assert check_assertion(assertion, result).verdict == "satisfied"
