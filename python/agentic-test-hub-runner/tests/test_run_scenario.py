from __future__ import annotations

import httpx

from agentic_test_hub_runner import run_scenario, run_step


def _sequenced_json_then_quiet():
    calls = {"n": 0}

    def request(method, url, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(201, json={"id": "n-1"})
        return httpx.Response(200, text="all quiet")

    return type("Fetch", (), {"request": staticmethod(request)})()


def _quiet_logs():
    def request(method, url, **kwargs):
        return httpx.Response(200, text="all quiet")

    return type("Fetch", (), {"request": staticmethod(request)})()


def _scenario(**overrides):
    base = {
        "id": "SC-TEST",
        "title": "a test scenario",
        "preconditions": [],
        "evidenceWaivers": [],
        "steps": [
            {
                "id": "S-1",
                "summary": "send it",
                "action": {"operation": "OP-SEND", "params": {"channel": "email"}},
                "expect": [{"kind": "http_status", "status": 201, "viewpoints": []}],
                "polarity": "nominal",
                "dependsOn": [],
                "produces": {"sentId": "body.id"},
                "viewpoints": [],
            },
            {
                "id": "S-2",
                "summary": "read it back",
                "expect": [
                    {
                        "kind": "operation_result",
                        "operation": "OP-READ-LOGS",
                        "params": {},
                        "assert": {"kind": "contains", "value": "all quiet"},
                        "viewpoints": [],
                    }
                ],
                "polarity": "nominal",
                "dependsOn": ["S-1"],
                "produces": {},
                "viewpoints": [],
            },
        ],
    }
    return {**base, **overrides}


def test_run_step_checks_operation_result_against_its_own_operation(context, registry_with) -> None:
    registry = registry_with(_quiet_logs())
    step = _scenario()["steps"][1]
    result = run_step(step, registry, context)
    assert result.expectations[0].outcome.verdict == "satisfied"
    assert result.verdict == "pass"


def test_run_step_extracts_a_produced_value_via_a_dotted_path(context, registry_with) -> None:
    registry = registry_with(_sequenced_json_then_quiet())
    step = _scenario()["steps"][0]
    result = run_step(step, registry, context)
    assert result.produced["sentId"] == "n-1"


def test_threads_a_produced_value_from_one_step_into_a_later_step(context, registry_with) -> None:
    registry = registry_with(_sequenced_json_then_quiet())
    result = run_scenario(_scenario(), registry, context)

    assert len(result.steps) == 2
    assert result.steps[0].verdict == "pass"
    assert result.steps[1].verdict == "pass"
    assert result.steps[0].produced["sentId"] == "n-1"
    assert result.verdict == "pass"


def test_skips_a_step_whose_dependency_did_not_pass(context, registry_with) -> None:
    def request(method, url, **kwargs):
        return httpx.Response(500, text="")

    fetch = type("Fetch", (), {"request": staticmethod(request)})()
    registry = registry_with(fetch)
    result = run_scenario(_scenario(), registry, context)

    assert result.steps[0].verdict == "fail"
    assert result.steps[1].skipped is not None
    assert "S-1" in result.steps[1].skipped["reason"]


def test_inconclusive_when_preconditions_are_not_ready(context, registry_with) -> None:
    registry = registry_with(_sequenced_json_then_quiet())
    result = run_scenario(_scenario(preconditions=["never.ready"]), registry, context)

    assert result.preparation.ready is False
    assert result.steps == []
    assert result.verdict == "inconclusive"


def _location_fetch():
    def request(method, url, **kwargs):
        return httpx.Response(201, headers={"Location": "https://api.invalid/v1/records/4711"})

    return type("Fetch", (), {"request": staticmethod(request)})()


def test_produces_takes_group_one_of_a_pattern_over_a_header(context, registry_with) -> None:
    registry = registry_with(_location_fetch())
    step = {
        **_scenario()["steps"][0],
        "produces": {
            "recid": {"from": "headers.location", "pattern": r"/records/(\d+)$"},
            "plain": "headers.location",
        },
    }
    result = run_step(step, registry, context)
    assert result.produced["recid"] == "4711"
    assert result.produced["plain"] == "https://api.invalid/v1/records/4711"
    assert result.error is None


def test_a_pattern_that_does_not_match_fails_the_step(context, registry_with) -> None:
    registry = registry_with(_location_fetch())
    step = {
        **_scenario()["steps"][0],
        "produces": {"recid": {"from": "headers.location", "pattern": r"/zzz/(\d+)"}},
    }
    result = run_step(step, registry, context)
    assert result.verdict == "fail"
    assert result.error == (
        'produces "recid": pattern //zzz/(\\d+)/ did not match '
        '"https://api.invalid/v1/records/4711"'
    )
    assert result.produced == {}


def test_a_pattern_over_an_absent_path_fails_the_step(context, registry_with) -> None:
    registry = registry_with(_location_fetch())
    step = {
        **_scenario()["steps"][0],
        "produces": {"recid": {"from": "headers.nope", "pattern": r"(\d+)"}},
    }
    result = run_step(step, registry, context)
    assert result.verdict == "fail"
    assert "absent" in (result.error or "")


def test_a_plain_path_that_is_absent_still_produces_nothing(context, registry_with) -> None:
    registry = registry_with(_location_fetch())
    step = {**_scenario()["steps"][0], "produces": {"x": "headers.nope"}}
    result = run_step(step, registry, context)
    assert result.verdict == "pass"
    assert result.produced == {}
    assert result.error is None


def test_a_failed_production_skips_dependants(context, registry_with) -> None:
    registry = registry_with(_location_fetch())
    scenario = _scenario()
    scenario["steps"][0] = {
        **scenario["steps"][0],
        "produces": {"recid": {"from": "headers.location", "pattern": r"/zzz/(\d+)"}},
    }
    result = run_scenario(scenario, registry, context)
    assert result.steps[0].verdict == "fail"
    assert result.steps[1].skipped is not None
