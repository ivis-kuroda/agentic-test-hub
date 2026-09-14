"""Runs `shell` operations, mirroring packages/runner/src/executor/shell.ts."""

from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path
from typing import Any

from ..template import render_deep
from ..types import ExecutionContext, ExecutionResult


class ShellExecutor:
    """
    Runs `shell` operations through `subprocess`, never a shell string: the
    command and its arguments are passed as a list, so an interpolated value
    reaches the process as one argument and cannot become syntax.
    """

    kind = "shell"

    def run(self, operation: dict[str, Any], context: ExecutionContext) -> ExecutionResult:
        rendered = render_deep(
            {"run": operation["run"], "env": operation.get("env", {}), "cwd": operation.get("cwd")},
            context.scopes,
        )
        run: list[str] = rendered["run"]
        if not run:
            raise ValueError("shell operation has an empty command")
        command, *args = run

        stdin_mode = operation.get("stdin", "none")
        stdin_data = json.dumps(context.scopes.get("param") or {}) if stdin_mode == "json" else None

        cwd = (
            context.root
            if rendered.get("cwd") is None
            else str(Path(context.root) / rendered["cwd"])
        )
        env = {**os.environ, **rendered["env"]}
        timeout_ms = operation.get("timeoutMs", 120_000)

        started = time.monotonic()
        try:
            completed = subprocess.run(
                [command, *args],
                cwd=cwd,
                env=env,
                input=stdin_data,
                capture_output=True,
                text=True,
                timeout=timeout_ms / 1000,
            )
            return ExecutionResult(
                operation=command,
                ok=True,
                duration_ms=(time.monotonic() - started) * 1000,
                exit_code=completed.returncode,
                stdout=completed.stdout,
                stderr=completed.stderr,
            )
        except subprocess.TimeoutExpired:
            return ExecutionResult(
                operation=command,
                ok=False,
                duration_ms=(time.monotonic() - started) * 1000,
                failure=f"command did not finish within {timeout_ms}ms",
            )
        except OSError as cause:
            return ExecutionResult(
                operation=command,
                ok=False,
                duration_ms=(time.monotonic() - started) * 1000,
                failure=f"command could not be run: {cause}",
            )
