from __future__ import annotations

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


def _ctx(params: dict, root: str = "/plugin") -> ExecutionContext:
    return ExecutionContext(manifest=MANIFEST, scopes={"param": params}, root=root)


def _capture(response: httpx.Response | None = None):
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        request.read()
        seen.append(request)
        return response or httpx.Response(200, json={})

    return HttpExecutor(httpx.Client(transport=httpx.MockTransport(handler))), seen


_AUTH_OP = {
    "executor": "http",
    "connection": "api",
    "method": "GET",
    "path": "/x",
    "params": [],
    "optionalParams": ["token"],
    "headers": {"Authorization": "Bearer {{param.token}}", "X-Static": "1"},
}


def test_a_header_naming_an_absent_optional_param_is_omitted() -> None:
    executor, seen = _capture()
    executor.run(_AUTH_OP, _ctx({}))
    assert "authorization" not in seen[0].headers
    assert seen[0].headers["X-Static"] == "1"


def test_a_header_naming_a_present_optional_param_is_sent() -> None:
    executor, seen = _capture()
    executor.run(_AUTH_OP, _ctx({"token": "t1"}))
    assert seen[0].headers["Authorization"] == "Bearer t1"


def test_an_absent_non_optional_param_still_raises() -> None:
    from agentic_test_hub_runner.template import TemplateError

    executor, _ = _capture()
    operation = {**_AUTH_OP, "optionalParams": []}
    with pytest.raises(TemplateError):
        executor.run(operation, _ctx({}))


def test_response_headers_are_lower_cased() -> None:
    executor, _ = _capture(httpx.Response(201, headers={"Location": "/r/9"}, json={}))
    result = executor.run(_AUTH_OP, _ctx({}))
    assert result.headers is not None
    assert result.headers["location"] == "/r/9"


def _multipart_op(parts: list[dict], **extra) -> dict:
    return {
        "executor": "http",
        "connection": "api",
        "method": "POST",
        "path": "/up",
        "params": [],
        "optionalParams": ["note"],
        "headers": {"Content-Type": "application/json"},
        "multipart": parts,
        **extra,
    }


def test_multipart_sends_files_and_values_and_lets_httpx_set_the_boundary(tmp_path) -> None:
    (tmp_path / "fixtures").mkdir()
    (tmp_path / "fixtures" / "a.txt").write_bytes(b"hello")
    executor, seen = _capture()
    parts = [
        {"name": "file", "file": "fixtures/{{param.name}}", "contentType": "text/x-test"},
        {"name": "meta", "value": "v-{{param.name}}"},
    ]
    executor.run(_multipart_op(parts), _ctx({"name": "a.txt"}, root=str(tmp_path)))
    request = seen[0]
    # The operation's explicit JSON Content-Type must not win for multipart.
    assert request.headers["Content-Type"].startswith("multipart/form-data; boundary=")
    body = request.content.decode()
    assert 'name="file"; filename="a.txt"' in body
    assert "Content-Type: text/x-test" in body
    assert "hello" in body
    assert 'name="meta"' in body and "v-a.txt" in body


def test_multipart_empty_filename_is_announced_as_empty(tmp_path) -> None:
    (tmp_path / "a.txt").write_bytes(b"x")
    executor, seen = _capture()
    parts = [{"name": "file", "file": "a.txt", "filename": ""}]
    executor.run(_multipart_op(parts), _ctx({}, root=str(tmp_path)))
    assert 'name="file"; filename=""' in seen[0].content.decode()


def test_multipart_part_naming_an_absent_optional_param_is_omitted(tmp_path) -> None:
    (tmp_path / "a.txt").write_bytes(b"x")
    executor, seen = _capture()
    parts = [
        {"name": "file", "file": "a.txt"},
        {"name": "note", "value": "{{param.note}}"},
    ]
    executor.run(_multipart_op(parts), _ctx({}, root=str(tmp_path)))
    body = seen[0].content.decode()
    assert 'name="file"' in body
    assert 'name="note"' not in body


def test_multipart_cannot_be_combined_with_a_body() -> None:
    executor, _ = _capture()
    parts = [{"name": "a", "value": "b"}]
    with pytest.raises(ExecutorError, match="multipart"):
        executor.run(_multipart_op(parts, body={"a": 1}), _ctx({}))
