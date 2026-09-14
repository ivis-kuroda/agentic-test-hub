from __future__ import annotations

import pytest

from agentic_test_hub_runner import ExecutionResult, check_expectation


def test_violated_when_the_operation_did_not_complete() -> None:
    result = ExecutionResult(operation="x", ok=False, duration_ms=0, failure="boom")
    outcome = check_expectation({"kind": "http_status", "status": 200}, result)
    assert outcome.verdict == "violated"
    assert "boom" in outcome.why


@pytest.mark.parametrize(
    ("expectation", "result_kwargs", "verdict"),
    [
        (
            {"kind": "http_status", "status": 201},
            {"status": 201},
            "satisfied",
        ),
        (
            {"kind": "http_status", "status": 201},
            {"status": 200},
            "violated",
        ),
        (
            {"kind": "http_status", "status": 201},
            {},
            "violated",
        ),
        (
            {"kind": "text", "value": "hello", "match": "contains"},
            {"stdout": "well hello there"},
            "satisfied",
        ),
        (
            {"kind": "text", "value": "hello", "match": "exact"},
            {"stdout": "well hello there"},
            "violated",
        ),
        (
            {"kind": "text", "value": "hello", "scope": "#banner"},
            {"stdout": "hello"},
            "needs_judgement",
        ),
        (
            {"kind": "error_message", "value": "required", "match": "contains"},
            {"body": {"error": "recipient is required"}},
            "satisfied",
        ),
        (
            {"kind": "stdout_contains", "value": "done", "stream": "stdout"},
            {"stdout": "still working", "stderr": "done"},
            "violated",
        ),
        (
            {"kind": "stdout_contains", "value": "done"},
            {"stdout": "still working", "stderr": "done"},
            "satisfied",
        ),
        (
            {"kind": "ai_judgement", "aspect": "visual", "value": "layout looks right"},
            {},
            "needs_judgement",
        ),
        (
            {"kind": "unspecified", "text": "an error is returned"},
            {},
            "needs_judgement",
        ),
    ],
)
def test_check_expectation(expectation, result_kwargs, verdict) -> None:
    result = ExecutionResult(operation="x", ok=True, duration_ms=0, **result_kwargs)
    assert check_expectation(expectation, result).verdict == verdict


def test_operation_result_delegates_to_check_assertion() -> None:
    result = ExecutionResult(operation="x", ok=True, duration_ms=0, status=201)
    expectation = {
        "kind": "operation_result",
        "operation": "OP-READ",
        "params": {},
        "assert": {"kind": "equals", "value": 201},
    }
    # subject_of prefers rows/body over status, so give it a body to compare.
    result_with_body = ExecutionResult(operation="x", ok=True, duration_ms=0, body=201)
    assert check_expectation(expectation, result_with_body).verdict == "satisfied"
    assert check_expectation(expectation, result).verdict == "violated"


def test_text_match_regex_reports_invalid_pattern() -> None:
    result = ExecutionResult(operation="x", ok=True, duration_ms=0, stdout="abc")
    outcome = check_expectation({"kind": "text", "value": "(", "match": "regex"}, result)
    assert outcome.verdict == "violated"
