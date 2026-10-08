"""Masking rules, and a scan of real evidence files for a known secret."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from live_plugin import BASELINE, PLUGIN, make_case
from live_support import (
    SECRET,
    generate,
    live_server,
    load_index,
    requires_cli,
    run_generated,
    write_specs,
    write_yaml,
)

from agentic_test_hub_runner.redaction import REDACTED, Redactor


def test_default_sensitive_headers_are_masked_whatever_their_case() -> None:
    masked = Redactor().headers(
        {
            "AUTHORIZATION": "Bearer abc.def-123",
            "cookie": "a=b",
            "Set-Cookie": "s=1",
            "Proxy-Authorization": "Basic Zm9v",
            "X-Api-Key": "k-123456",
            "Accept": "application/json",
        }
    )
    assert masked == {
        "AUTHORIZATION": REDACTED,
        "cookie": REDACTED,
        "Set-Cookie": REDACTED,
        "Proxy-Authorization": REDACTED,
        "X-Api-Key": REDACTED,
        "Accept": "application/json",
    }


def test_manifest_rules_extend_the_defaults() -> None:
    redactor = Redactor.from_manifest({"headers": ["x-session-.*"], "patterns": [r"ssn=\d+"]})
    masked = redactor.headers({"X-Session-Id": "abc", "X-Other": "ssn=123 ok"})
    assert masked == {"X-Session-Id": REDACTED, "X-Other": f"{REDACTED} ok"}
    assert redactor.text("body ssn=999 end") == f"body {REDACTED} end"


def test_bearer_tokens_are_masked_anywhere_in_text() -> None:
    assert Redactor().text("auth=Bearer abc123.def") == f"auth=Bearer {REDACTED}"


def test_a_secret_sent_in_a_header_is_masked_when_it_shows_up_bare() -> None:
    redactor = Redactor()
    redactor.headers({"Authorization": "Bearer tok-0123456789"})
    assert redactor.text("token=tok-0123456789") == f"token={REDACTED}"


def test_a_pattern_cannot_break_json() -> None:
    redactor = Redactor(patterns=['"'])
    assert json.loads(redactor.json_text('{"a": "x"}')) == {"a": "x"}


def _scan(root: Path, needle: str) -> list[Path]:
    return [
        path for path in root.rglob("*") if path.is_file() and needle.encode() in path.read_bytes()
    ]


@requires_cli
def test_no_evidence_file_holds_the_secret(tmp_path: Path) -> None:
    plugin: dict[str, Any] = {**PLUGIN, "redact": {"patterns": [r"someone@example\.invalid"]}}
    plugin_path = tmp_path / "plugin.yaml"
    write_yaml(plugin_path, plugin)
    case = make_case(evidence={"sources": ["app_log", "db_records", "db_log"], "timing": "after"})
    specs = write_specs(tmp_path, BASELINE, [case], [])
    test_file = generate(tmp_path, specs, plugin_path, "TC-LIVE-001")
    evidence_root = tmp_path / "evidence"
    with live_server() as (url, state):
        done = run_generated(
            test_file,
            {"APP_URL": url, "LIVE_TOKEN": SECRET, "ATH_EVIDENCE_DIR": str(evidence_root)},
        )
        # The service really did receive and log the credential.
        assert SECRET in "\n".join(state.log)
    assert done.returncode == 0, done.stdout + done.stderr

    assert _scan(evidence_root, SECRET) == []
    run_dir, _index = load_index(evidence_root)
    exchange = json.loads(
        (run_dir / "TC-LIVE-001/case/during-network-http-OP-SEND.json").read_text()
    )
    assert exchange["request"]["headers"]["authorization"] == REDACTED
    assert exchange["response"]["headers"]["set-cookie"] == REDACTED
    assert exchange["request"]["body"] == {"recipient": REDACTED}
    assert exchange["response"]["status"] == 201
    assert exchange["response"]["body"]["notification"]["id"] == 1
    logged = (run_dir / "TC-LIVE-001/case/after-app-log-OP-READ-LOGS.txt").read_text()
    assert f"auth=Bearer {REDACTED} token={REDACTED}" in logged


@requires_cli
def test_multipart_records_part_metadata_not_file_bytes(tmp_path: Path) -> None:
    marker = "UNIQUE-FILE-BYTES-0042"
    (tmp_path / "fixtures").mkdir()
    (tmp_path / "fixtures" / "a.txt").write_text(marker * 3)
    plugin = json.loads(json.dumps(PLUGIN))
    plugin["operations"]["OP-UPLOAD"] = {
        "executor": "http",
        "connection": "api",
        "method": "POST",
        "path": "/notifications",
        "multipart": [
            {"name": "file", "file": "fixtures/a.txt", "contentType": "text/plain"},
            {"name": "title", "value": "hello"},
        ],
    }
    plugin_path = tmp_path / "plugin.yaml"
    write_yaml(plugin_path, plugin)
    baseline = {**BASELINE, "action": {"operation": "OP-UPLOAD", "params": {}}}
    specs = write_specs(tmp_path, baseline, [make_case()], [])
    test_file = generate(tmp_path, specs, plugin_path, "TC-LIVE-001")
    evidence_root = tmp_path / "evidence"
    with live_server() as (url, _state):
        done = run_generated(
            test_file,
            {"APP_URL": url, "LIVE_TOKEN": "tok", "ATH_EVIDENCE_DIR": str(evidence_root)},
        )
    assert done.returncode == 0, done.stdout + done.stderr
    assert _scan(evidence_root, marker) == []
    run_dir, _index = load_index(evidence_root)
    exchange = json.loads(
        (run_dir / "TC-LIVE-001/case/during-network-http-OP-UPLOAD.json").read_text()
    )
    assert exchange["request"]["multipart"] == [
        {
            "name": "file",
            "filename": "a.txt",
            "contentType": "text/plain",
            "bytes": len(marker) * 3,
        },
        {"name": "title", "filename": None, "contentType": None, "bytes": 5},
    ]
    assert exchange["request"]["headers"]["content-type"].startswith("multipart/form-data")
