"""
The evidence store: the unit pieces, then a real generated test run against a
throwaway server that saves collector output to disk.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from live_plugin import BASELINE, PLUGIN, make_case
from live_support import (
    generate,
    live_server,
    load_index,
    requires_cli,
    run_generated,
    write_specs,
    write_yaml,
)

from agentic_test_hub_runner.evidence_store import EvidenceStore, open_evidence_store


def test_disabled_without_directory(monkeypatch) -> None:
    monkeypatch.delenv("ATH_EVIDENCE_DIR", raising=False)
    assert open_evidence_store({"id": "r1", "startedAt": "t"}) is None


def test_enabled_by_env_and_option(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("ATH_EVIDENCE_DIR", str(tmp_path / "env"))
    from_env = open_evidence_store({"id": "r1", "startedAt": "t"})
    assert from_env is not None and from_env.run_dir == tmp_path / "env" / "r1"
    explicit = open_evidence_store({"id": "r2"}, tmp_path / "opt")
    assert explicit is not None and explicit.run_dir == tmp_path / "opt" / "r2"


def test_save_writes_file_and_valid_index(tmp_path: Path) -> None:
    store = EvidenceStore(tmp_path, "run1", "2026-01-01T00:00:00Z")
    target = store.at("TC-1", "case")
    relative = target.save(
        phase="after", source="app_log", name="OP-LOGS", data="hello\n", ext="txt"
    )
    assert relative == "TC-1/case/after-app-log-OP-LOGS.txt"
    saved = (store.run_dir / relative).read_bytes()
    index = json.loads(store.index_path.read_text())
    (entry,) = index["entries"]
    assert entry["kind"] == 4 and entry["source"] == "app_log" and entry["phase"] == "after"
    assert entry["bytes"] == len(saved)
    assert entry["sha256"] == hashlib.sha256(saved).hexdigest()
    assert entry["entity"] == "TC-1" and entry["step"] is None
    assert not list(store.run_dir.rglob("*.tmp"))


def test_same_name_gets_numbered_and_index_is_extended(tmp_path: Path) -> None:
    first = EvidenceStore(tmp_path, "run1", "t")
    first.at("TC-1", "case").save(
        phase="during", source="http_exchange", name="x", data="1", ext="json"
    )
    second = EvidenceStore(tmp_path, "run1", "t")  # same run id: extends, never overwrites
    path = second.at("TC-1", "case").save(
        phase="during", source="http_exchange", name="x", data="2", ext="json"
    )
    assert path == "TC-1/case/during-network-x-2.json"
    assert len(json.loads(second.index_path.read_text())["entries"]) == 2


def test_write_failure_becomes_a_warning_not_an_exception(tmp_path: Path) -> None:
    blocker = tmp_path / "blocked"
    blocker.write_text("a file where the run directory should be")
    store = EvidenceStore(blocker, "run1", "t")
    result = store.at("TC-1", "case").save(
        phase="after", source="app_log", name="n", data="x", ext="txt"
    )
    assert result is None
    assert store.warnings and "could not save" in store.warnings[0]["message"]


def test_unknown_source_is_a_warning(tmp_path: Path) -> None:
    store = EvidenceStore(tmp_path, "run1", "t")
    assert (
        store.at("TC-1", "case").save(phase="after", source="nope", name="n", data="x", ext="txt")
        is None
    )
    assert json.loads(store.index_path.read_text())["warnings"]


@requires_cli
def test_generated_case_saves_collector_output(tmp_path: Path) -> None:
    plugin = tmp_path / "plugin.yaml"
    write_yaml(plugin, PLUGIN)
    case = make_case(evidence={"sources": ["app_log", "db_records", "db_log"], "timing": "after"})
    specs = write_specs(tmp_path, BASELINE, [case], [])
    test_file = generate(tmp_path, specs, plugin, "TC-LIVE-001")
    evidence_root = tmp_path / "evidence"

    with live_server() as (url, _state):
        done = run_generated(
            test_file,
            {"APP_URL": url, "LIVE_TOKEN": "tok", "ATH_EVIDENCE_DIR": str(evidence_root)},
        )
    assert done.returncode == 0, done.stdout + done.stderr

    run_dir, index = load_index(evidence_root)
    paths = {entry["path"] for entry in index["entries"]}
    # Saving evidence also reads the collectors before the action.
    assert paths == {
        f"TC-LIVE-001/case/{phase}-{word}-{op}.{ext}"
        for phase in ("before", "after")
        for word, op, ext in (
            ("app-log", "OP-READ-LOGS", "txt"),
            ("db-records", "OP-LIST", "json"),
            ("db-log", "OP-READ-DB-LOG", "txt"),
        )
    } | {
        f"TC-LIVE-001/case/diff-{word}-{op}.diff"
        for word, op in (
            ("app-log", "OP-READ-LOGS"),
            ("db-records", "OP-LIST"),
            ("db-log", "OP-READ-DB-LOG"),
        )
    }
    logged = (run_dir / "TC-LIVE-001/case/after-app-log-OP-READ-LOGS.txt").read_text()
    assert "accepted notification 1" in logged
    assert {entry["kind"] for entry in index["entries"]} == {3, 4, 5}


@requires_cli
def test_disabled_run_writes_nothing(tmp_path: Path) -> None:
    plugin = tmp_path / "plugin.yaml"
    write_yaml(plugin, PLUGIN)
    specs = write_specs(tmp_path, BASELINE, [make_case()], [])
    test_file = generate(tmp_path, specs, plugin, "TC-LIVE-001")
    with live_server() as (url, _state):
        env = {"APP_URL": url, "LIVE_TOKEN": "tok"}
        done = run_generated(test_file, env)
    assert done.returncode == 0, done.stdout + done.stderr
    assert not (tmp_path / "evidence").exists()
