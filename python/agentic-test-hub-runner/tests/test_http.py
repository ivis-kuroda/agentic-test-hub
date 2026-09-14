from __future__ import annotations

import json

import httpx
import pytest

from agentic_test_hub_runner import ExecutionContext, ExecutorError, Manifest
from agentic_test_hub_runner.executors.http import HttpExecutor

MANIFEST = Manifest(
    name="x",
    connections={"api": {"kind": "http", "baseUrl": "https://api.invalid/v1"}},
    operations={},
    states={},
    evidence={},
    policy=None,
    extension_module=None,
)


def _context() -> ExecutionContext:
    return ExecutionContext(manifest=MANIFEST, scopes={"param": {"channel": "sms"}}, root="/plugin")


def test_sends_a_json_body_and_parses_a_json_response() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url == "https://api.invalid/v1/notifications"
        assert request.headers["Content-Type"] == "application/json"
        return httpx.Response(201, json={"id": "n-1"})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    executor = HttpExecutor(client)
    operation = {
        "executor": "http",
        "connection": "api",
        "method": "POST",
        "path": "/notifications",
        "params": ["channel"],
        "body": {"channel": "{{param.channel}}"},
        "headers": {},
    }
    result = executor.run(operation, _context())
    assert result.ok is True
    assert result.status == 201
    assert result.body == {"id": "n-1"}


def test_a_rejection_is_a_completed_operation_not_a_failure() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": "recipient is required"})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    executor = HttpExecutor(client)
    operation = {
        "executor": "http",
        "connection": "api",
        "method": "POST",
        "path": "/notifications",
        "params": [],
        "headers": {},
    }
    result = executor.run(operation, _context())
    assert result.ok is True
    assert result.status == 400
    assert result.body == {"error": "recipient is required"}


def test_body_param_sends_the_params_value_as_the_whole_body_unrendered() -> None:
    entity = {"id": "TC-1", "summary": "contains a {{literal}} that must not be templated"}
    seen: dict[str, bytes] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = request.content
        return httpx.Response(200, json={"ok": True})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    executor = HttpExecutor(client)
    operation = {
        "executor": "http",
        "connection": "api",
        "method": "PUT",
        "path": "/notifications/{{param.id}}",
        "params": ["id", "entity"],
        "bodyParam": "entity",
        "headers": {},
    }
    context = ExecutionContext(
        manifest=MANIFEST, scopes={"param": {"id": "TC-1", "entity": entity}}, root="/plugin"
    )
    result = executor.run(operation, context)
    assert result.ok is True
    assert json.loads(seen["body"]) == entity


def test_body_param_raises_when_the_param_is_missing() -> None:
    executor = HttpExecutor(httpx.Client())
    operation = {
        "executor": "http",
        "connection": "api",
        "method": "PUT",
        "path": "/notifications/{{param.id}}",
        "params": ["id"],
        "bodyParam": "entity",
        "headers": {},
    }
    context = ExecutionContext(manifest=MANIFEST, scopes={"param": {"id": "TC-1"}}, root="/plugin")
    with pytest.raises(ExecutorError, match='needs param "entity"'):
        executor.run(operation, context)


def test_raises_for_a_non_http_connection() -> None:
    manifest = Manifest(
        name="x",
        connections={"db": {"kind": "postgres", "url": "postgres://x"}},
        operations={},
        states={},
        evidence={},
        policy=None,
        extension_module=None,
    )
    context = ExecutionContext(manifest=manifest, scopes={}, root="/plugin")
    executor = HttpExecutor(httpx.Client())
    operation = {"executor": "http", "connection": "db", "path": "/x", "params": [], "headers": {}}
    with pytest.raises(ExecutorError, match="not an http connection"):
        executor.run(operation, context)
