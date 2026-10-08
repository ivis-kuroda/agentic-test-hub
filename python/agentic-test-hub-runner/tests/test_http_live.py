"""
The HTTP executor against a real local server, with no mocked transport.

`MockTransport` tests passed while real wire behaviour (multipart framing, an
empty `filename=""`, header omission) was still unproven, so these start a
throwaway `http.server` and send real requests to it.
"""

from __future__ import annotations

import json
import threading
from collections.abc import Iterator
from email import message_from_bytes
from email.policy import default
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from agentic_test_hub_runner import ExecutionContext, ExecutorRegistry, Manifest, run_scenario
from agentic_test_hub_runner.executors.http import HttpExecutor


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        pass

    def _reply(self, status: int, body: dict, headers: dict[str, str] | None = None) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self) -> None:
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        content_type = self.headers.get("Content-Type", "")
        message = message_from_bytes(
            b"Content-Type: " + content_type.encode() + b"\r\n\r\n" + raw, policy=default
        )
        parts = [
            {
                "name": part.get_param("name", header="content-disposition"),
                "filename": part.get_filename(),
                "disposition": part.get("Content-Disposition"),
                "content_type": part.get_content_type(),
                "size": len(part.get_payload(decode=True) or b""),
            }
            for part in message.iter_parts()
        ]
        self._reply(
            201,
            {"id": 4711, "auth": self.headers.get("Authorization"), "parts": parts},
            {"Location": f"http://{self.headers['Host']}/files/4711"},
        )

    def do_GET(self) -> None:
        self._reply(200, {"path": self.path})


@pytest.fixture
def base_url() -> Iterator[str]:
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()


def _manifest(base_url: str) -> Manifest:
    return Manifest(
        name="live",
        connections={"api": {"kind": "http", "baseUrl": base_url}},
        operations={
            "OP-UP": {
                "executor": "http",
                "connection": "api",
                "method": "POST",
                "path": "/files",
                "params": ["title"],
                "optionalParams": ["token", "note"],
                "headers": {"Authorization": "Bearer {{param.token}}"},
                "multipart": [
                    {"name": "file", "file": "a.txt", "contentType": "text/plain"},
                    {"name": "empty", "file": "a.txt", "filename": ""},
                    {"name": "title", "value": "{{param.title}}"},
                    {"name": "note", "value": "{{param.note}}"},
                ],
            },
            "OP-GET": {
                "executor": "http",
                "connection": "api",
                "path": "/files/{{step.recid}}",
                "params": [],
            },
        },
        states={},
        evidence={},
        policy=None,
        extension_module=None,
    )


def test_multipart_optional_headers_and_location_over_a_real_socket(
    base_url: str, tmp_path: Path
) -> None:
    (tmp_path / "a.txt").write_bytes(b"hello")
    manifest = _manifest(base_url)
    registry = ExecutorRegistry().register(HttpExecutor())
    context = ExecutionContext(manifest=manifest, root=str(tmp_path))

    result = registry.run("OP-UP", {"title": "t"}, context)

    assert result.status == 201
    assert result.headers is not None and result.headers["location"].endswith("/files/4711")
    body = result.body
    assert body["auth"] is None  # token absent: header omitted
    by_name = {part["name"]: part for part in body["parts"]}
    assert set(by_name) == {"file", "empty", "title"}  # note absent: part omitted
    assert by_name["file"]["filename"] == "a.txt"
    assert by_name["file"]["content_type"] == "text/plain"
    assert by_name["file"]["size"] == 5
    # An empty filename is announced (`filename=""`), not dropped (None).
    assert by_name["empty"]["filename"] == ""

    with_token = registry.run("OP-UP", {"title": "t", "token": "s", "note": "n"}, context)
    assert with_token.body["auth"] == "Bearer s"
    assert {part["name"] for part in with_token.body["parts"]} == {
        "file",
        "empty",
        "title",
        "note",
    }


def test_a_scenario_threads_a_location_tail_into_the_next_request(
    base_url: str, tmp_path: Path
) -> None:
    (tmp_path / "a.txt").write_bytes(b"hello")
    registry = ExecutorRegistry().register(HttpExecutor())
    context = ExecutionContext(manifest=_manifest(base_url), root=str(tmp_path))
    scenario = {
        "id": "SC-LIVE",
        "title": "upload then read back",
        "preconditions": [],
        "evidence": {"sources": [], "timing": "after"},
        "steps": [
            {
                "id": "S-1",
                "summary": "upload",
                "action": {"operation": "OP-UP", "params": {"title": "t"}},
                "expect": [{"kind": "http_status", "status": 201}],
                "produces": {"recid": {"from": "headers.location", "pattern": r"/files/(\d+)$"}},
            },
            {
                "id": "S-2",
                "summary": "read back",
                "action": {"operation": "OP-GET", "params": {}},
                "expect": [
                    {
                        "kind": "result",
                        "assert": {"kind": "equals", "at": "body.path", "value": "/files/4711"},
                    }
                ],
                "dependsOn": ["S-1"],
            },
        ],
    }
    result = run_scenario(scenario, registry, context)
    assert [step.verdict for step in result.steps] == ["pass", "pass"]
