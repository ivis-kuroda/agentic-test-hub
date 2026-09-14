from __future__ import annotations

from agentic_test_hub_runner import DEFAULT_VERDICT_POLICY, Observation, evaluate_verdict
from agentic_test_hub_runner.verdict import EvidenceWaiver

POLICY = {
    "id": "test",
    "title": "test",
    "rules": {
        "nominal": {
            "screenshot": "informational",
            "browser_console": "clean",
            "browser_network": "informational",
            "db_records": "informational",
            "app_log": "clean",
            "db_log": "informational",
        },
        "error": {
            "screenshot": "informational",
            "browser_console": "informational",
            "browser_network": "informational",
            "db_records": "informational",
            "app_log": "expected_error",
            "db_log": "informational",
        },
    },
}


def test_passes_when_every_bound_source_is_clean() -> None:
    observations = [
        Observation("browser_console", collected=True, errors=[]),
        Observation("app_log", collected=True, errors=[]),
    ]
    result = evaluate_verdict(POLICY, "nominal", observations)
    assert result.verdict == "pass"
    assert set(result.decided_by) == {"browser_console", "app_log"}


def test_fails_and_names_the_channel_when_a_bound_source_is_dirty() -> None:
    observations = [
        Observation("browser_console", collected=True, errors=[]),
        Observation("app_log", collected=True, errors=["error: boom"]),
    ]
    result = evaluate_verdict(POLICY, "nominal", observations)
    assert result.verdict == "fail"
    assert result.failures[0].source == "app_log"


def test_inconclusive_when_a_bound_source_was_never_collected() -> None:
    observations = [Observation("browser_console", collected=True, errors=[])]
    result = evaluate_verdict(POLICY, "nominal", observations)
    assert result.verdict == "inconclusive"
    assert result.missing == ["app_log"]


def test_insufficient_alone_sources_cannot_pass_by_themselves() -> None:
    policy = {**POLICY, "insufficientAlone": ["browser_console", "app_log"]}
    observations = [
        Observation("browser_console", collected=True, errors=[]),
        Observation("app_log", collected=True, errors=[]),
    ]
    result = evaluate_verdict(policy, "nominal", observations)
    assert result.verdict == "inconclusive"


def test_a_waiver_excuses_a_waivable_source() -> None:
    policy = {**POLICY, "nonWaivable": []}
    observations = [Observation("browser_console", collected=True, errors=[])]
    waivers = [EvidenceWaiver(source="app_log", reason="not applicable to this path")]
    result = evaluate_verdict(policy, "nominal", observations, waivers)
    assert result.verdict == "pass"
    assert result.waived == waivers


def test_a_non_waivable_source_cannot_be_waived() -> None:
    policy = {**POLICY, "nonWaivable": ["app_log"]}
    observations = [Observation("browser_console", collected=True, errors=[])]
    waivers = [EvidenceWaiver(source="app_log", reason="skip it")]
    result = evaluate_verdict(policy, "nominal", observations, waivers)
    assert result.verdict == "fail"
    assert "cannot be waived" in result.failures[0].why


def test_default_policy_demands_success_response_and_clean_channels_for_nominal() -> None:
    observations = [
        Observation("browser_console", collected=True, errors=[]),
        Observation("browser_network", collected=True, errors=[], status=200),
        Observation("db_records", collected=True, errors=[], intended_changes=1),
        Observation("app_log", collected=True, errors=[]),
        Observation("db_log", collected=True, errors=[]),
        Observation("screenshot", collected=True, errors=[], matched_expectation=True),
    ]
    result = evaluate_verdict(DEFAULT_VERDICT_POLICY, "nominal", observations)
    assert result.verdict == "pass"
