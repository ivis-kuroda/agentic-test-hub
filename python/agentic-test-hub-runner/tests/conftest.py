"""
Shared fixtures, mirroring `packages/runner/test/harness.ts`: a fictional
dispatch manifest with one operation, one evidence collector (app_log) and a
policy scoped to just that channel — the same shape as
`examples/demo-app/plugin.yaml`'s own fix for Finding B.
"""

from __future__ import annotations

from typing import Any

import pytest

from agentic_test_hub_runner import ExecutionContext, ExecutorRegistry, Manifest
from agentic_test_hub_runner.executors.http import HttpExecutor

MANIFEST = Manifest(
    name="dispatch-service",
    connections={"api": {"kind": "http", "baseUrl": "https://api.invalid/v1"}},
    operations={
        "OP-SEND": {
            "executor": "http",
            "connection": "api",
            "method": "POST",
            "path": "/notifications",
            "params": ["channel"],
            "body": {"channel": "{{param.channel}}"},
        },
        "OP-READ-LOGS": {
            "executor": "http",
            "connection": "api",
            "method": "GET",
            "path": "/logs",
            "params": [],
        },
    },
    states={
        "never.ready": {
            "ensure": {"operation": "OP-READ-LOGS", "params": {}},
            "verify": {
                "operation": "OP-READ-LOGS",
                "params": {},
                "assert": {"kind": "contains", "value": "this text never appears"},
            },
            "cost": "low",
        }
    },
    evidence={"app_log": {"operation": "OP-READ-LOGS", "params": {}}},
    policy={
        "id": "test-app-log-only",
        "title": "judged on the application log alone",
        "rules": {
            "nominal": {
                "screenshot": "informational",
                "browser_console": "informational",
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
    },
    extension_module=None,
)

BASELINE = {
    "id": "BL-TEST",
    "title": "the standard request",
    "preconditions": [],
    "config": {},
    "context": {"body": {"channel": "email"}},
    "action": {"operation": "OP-SEND", "params": {}},
}


def case_with(**overrides: Any) -> dict[str, Any]:
    base = {
        "id": "TC-TEST",
        "summary": "a test case",
        "expect": [{"kind": "http_status", "status": 201, "viewpoints": []}],
        "polarity": "nominal",
        "priority": "P2",
        "evidenceWaivers": [],
    }
    return {**base, **overrides}


class SequencedFetch:
    """A fake httpx transport-free client: replies with `action_status` to
    the first request, `logs_body` to every one after — mirrors
    `run-case.test.ts`'s `sequencedFetch` helper."""

    def __init__(self, action_status: int, logs_body: str) -> None:
        self.action_status = action_status
        self.logs_body = logs_body
        self.calls = 0

    def request(self, method: str, url: str, **kwargs: Any) -> Any:
        import httpx

        self.calls += 1
        if self.calls == 1:
            return httpx.Response(self.action_status, text="")
        return httpx.Response(200, text=self.logs_body)


@pytest.fixture
def sequenced_fetch():
    return SequencedFetch


@pytest.fixture
def baseline() -> dict[str, Any]:
    return dict(BASELINE)


@pytest.fixture
def make_case():
    return case_with


@pytest.fixture
def context() -> ExecutionContext:
    return ExecutionContext(manifest=MANIFEST, scopes={}, root="/plugin")


@pytest.fixture
def registry_with():
    def make(fetch_client: Any) -> ExecutorRegistry:
        registry = ExecutorRegistry()
        registry.register(HttpExecutor(client=fetch_client))
        return registry

    return make
