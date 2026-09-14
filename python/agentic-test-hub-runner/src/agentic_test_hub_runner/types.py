"""
Everything an executor needs besides the operation itself, mirroring
`packages/runner/src/executor/types.ts`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from .manifest import Manifest


@dataclass(frozen=True)
class ExecutionContext:
    """Everything an executor needs besides the operation itself."""

    manifest: Manifest
    """The loaded manifest, for resolving connections."""
    scopes: dict[str, Any] = field(default_factory=dict)
    """Values available to interpolation (`env`/`param`/`step`)."""
    root: str = "."
    """Plugin repository root, which relative paths are resolved against."""


@dataclass(frozen=True)
class ExecutionResult:
    """
    What running an operation produced.

    `ok` reports whether the operation *completed*, not whether the test
    passed. A request that returns 404 completed: `ok` is true and `status`
    is 404. A request whose host does not resolve did not: `ok` is false.
    """

    operation: str
    ok: bool
    duration_ms: float
    exit_code: int | None = None
    status: int | None = None
    stdout: str | None = None
    stderr: str | None = None
    body: Any = None
    rows: list[dict[str, Any]] | None = None
    failure: str | None = None


class Executor(Protocol):
    """Runs one kind of operation."""

    kind: str

    def run(self, operation: dict[str, Any], context: ExecutionContext) -> ExecutionResult:
        """Runs the operation, reporting failure through `ExecutionResult.ok`
        rather than raising — raising is reserved for programming errors."""
        ...


class ExecutorError(Exception):
    """Raised when an operation cannot be attempted at all."""

    def __init__(self, message: str, operation: str) -> None:
        super().__init__(message)
        self.operation = operation
