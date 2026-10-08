"""
Giving a run its `run` template scope, mirroring
`packages/runner/src/run-scope.ts`.
"""

from __future__ import annotations

import os
import uuid
from dataclasses import replace
from datetime import UTC, datetime

from .evidence_store import open_evidence_store
from .types import ExecutionContext


def with_run_scope(context: ExecutionContext) -> ExecutionContext:
    """
    Gives a context a `run` template scope, unless the caller supplied one.

    `run_case`/`run_scenario` call this once at the start of a run so every
    operation, state provider and evidence collector sees the same
    `{{run.startedAt}}` (UTC ISO-8601, seconds precision, with `Z`) and
    `{{run.id}}` (a short identifier). An evidence collector can then ask
    for "logs since this run began" without the hub knowing what produces
    the logs.
    """
    if "run" in context.scopes:
        return context
    started_at = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    run = {"startedAt": started_at, "id": uuid.uuid4().hex[:8]}
    return replace(context, scopes={**context.scopes, "run": run})


def with_evidence_target(
    context: ExecutionContext,
    evidence_dir: str | os.PathLike[str] | None,
    entity_id: str,
    location: str,
) -> ExecutionContext:
    """
    Points a context at the evidence store of its run, unless it already has a
    target or evidence is disabled (no `evidence_dir` and no
    `ATH_EVIDENCE_DIR`). Call after `with_run_scope`: the run's id names the
    run directory.
    """
    if context.evidence is not None:
        return context
    store = open_evidence_store(context.scopes.get("run"), evidence_dir)
    if store is None:
        return context
    return replace(context, evidence=store.at(entity_id, location))
