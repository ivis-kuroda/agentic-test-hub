"""
Saving evidence to disk, so a reviewer can look at what a run saw after the
run is over.

Layout, under the evidence root (`ATH_EVIDENCE_DIR` or `RunOptions.evidence_dir`):

    <root>/<run-id>/index.json
    <root>/<run-id>/<entity-id>/<NN-step-id | case | scenario>/<phase>-<kind>-<name>.<ext>

`<phase>` is `before`, `after` or `during`; a derived file (a before/after
diff) carries the prefix `diff`. `index.json` lists every file with its kind
(1 screenshot, 2 browser console/network or an API request/response, 3 DB
records, 4 application log, 5 DB log), source channel, capture time, size and
sha256.

Evidence must never turn a pass into an error: every write failure is caught
and recorded as a warning in `index.json` (or kept in memory when even the
index cannot be written).
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import uuid
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from .redaction import Redactor

EVIDENCE_DIR_ENV = "ATH_EVIDENCE_DIR"
"""Environment variable naming the evidence root; unset means evidence is not saved."""

INDEX_SCHEMA_VERSION = 1

Phase = Literal["before", "after", "during"]
Role = Literal["capture", "diff"]

CHANNELS: dict[str, tuple[int, str]] = {
    "screenshot": (1, "screenshot"),
    "browser_console": (2, "console"),
    "browser_network": (2, "network"),
    "http_exchange": (2, "network"),
    "db_records": (3, "db-records"),
    "app_log": (4, "app-log"),
    "db_log": (5, "db-log"),
}
"""Source channel -> (evidence kind number, word used in file names)."""

_UNSAFE = re.compile(r"[^A-Za-z0-9._-]+")


def safe_component(text: str) -> str:
    """Makes `text` usable as one path component (no separators, no leading dot)."""
    cleaned = _UNSAFE.sub("_", text).strip("._")[:80]
    return cleaned or "x"


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.{uuid.uuid4().hex[:6]}.tmp")
    try:
        temporary.write_bytes(data)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


class EvidenceStore:
    """
    The evidence directory of one run, plus its `index.json`.

    Safe to share between threads. An existing `index.json` for the same run
    id is loaded and extended, so two cases given the same `run` scope add to
    one index instead of overwriting each other's.
    """

    def __init__(
        self,
        root: str | os.PathLike[str],
        run_id: str,
        started_at: str,
        redactor: Redactor | None = None,
    ) -> None:
        self.run_id = run_id
        self.redactor = redactor or Redactor()
        self.run_dir = Path(root) / safe_component(run_id)
        self.started_at = started_at
        self._lock = threading.Lock()
        self._entries: list[dict[str, Any]] = []
        self._warnings: list[dict[str, str]] = []
        self._used: set[str] = set()
        self._load_existing()

    @property
    def index_path(self) -> Path:
        """Where this run's `index.json` lives."""
        return self.run_dir / "index.json"

    @property
    def warnings(self) -> list[dict[str, str]]:
        """Warnings recorded so far (also written to the index)."""
        return list(self._warnings)

    def _load_existing(self) -> None:
        try:
            loaded = json.loads(self.index_path.read_text("utf8"))
            self._entries = list(loaded.get("entries", []))
            self._warnings = list(loaded.get("warnings", []))
            self._used = {entry["path"] for entry in self._entries}
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            pass

    def at(self, entity_id: str, location: str, step_id: str | None = None) -> EvidenceTarget:
        """A handle that saves into one entity's directory (`case`, `scenario`, `NN-step`)."""
        return EvidenceTarget(self, entity_id, location, step_id)

    def warn(self, message: str) -> None:
        """Records a warning (visible in `index.json`); never raises."""
        with self._lock:
            self._warnings.append({"capturedAt": _now(), "message": message})
            self._write_index()

    def _write_index(self) -> None:
        document = {
            "schemaVersion": INDEX_SCHEMA_VERSION,
            "runId": self.run_id,
            "startedAt": self.started_at,
            "entries": self._entries,
            "warnings": self._warnings,
        }
        try:
            _atomic_write(self.index_path, (json.dumps(document, indent=2) + "\n").encode())
        except Exception:  # evidence must not fail a run; warnings stay in memory
            pass

    def _unique(self, directory: str, filename: str) -> str:
        stem, dot, extension = filename.rpartition(".") if "." in filename else (filename, "", "")
        candidate = f"{directory}/{filename}"
        counter = 2
        while candidate in self._used:
            candidate = f"{directory}/{stem}-{counter}{dot}{extension}"
            counter += 1
        return candidate

    def save(
        self,
        target: EvidenceTarget,
        *,
        phase: Phase,
        source: str,
        name: str,
        data: bytes | str,
        ext: str,
        role: Role = "capture",
    ) -> str | None:
        """
        Writes one evidence file and indexes it.

        Text is masked first (see `redaction.py`) and written as UTF-8; bytes
        (screenshots) are written as given.

        @returns: The path relative to the run directory, or `None` when the
            write failed (a warning is recorded instead of raising).
        """
        try:
            kind, word = CHANNELS[source]
            if isinstance(data, str):
                masked = (
                    self.redactor.json_text(data) if ext == "json" else self.redactor.text(data)
                )
                data = masked.encode("utf8")
            prefix = "diff" if role == "diff" else phase
            filename = f"{prefix}-{word}-{safe_component(name)}.{ext.lstrip('.')}"
            with self._lock:
                directory = f"{safe_component(target.entity_id)}/{safe_component(target.location)}"
                relative = self._unique(directory, filename)
                _atomic_write(self.run_dir / relative, data)
                self._used.add(relative)
                self._entries.append(
                    {
                        "kind": kind,
                        "source": source,
                        "path": relative,
                        "capturedAt": _now(),
                        "phase": phase,
                        "role": role,
                        "entity": target.entity_id,
                        "step": target.step_id,
                        "bytes": len(data),
                        "sha256": hashlib.sha256(data).hexdigest(),
                    }
                )
                self._write_index()
                return relative
        except Exception as cause:
            self.warn(f"could not save {source} evidence {name!r}: {cause}")
            return None


@dataclass(frozen=True)
class EvidenceTarget:
    """Where one entity (a case, a scenario, one of its steps) saves its evidence."""

    store: EvidenceStore
    entity_id: str
    location: str
    step_id: str | None = None

    def for_step(self, directory: str, step_id: str) -> EvidenceTarget:
        """The same entity, narrowed to one step's directory (`NN-step-id`)."""
        return replace(self, location=directory, step_id=step_id)

    def save(
        self,
        *,
        phase: Phase,
        source: str,
        name: str,
        data: bytes | str,
        ext: str,
        role: Role = "capture",
    ) -> str | None:
        """Saves one file here; see `EvidenceStore.save`."""
        return self.store.save(
            self, phase=phase, source=source, name=name, data=data, ext=ext, role=role
        )


def open_evidence_store(
    run: dict[str, Any] | None,
    evidence_dir: str | os.PathLike[str] | None = None,
    redactor: Redactor | None = None,
) -> EvidenceStore | None:
    """
    Opens the store for a run, or returns `None` when evidence is disabled.

    @param run: The `run` template scope (`id`, `startedAt`); its id names the
        run directory.
    @param evidence_dir: Explicit root; falls back to `ATH_EVIDENCE_DIR`.
    @param redactor: Masking rules for everything written.
    """
    root = evidence_dir or os.environ.get(EVIDENCE_DIR_ENV)
    if not root:
        return None
    run = run or {}
    return EvidenceStore(
        root,
        str(run.get("id") or uuid.uuid4().hex[:8]),
        str(run.get("startedAt") or _now()),
        redactor,
    )
