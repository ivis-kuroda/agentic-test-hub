"""Runs `sql` operations, mirroring packages/runner/src/executor/sql.ts."""

from __future__ import annotations

import time
from typing import Any, Protocol

from ..template import render_deep
from ..types import ExecutionContext, ExecutionResult, ExecutorError

Row = dict[str, Any]


class QueryFn(Protocol):
    """How a query is run. Injected rather than tied to a driver, same as
    the TypeScript original — no generic Postgres client is assumed."""

    def __call__(self, connection_url: str, query: str, *, timeout_s: float) -> list[Row]: ...


class SqlExecutor:
    """Runs `sql` operations.

    @param query_fn: How to run a query against a connection string. There
        is no default — a caller who needs real database access must supply
        one, the same reason generation refuses `sql` operations in v1.
    """

    kind = "sql"

    def __init__(self, query_fn: QueryFn) -> None:
        self._query_fn = query_fn

    def run(self, operation: dict[str, Any], context: ExecutionContext) -> ExecutionResult:
        connection = context.manifest.connections.get(operation["connection"])
        if connection is None or connection.get("kind") != "postgres":
            raise ExecutorError(
                f'connection "{operation["connection"]}" is not a database connection',
                operation["connection"],
            )

        rendered = render_deep(
            {"url": connection["url"], "query": operation["query"]}, context.scopes
        )

        started = time.monotonic()
        try:
            rows = self._query_fn(
                rendered["url"],
                rendered["query"],
                timeout_s=operation.get("timeoutMs", 60_000) / 1000,
            )
            return ExecutionResult(
                operation=operation["connection"],
                ok=True,
                duration_ms=(time.monotonic() - started) * 1000,
                rows=list(rows),
            )
        except Exception as cause:  # any failed query is a result, not a crash
            return ExecutionResult(
                operation=operation["connection"],
                ok=False,
                duration_ms=(time.monotonic() - started) * 1000,
                failure=f"query did not complete: {cause}",
            )
