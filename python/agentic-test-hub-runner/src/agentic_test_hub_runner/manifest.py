"""
Loading a plugin manifest for run time only.

Unlike `packages/plugin/src/load.ts`'s `loadManifest`, this performs no
schema validation and no integrity check (dangling connection references,
`extension` operations needing `extensionModule`, and so on). By the time a
Python test is generated, the manifest has already gone through the
TypeScript CLI's validated load — this module's own job is only to give the
executors dict-shaped access to the same data at run time, not to
re-establish that the manifest is well formed. Re-validating here would be
the one place this package would have re-implemented schema logic the plan
deliberately keeps TypeScript-only.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import yaml


@dataclass(frozen=True)
class Manifest:
    """A plugin manifest's run-time-relevant contents."""

    name: str
    connections: dict[str, dict[str, Any]]
    operations: dict[str, dict[str, Any]]
    states: dict[str, dict[str, Any]]
    evidence: dict[str, dict[str, Any]]
    policy: dict[str, Any] | None
    extension_module: str | None


def load_manifest(source: str) -> Manifest:
    """Parses a plugin manifest's YAML into run-time-accessible data.

    @param source: Manifest text, in YAML.
    @returns: The manifest's operations, connections, states, evidence
        collectors and policy, ready for `ExecutorRegistry`/`run_case`.
    """
    raw: dict[str, Any] = yaml.safe_load(source) or {}
    return Manifest(
        name=raw["name"],
        connections=raw.get("connections") or {},
        operations=raw.get("operations") or {},
        states=raw.get("states") or {},
        evidence=raw.get("evidence") or {},
        policy=raw.get("policy"),
        extension_module=raw.get("extensionModule"),
    )
