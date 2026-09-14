"""
Runs `extension` operations — the capability this Python package adds that
has no TypeScript counterpart: a plugin's own Python module, imported and
called directly, so a generated test can reuse the target's real SQLAlchemy
models or Elasticsearch client in-process instead of going through a generic
operation shape. `packages/plugin`'s schema already declares this executor
kind (`operation.handler`); this is its first runtime implementation.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any

from ..types import ExecutionContext, ExecutionResult, ExecutorError

Handler = Callable[[dict[str, Any], ExecutionContext], ExecutionResult | dict[str, Any]]


class ExtensionExecutor:
    """
    Runs `extension` operations by calling a handler function the plugin's
    own extension module exports.

    A handler is called as `handler(params, context)` and returns either an
    `ExecutionResult` directly, or a plain dict with the same fields (`ok`
    is required; `status`/`rows`/`stdout`/`body`/`failure` as applicable) —
    `operation`/`duration_ms` are filled in from the call itself when a dict
    omits them. This is the one contract this package adds to the plugin
    model: an `extension` operation's handler is real Python running
    in-process, not a request/response shape the hub interprets generically.

    @param module: The plugin's extension module (imported by the generated
        test, per its own `--python-extensions-module`), exposing one
        function per declared `handler` name. Typed `Any` rather than
        `ModuleType`: only `getattr` is ever used, so any object exposing
        the right names works, real module or test double alike.
    """

    kind = "extension"

    def __init__(self, module: Any) -> None:
        self._module = module

    def run(self, operation: dict[str, Any], context: ExecutionContext) -> ExecutionResult:
        handler_name = operation["handler"]
        handler: Handler | None = getattr(self._module, handler_name, None)
        if handler is None or not callable(handler):
            raise ExecutorError(
                f'extension module has no handler named "{handler_name}"', handler_name
            )

        params = context.scopes.get("param") or {}
        started = time.monotonic()
        outcome = handler(params, context)

        if isinstance(outcome, ExecutionResult):
            return outcome

        data = dict(outcome)
        data.setdefault("operation", handler_name)
        data.setdefault("duration_ms", (time.monotonic() - started) * 1000)
        return ExecutionResult(**data)
