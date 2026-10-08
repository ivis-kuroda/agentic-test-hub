"""Scenario `cleanup` steps and the `run` template scope."""

from __future__ import annotations

import re
from typing import Any

import httpx
import pytest
from conftest import MANIFEST as BASE_MANIFEST

from agentic_test_hub_runner import (
    ExecutionContext,
    ExecutorError,
    ExecutorRegistry,
    HttpExecutor,
    Manifest,
    run_case,
    run_scenario,
)
from agentic_test_hub_runner.run_scope import with_run_scope

MANIFEST = Manifest(
    name="items",
    connections={"api": {"kind": "http", "baseUrl": "https://api.invalid"}},
    operations={
        "OP-CREATE": {
            "executor": "http",
            "connection": "api",
            "method": "POST",
            "path": "/items",
            "params": [],
        },
        "OP-DELETE": {
            "executor": "http",
            "connection": "api",
            "method": "DELETE",
            "path": "/items/{{step.itemId}}",
            "params": [],
        },
        "OP-PURGE": {
            "executor": "http",
            "connection": "api",
            "method": "POST",
            "path": "/purge",
            "params": [],
        },
        "OP-LOGS": {
            "executor": "http",
            "connection": "api",
            "path": "/logs?since={{param.since}}",
            "params": ["since"],
        },
    },
    states={},
    evidence={"app_log": {"operation": "OP-LOGS", "params": {"since": "{{run.startedAt}}"}}},
    policy=BASE_MANIFEST.policy,
    extension_module=None,
)


class Client:
    """Records every request and answers from `answers` (default 200)."""

    def __init__(self, **answers: Any) -> None:
        self.calls: list[tuple[str, str]] = []
        self.answers = answers
        self.http = httpx.Client(transport=httpx.MockTransport(self._handle))

    def _handle(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        self.calls.append((request.method, url))
        path = url.removeprefix("https://api.invalid").split("?")[0]
        answer = self.answers.get(f"{request.method} {path}")
        if isinstance(answer, Exception):
            raise answer
        if answer is None and request.method == "POST" and path == "/items":
            return httpx.Response(201, json={"id": 7})
        return answer or httpx.Response(200, text="all quiet")


def _context() -> ExecutionContext:
    return ExecutionContext(manifest=MANIFEST, root="/plugin")


def _registry(client: Client) -> ExecutorRegistry:
    return ExecutorRegistry().register(HttpExecutor(client=client.http))


def _scenario(**overrides: Any) -> dict[str, Any]:
    base = {
        "id": "SC-CLEAN",
        "title": "create then clean up",
        "preconditions": [],
        "evidence": {"sources": ["app_log"], "timing": "after"},
        "evidenceWaivers": [],
        "steps": [
            {
                "id": "S-1",
                "summary": "create",
                "action": {"operation": "OP-CREATE", "params": {}},
                "expect": [{"kind": "http_status", "status": 201}],
                "produces": {"itemId": "body.id"},
            }
        ],
        "cleanup": [
            {
                "id": "S-CLEAN",
                "summary": "delete it",
                "action": {"operation": "OP-DELETE", "params": {}},
            }
        ],
    }
    return {**base, **overrides}


def test_cleanup_runs_after_evidence_and_sees_produced_values() -> None:
    client = Client()
    result = run_scenario(_scenario(), _registry(client), _context())

    assert [method for method, _ in client.calls] == ["POST", "GET", "DELETE"]
    assert client.calls[-1][1] == "https://api.invalid/items/7"
    assert [step.step_id for step in result.cleanup] == ["S-CLEAN"]
    assert result.verdict == "pass"


def test_cleanup_runs_when_a_step_failed_and_the_verdict_stays_fail() -> None:
    client = Client(**{"POST /items": httpx.Response(500, text="boom")})
    scenario = _scenario(
        cleanup=[{"id": "S-PURGE", "summary": "purge", "action": {"operation": "OP-PURGE"}}]
    )
    result = run_scenario(scenario, _registry(client), _context())

    assert ("POST", "https://api.invalid/purge") in client.calls
    assert result.verdict == "fail"


def test_cleanup_runs_when_a_step_raises_then_the_error_propagates() -> None:
    client = Client()
    scenario = _scenario(
        steps=[
            {
                "id": "S-1",
                "summary": "undeclared",
                "action": {"operation": "OP-NOPE", "params": {}},
                "expect": [],
            }
        ],
        cleanup=[{"id": "S-PURGE", "summary": "purge", "action": {"operation": "OP-PURGE"}}],
    )
    with pytest.raises(ExecutorError):
        run_scenario(scenario, _registry(client), _context())
    assert ("POST", "https://api.invalid/purge") in client.calls


def test_a_cleanup_expectation_violation_downgrades_to_inconclusive_not_fail() -> None:
    client = Client(**{"DELETE /items/7": httpx.Response(200, text="")})
    scenario = _scenario()
    scenario["cleanup"][0]["expect"] = [{"kind": "http_status", "status": 204}]
    result = run_scenario(scenario, _registry(client), _context())

    assert result.cleanup[0].verdict == "fail"
    assert result.verdict == "inconclusive"


def test_a_cleanup_request_that_does_not_complete_downgrades_to_inconclusive() -> None:
    client = Client(**{"DELETE /items/7": httpx.ConnectError("refused")})
    result = run_scenario(_scenario(), _registry(client), _context())

    assert result.cleanup[0].action is not None and not result.cleanup[0].action.ok
    assert result.verdict == "inconclusive"


def test_a_cleanup_step_that_raises_is_recorded_and_later_ones_still_run() -> None:
    client = Client()
    scenario = _scenario(
        cleanup=[
            {"id": "S-BAD", "summary": "no such op", "action": {"operation": "OP-NOPE"}},
            {"id": "S-PURGE", "summary": "purge", "action": {"operation": "OP-PURGE"}},
        ]
    )
    result = run_scenario(scenario, _registry(client), _context())

    assert result.cleanup[0].error is not None
    assert result.cleanup[1].verdict == "pass"
    assert result.verdict == "inconclusive"


def test_no_cleanup_runs_when_preconditions_are_not_ready() -> None:
    client = Client()
    manifest = Manifest(
        name=MANIFEST.name,
        connections=MANIFEST.connections,
        operations=MANIFEST.operations,
        states={
            "never": {
                "ensure": {"operation": "OP-PURGE", "params": {}},
                "verify": {
                    "operation": "OP-PURGE",
                    "params": {},
                    "assert": {"kind": "contains", "value": "never present"},
                },
                "cost": "low",
            }
        },
        evidence=MANIFEST.evidence,
        policy=MANIFEST.policy,
        extension_module=None,
    )
    scenario = _scenario(preconditions=["never"])
    result = run_scenario(
        scenario, _registry(client), ExecutionContext(manifest=manifest, root="/plugin")
    )

    assert result.verdict == "inconclusive"
    assert result.cleanup == []
    assert not any(method == "DELETE" for method, _ in client.calls)


_STARTED_AT = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


def test_with_run_scope_adds_started_at_and_id_unless_given() -> None:
    scopes = with_run_scope(_context()).scopes["run"]
    assert _STARTED_AT.match(scopes["startedAt"])
    assert len(scopes["id"]) == 8

    given = ExecutionContext(manifest=MANIFEST, scopes={"run": {"startedAt": "x", "id": "y"}})
    assert with_run_scope(given).scopes["run"] == {"startedAt": "x", "id": "y"}


def test_an_evidence_collectors_params_are_rendered_with_the_run_scope() -> None:
    client = Client()
    run_scenario(_scenario(cleanup=[]), _registry(client), _context())
    logs_url = next(url for method, url in client.calls if "/logs" in url)
    assert re.search(r"since=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$", logs_url)


def test_run_case_also_sets_the_run_scope_for_evidence() -> None:
    client = Client()
    case = {
        "id": "TC-RUN",
        "summary": "x",
        "expect": [{"kind": "http_status", "status": 201}],
        "polarity": "nominal",
        "evidence": {"sources": ["app_log"], "timing": "after"},
    }
    resolved = {
        "preconditions": [],
        "config": {},
        "context": {},
        "action": {"operation": "OP-CREATE"},
    }
    run_case(case, resolved, {}, _registry(client), _context())
    assert any(re.search(r"since=\d{4}-", url) for _, url in client.calls)
