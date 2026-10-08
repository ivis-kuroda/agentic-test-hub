"""
Reading dotted paths out of an `ExecutionResult`, mirroring
`getResultAtPath` in `packages/runner/src/assert.ts`.

One reader serves both an assertion's `at` and a scenario step's `produces`,
so the two never disagree about what a path means.
"""

from __future__ import annotations

import dataclasses
import re
from typing import Any

from .types import ExecutionResult

_ABSENT: tuple[bool, Any] = (False, None)


def _snake_case(name: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()


def get_result_at_path(result: ExecutionResult, path: str) -> tuple[bool, Any]:
    """
    Reads a dotted path such as `body.error` or `headers.location`.

    The first segment names an `ExecutionResult` field and may be written in
    camelCase (`durationMs`, as in YAML) or snake_case (`duration_ms`). Later
    segments are plain mapping keys; the one after `headers` is lower-cased,
    since response header names are stored lower-cased.

    @returns `(present, value)`; `present` is False when any segment is missing.
    """
    first, *rest = path.split(".")
    field_name = _snake_case(first)
    if field_name not in {f.name for f in dataclasses.fields(result)}:
        return _ABSENT
    current: Any = getattr(result, field_name)
    if field_name == "headers" and rest:
        rest[0] = rest[0].lower()
    for segment in rest:
        if not isinstance(current, dict) or segment not in current:
            return _ABSENT
        current = current[segment]
    return True, current
