"""A plugin manifest and spec fixtures for the live evidence tests (no real target)."""

from __future__ import annotations

from typing import Any

PLUGIN: dict[str, Any] = {
    "apiVersion": "1",
    "name": "live-service",
    "connections": {
        "api": {"kind": "http", "baseUrl": "{{env.APP_URL}}"},
        "ui": {"kind": "browser", "baseUrl": "{{env.APP_URL}}"},
    },
    "operations": {
        "OP-SEND": {
            "executor": "http",
            "connection": "api",
            "method": "POST",
            "path": "/notifications",
            "params": ["recipient"],
            "headers": {"Authorization": "Bearer {{env.LIVE_TOKEN}}"},
            "body": {"recipient": "{{param.recipient}}"},
        },
        "OP-READ-LOGS": {"executor": "http", "connection": "api", "path": "/logs"},
        "OP-READ-DB-LOG": {"executor": "http", "connection": "api", "path": "/dblog"},
        "OP-LIST": {"executor": "http", "connection": "api", "path": "/notifications"},
        "OP-OPEN": {
            "executor": "browser",
            "connection": "ui",
            "steps": [
                {"action": "goto", "url": "{{env.APP_URL}}/"},
                {"action": "waitFor", "selector": "[data-testid=heading]"},
            ],
        },
        "OP-COMPOSE": {
            "executor": "browser",
            "connection": "ui",
            "params": ["recipient"],
            "steps": [
                {"action": "goto", "url": "{{env.APP_URL}}/"},
                {
                    "action": "fill",
                    "selector": "[data-testid=recipient]",
                    "value": "{{param.recipient}}",
                },
                {"action": "click", "selector": "[data-testid=submit]"},
                {"action": "waitFor", "selector": "text=status 201"},
            ],
        },
    },
    "evidence": {
        "app_log": {"operation": "OP-READ-LOGS"},
        "db_log": {"operation": "OP-READ-DB-LOG"},
        "db_records": {"operation": "OP-LIST"},
    },
    "policy": {
        "id": "live-app-log-only",
        "title": "judged on the application log alone",
        "rules": {
            "nominal": {
                "screenshot": "informational",
                "browser_console": "informational",
                "browser_network": "informational",
                "db_records": "informational",
                "app_log": "clean",
                "db_log": "informational",
            },
            "error": {
                "screenshot": "informational",
                "browser_console": "informational",
                "browser_network": "informational",
                "db_records": "informational",
                "app_log": "expected_error",
                "db_log": "informational",
            },
        },
    },
}

BASELINE: dict[str, Any] = {
    "id": "BL-LIVE",
    "title": "the standard request",
    "target": {"surface": "Live API", "action": "send a notification"},
    "preconditions": [],
    "config": {},
    "context": {"body": {"recipient": "someone@example.invalid"}},
    "action": {"operation": "OP-SEND", "params": {}},
}


def make_case(**fields: Any) -> dict[str, Any]:
    """A nominal case on `BL-LIVE` expecting 201."""
    return {
        "id": "TC-LIVE-001",
        "summary": "the standard request is accepted",
        "baseline": "BL-LIVE",
        "overrides": [],
        "expect": [{"kind": "http_status", "status": 201, "viewpoints": []}],
        "polarity": "nominal",
        "evidenceWaivers": [],
        "priority": "P1",
        "tags": [],
        "automation": {"status": "manual"},
        "viewpoints": [],
        **fields,
    }
