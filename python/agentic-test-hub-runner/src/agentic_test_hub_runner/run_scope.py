"""
Giving a run its `run` template scope, mirroring
`packages/runner/src/run-scope.ts`.
"""

from __future__ import annotations

import uuid
from dataclasses import replace
from datetime import UTC, datetime

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
