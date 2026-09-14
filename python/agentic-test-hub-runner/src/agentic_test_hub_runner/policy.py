"""
The rules by which collected evidence becomes a verdict, mirroring
`packages/core/src/schema/policy.ts`.

Kept as a plain dict, not a dataclass: a manifest's `policy:` block is
already-validated data by the time a Python test runs (see `manifest.py`'s
own docs on why this package does not re-validate), and `evaluate_verdict`
only ever reads it by key.
"""

from __future__ import annotations

from typing import Any

VerdictPolicy = dict[str, Any]

DEFAULT_VERDICT_POLICY: VerdictPolicy = {
    "id": "default",
    "title": "Cross-checked evidence across client, service and data",
    "rules": {
        "nominal": {
            "screenshot": "matches_expectation",
            "browser_console": "clean",
            "browser_network": "success_response",
            "db_records": "expected_change",
            "app_log": "clean",
            "db_log": "clean",
        },
        "error": {
            "screenshot": "expected_error",
            "browser_console": "informational",
            "browser_network": "error_response",
            "db_records": "no_residual_change",
            "app_log": "expected_error",
            "db_log": "informational",
        },
    },
    "insufficientAlone": ["screenshot"],
    "nonWaivable": ["browser_console", "app_log", "db_records"],
}
