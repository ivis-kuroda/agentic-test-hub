"""
Executors available to a run, keyed by the operation kind they handle.
Mirrors `packages/runner/src/executor/registry.ts`.
"""

from __future__ import annotations

from dataclasses import replace
from typing import Any

from .template import TemplateError, render_deep
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

        Arguments are rendered, then placed in the `param` scope, so a manifest
        refers to them as `{{param.name}}` regardless of how the operation is
        invoked. Rendering uses the context's own scopes (`env`, `step`, `run`
        and any `param` already present), so a spec can pass
        `token: "{{env.TOKEN}}"` or `recid: "{{step.recid}}"`. A string that is
        a single placeholder keeps a structured value as it is.

        @raises ExecutorError: When the operation or its executor is
            unavailable, a declared param is missing, or a placeholder in a
            param cannot be resolved (the message names operation, param and
            placeholder).
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
        optional = set(operation.get("optionalParams", []))
        missing = [name for name in declared if name not in optional and name not in params]
        if missing:
            raise ExecutorError(
                f"operation {operation_id} needs {', '.join(missing)}", operation_id
            )

        rendered: dict[str, Any] = {}
        for name, value in params.items():
            try:
                rendered[name] = render_deep(value, context.scopes)
            except TemplateError as cause:
                raise ExecutorError(
                    f'operation {operation_id}: param "{name}": {cause}',
                    operation_id,
                ) from cause

        merged_param = {**(context.scopes.get("param") or {}), **rendered}
        merged_context = replace(context, scopes={**context.scopes, "param": merged_param})

        # Executors that save evidence name their files after the operation id.
        result = executor.run({**operation, "id": operation_id}, merged_context)
        return replace(result, operation=operation_id)

    def browser_session(self) -> Any | None:
        """
        The live browser session an executor is holding for evidence (the last
        one a `browser` operation opened), or `None`. Never opened here.
        """
        for executor in self._executors.values():
            offer = getattr(executor, "browser_session", None)
            session = offer() if callable(offer) else None
            if session is not None:
                return session
        return None

    def close_all(self) -> None:
        """Closes everything executors still hold open (browser sessions).
        Idempotent; `run_case`/`run_scenario` call it when a run ends."""
        for executor in self._executors.values():
            close = getattr(executor, "close_all", None)
            if callable(close):
                close()
