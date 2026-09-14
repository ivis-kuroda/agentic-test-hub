"""Runs `http` operations, mirroring packages/runner/src/executor/http.ts."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import httpx

from ..template import render_deep
from ..types import ExecutionContext, ExecutionResult, ExecutorError


class HttpExecutor:
    """Runs `http` operations.

    @param client: An `httpx.Client` to send requests through. Defaults to a
        real client; tests pass one built on `httpx.MockTransport`.
    """

    kind = "http"

    def __init__(self, client: httpx.Client | None = None) -> None:
        self._client = client or httpx.Client()

    def run(self, operation: dict[str, Any], context: ExecutionContext) -> ExecutionResult:
        connection = context.manifest.connections.get(operation["connection"])
        if connection is None or connection.get("kind") != "http":
            raise ExecutorError(
                f'connection "{operation["connection"]}" is not an http connection',
                operation["connection"],
            )

        rendered = render_deep(
            {
                "baseUrl": connection["baseUrl"],
                "path": operation["path"],
                "headers": {**connection.get("headers", {}), **operation.get("headers", {})},
                "body": operation.get("body"),
            },
            context.scopes,
        )

        payload: str | None = None
        body_file = operation.get("bodyFile")
        body_param = operation.get("bodyParam")
        if body_file is not None:
            payload = (Path(context.root) / body_file).read_text("utf8")
        elif body_param is not None:
            # Uses the param's value directly, unrendered - render_deep only
            # ever substitutes into text (see template.py's render), which
            # cannot express splicing a whole structured value into a body
            # position. Mirrors packages/runner/src/executor/http.ts.
            params = context.scopes.get("param") or {}
            if body_param not in params:
                raise ExecutorError(
                    f'operation needs param "{body_param}" for its body', operation["connection"]
                )
            payload = json.dumps(params[body_param])
        elif rendered["body"] is not None:
            body = rendered["body"]
            payload = body if isinstance(body, str) else json.dumps(body)

        method = operation.get("method", "GET")
        url = f"{rendered['baseUrl'].rstrip('/')}/{rendered['path'].lstrip('/')}"
        headers = dict(rendered["headers"])
        if payload is not None and "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"

        started = time.monotonic()
        try:
            response = self._client.request(
                method,
                url,
                headers=headers,
                content=payload,
                timeout=operation.get("timeoutMs", 60_000) / 1000,
            )
            text = response.text
            try:
                body_value: Any = response.json() if text else None
            except ValueError:
                body_value = text or None
            return ExecutionResult(
                operation=f"{method} {url}",
                ok=True,
                duration_ms=(time.monotonic() - started) * 1000,
                status=response.status_code,
                body=body_value,
                stdout=text,
            )
        except httpx.HTTPError as cause:
            return ExecutionResult(
                operation=f"{method} {url}",
                ok=False,
                duration_ms=(time.monotonic() - started) * 1000,
                failure=f"request did not complete: {cause}",
            )
