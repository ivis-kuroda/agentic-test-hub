"""
Executors available to a run, keyed by the operation kind they handle.
Mirrors `packages/runner/src/executor/registry.ts`.
"""

from __future__ import annotations

from dataclasses import replace
from typing import Any

from .types import ExecutionContext, ExecutionResult, Executor, ExecutorError


class ExecutorRegistry:
    """Executors available to a run, keyed by the operation kind they handle."""

    def __init__(self) -> None:
        self._executors: dict[str, Executor] = {}

    def register(self, executor: Executor) -> ExecutorRegistry:
        """Registers an executor, replacing any previous one for its kind."""
        self._executors[executor.kind] = executor
        return self

    def supports(self, kind: str) -> bool:
        """Reports whether a kind of operation can be run."""
        return kind in self._executors

    def run(
        self, operation_id: str, params: dict[str, Any], context: ExecutionContext
    ) -> ExecutionResult:
        """
        Runs a declared operation by id.

        Arguments are placed in the `param` scope, so a manifest refers to
        them as `{{param.name}}` regardless of how the operation is invoked.

        @raises ExecutorError: When the operation or its executor is
            unavailable, or a declared param is missing.
        """
        operation = context.manifest.operations.get(operation_id)
        if operation is None:
            raise ExecutorError(
                f'operation {operation_id} is not declared by plugin "{context.manifest.name}"',
                operation_id,
            )

        executor = self._executors.get(operation["executor"])
        if executor is None:
            raise ExecutorError(
                f"no executor is registered for {operation['executor']} operations", operation_id
            )

        declared: list[str] = operation.get("params", [])
        missing = [name for name in declared if name not in params]
        if missing:
            raise ExecutorError(
                f"operation {operation_id} needs {', '.join(missing)}", operation_id
            )

        merged_param = {**(context.scopes.get("param") or {}), **params}
        merged_context = replace(context, scopes={**context.scopes, "param": merged_param})

        result = executor.run(operation, merged_context)
        return replace(result, operation=operation_id)
