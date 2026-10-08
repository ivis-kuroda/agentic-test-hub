"""
Real-world scaffolding for the evidence tests: a throwaway local HTTP server
and the real `ath-generate-test --lang python` CLI.

Unit tests with fake transports passed while codegen bugs were still there, so
the evidence tests generate a pytest file with the CLI and run it, in a
subprocess, against this server. They skip when `node` cannot run the CLI.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
CLI = REPO_ROOT / "packages" / "cli" / "bin" / "generate-test.ts"

SECRET = "s3cr3t-token-0123456789"

PAGE = """<!doctype html><html><body>
<h1 data-testid="heading">live app</h1>
<input data-testid="recipient"><button data-testid="submit">send</button>
<div data-testid="result"></div>
<script>
console.log("page loaded");
console.error("boom from page");
document.querySelector('[data-testid=submit]').onclick = async () => {
  const r = await fetch('/notifications', {method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({recipient: document.querySelector('[data-testid=recipient]').value})});
  document.querySelector('[data-testid=result]').textContent = 'status ' + r.status;
};
</script></body></html>"""


class LiveState:
    """What the throwaway server holds: notifications and a log."""

    def __init__(self, log: list[str] | None = None) -> None:
        self.notifications: list[dict[str, Any]] = []
        self.log: list[str] = list(log) if log is not None else ["boot ok"]
        self.db_log: list[str] = ["db ready"]


def _handler(state: LiveState) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: object) -> None:  # noqa: A002
            pass

        def _send(self, status: int, body: str, content_type: str, extra: dict[str, str]) -> None:
            data = body.encode()
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            for name, value in extra.items():
                self.send_header(name, value)
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self) -> None:
            routes = {
                "/": (PAGE, "text/html"),
                "/logs": ("\n".join(state.log), "text/plain"),
                "/dblog": ("\n".join(state.db_log), "text/plain"),
                "/notifications": (json.dumps(state.notifications), "application/json"),
                "/health": ('{"ok":true}', "application/json"),
            }
            body, content_type = routes.get(self.path, ("missing", "text/plain"))
            self._send(200 if self.path in routes else 404, body, content_type, {})

        def do_POST(self) -> None:
            raw = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            auth = self.headers.get("Authorization", "")
            try:
                payload = json.loads(raw or b"{}")
            except ValueError:
                payload = {}
            record = {"id": len(state.notifications) + 1, **payload}
            state.notifications.append(record)
            # A careless service logging the credential it was given.
            state.log.append(f"accepted notification {record['id']} auth={auth}")
            if "ERROR" in str(payload.get("recipient", "")):
                state.log.append(f"ERROR while handling {payload['recipient']}")
            state.db_log.append(f"INSERT notification {record['id']}")
            self._send(
                201,
                json.dumps({"notification": record, "echo": auth}),
                "application/json",
                {"Set-Cookie": "session=abc123; HttpOnly"},
            )

    return Handler


@contextmanager
def live_server(log: list[str] | None = None) -> Iterator[tuple[str, LiveState]]:
    """Runs the throwaway server for the length of the block; yields (base_url, state).

    @param log: Application log lines already present when the server starts.
    """
    state = LiveState(log)
    server = ThreadingHTTPServer(("127.0.0.1", 0), _handler(state))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}", state
    finally:
        server.shutdown()
        server.server_close()


def cli_available() -> bool:
    """Whether `node` can run the TypeScript CLI directly."""
    node = shutil.which("node")
    if node is None or not (REPO_ROOT / "node_modules").exists():
        return False
    probe = subprocess.run(
        [node, str(CLI)], capture_output=True, text=True, cwd=REPO_ROOT, check=False
    )
    return "usage:" in probe.stderr


requires_cli = pytest.mark.skipif(not cli_available(), reason="node cannot run the real CLI here")


def write_yaml(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump(data, sort_keys=False))


def write_specs(
    root: Path, baseline: dict[str, Any], cases: list[dict[str, Any]], scenarios: list[Any]
) -> Path:
    """Writes a minimal spec tree and returns its directory."""
    specs = root / "specs"
    write_yaml(specs / "baselines" / f"{baseline['id']}.yaml", baseline)
    for case in cases:
        write_yaml(specs / "cases" / f"{case['id']}.yaml", case)
    for scenario in scenarios:
        write_yaml(specs / "scenarios" / f"{scenario['id']}.yaml", scenario)
    return specs


def generate(root: Path, specs: Path, plugin: Path, entity_id: str) -> Path:
    """Runs the real `ath-generate-test --lang python`; returns the generated file."""
    out = root / "generated" / "test_generated.py"
    done = subprocess.run(
        [
            "node",
            str(CLI),
            entity_id,
            "--specs",
            str(specs),
            "--plugin",
            str(plugin),
            "--plugin-root",
            str(root),
            "--lang",
            "python",
            "--out",
            str(out),
            "--force",
        ],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
        check=False,
    )
    assert done.returncode == 0, done.stderr
    return out


def run_generated(test_file: Path, env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    """Runs a generated test with pytest in a subprocess."""
    return subprocess.run(
        [sys.executable, "-m", "pytest", "-p", "no:anyio", "-q", "-x", str(test_file)],
        capture_output=True,
        text=True,
        env={**os.environ, **env},
        cwd=test_file.parent,
        check=False,
    )


def load_index(evidence_root: Path) -> tuple[Path, dict[str, Any]]:
    """The single run directory under an evidence root, and its parsed index."""
    runs = [p for p in evidence_root.iterdir() if p.is_dir()]
    assert len(runs) == 1, runs
    return runs[0], json.loads((runs[0] / "index.json").read_text())
