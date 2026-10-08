"""Runs `http` operations, mirroring packages/runner/src/executor/http.ts."""

from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any

import httpx

from ..evidence_store import EvidenceTarget
from ..template import render, render_deep
from ..types import ExecutionContext, ExecutionResult, ExecutorError

_PARAM_REFERENCE = re.compile(r"\{\{\s*param\.([A-Za-z0-9_-]+)[A-Za-z0-9_.-]*\s*\}\}")


def _references_absent_optional(
    texts: list[str], operation: dict[str, Any], context: ExecutionContext
) -> bool:
    """Whether any template names an optional param that is absent.

    Such a header or multipart part is left out of the request rather than
    failing the render; an absent param not listed in `optionalParams` still
    raises when rendered.
    """
    optional = set(operation.get("optionalParams", []))
    given = context.scopes.get("param") or {}
    return any(
        name in optional and given.get(name) is None
        for text in texts
        for name in _PARAM_REFERENCE.findall(text)
    )


MAX_BODY_BYTES = 1024 * 1024
"""How much of a response body an exchange record keeps."""


def _describe_multipart(files: list[tuple[str, tuple[Any, ...]]]) -> list[dict[str, Any]]:
    """Part names, filenames, content types and sizes — never the bytes."""
    described: list[dict[str, Any]] = []
    for name, part in files:
        filename, content = part[0], part[1]
        content_type = part[2] if len(part) > 2 else None
        described.append(
            {
                "name": name,
                "filename": None if filename is None else str(filename),
                "contentType": content_type,
                "bytes": len(content.encode("utf8") if isinstance(content, str) else content),
            }
        )
    return described


def _parsed_or_text(text: str) -> Any:
    try:
        return json.loads(text)
    except ValueError:
        return text


def _record_exchange(
    target: EvidenceTarget,
    operation_id: str,
    request: dict[str, Any],
    response: httpx.Response | None,
    duration_ms: float,
    failure: str | None,
) -> None:
    """Saves one request/response as kind-2 `network` evidence; never raises."""
    try:
        redactor = target.store.redactor
        record: dict[str, Any] = {
            "operation": operation_id,
            "method": request["method"],
            "url": request["url"],
            "durationMs": round(duration_ms, 1),
            "request": {
                "headers": redactor.headers(request["headers"]),
                "body": None if request["body"] is None else _parsed_or_text(request["body"]),
                "multipart": request["multipart"],
            },
            "response": None,
            "failure": failure,
        }
        if response is not None:
            text = response.text
            kept = text[:MAX_BODY_BYTES]
            record["response"] = {
                "status": response.status_code,
                "headers": redactor.headers(dict(response.headers.items())),
                "body": _parsed_or_text(kept) if text == kept else kept,
                "truncated": text != kept,
            }
        target.save(
            phase="during",
            source="http_exchange",
            name=f"http-{operation_id}",
            data=json.dumps(record, indent=2, ensure_ascii=False),
            ext="json",
        )
    except Exception as cause:
        target.store.warn(f"could not record the http exchange of {operation_id}: {cause}")


class _EmptyFilename(str):
    """An empty filename that httpx still announces as `filename=""`.

    httpx treats a falsy filename as "not a file upload" and drops the
    parameter. A plugin can legitimately need the empty form on the wire (to
    see how a service reacts to it), so this subclass stays truthy while
    rendering as "". `test_http.py` pins the wire output, so an httpx change
    shows up as a failing test rather than a silently different request.
    """

    def __bool__(self) -> bool:
        return True


def _multipart_files(
    operation: dict[str, Any], context: ExecutionContext
) -> list[tuple[str, tuple[Any, ...]]]:
    """Builds httpx's `files=` list from the operation's `multipart` parts.

    Every part goes through `files=` (a plain value as `(None, text)`) so
    order and repeated field names survive; httpx then writes the boundary
    and the `Content-Type` header itself.
    """
    parts: list[tuple[str, tuple[Any, ...]]] = []
    for part in operation["multipart"]:
        fields = [
            part[key] for key in ("name", "file", "value", "filename", "contentType") if key in part
        ]
        if _references_absent_optional(
            [field for field in fields if isinstance(field, str)], operation, context
        ):
            continue
        name = render(part["name"], context.scopes)
        content_type = part.get("contentType")
        if content_type is not None:
            content_type = render(content_type, context.scopes)
        if ("file" in part) == ("value" in part):
            raise ExecutorError(
                f'multipart part "{name}" needs exactly one of file or value',
                operation["connection"],
            )
        if "file" in part:
            relative = render(part["file"], context.scopes)
            path = Path(context.root) / relative
            filename = (
                render(part["filename"], context.scopes)
                if "filename" in part
                else os.path.basename(relative)
            )
            if filename == "":
                filename = _EmptyFilename()
            content = path.read_bytes()
            parts.append(
                (name, (filename, content, content_type) if content_type else (filename, content))
            )
        else:
            value = render(part["value"], context.scopes)
            parts.append((name, (None, value, content_type) if content_type else (None, value)))
    return parts


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

        multipart = operation.get("multipart")
        if multipart is not None and (
            operation.get("body") is not None or operation.get("bodyFile") is not None
        ):
            raise ExecutorError(
                "multipart cannot be combined with body or bodyFile", operation["connection"]
            )

        sent_headers = {
            name: value
            for name, value in {
                **connection.get("headers", {}),
                **operation.get("headers", {}),
            }.items()
            if not _references_absent_optional([value], operation, context)
        }
        rendered = render_deep(
            {
                "baseUrl": connection["baseUrl"],
                "path": operation["path"],
                "headers": sent_headers,
                "body": operation.get("body"),
            },
            context.scopes,
        )

        files = _multipart_files(operation, context) if multipart is not None else None

        payload: str | None = None
        body_file = operation.get("bodyFile")
        if body_file is not None:
            payload = (Path(context.root) / body_file).read_text("utf8")
        elif rendered["body"] is not None:
            body = rendered["body"]
            payload = body if isinstance(body, str) else json.dumps(body)

        method = operation.get("method", "GET")
        url = f"{rendered['baseUrl'].rstrip('/')}/{rendered['path'].lstrip('/')}"
        headers = dict(rendered["headers"])
        if files is not None:
            # httpx must write the multipart boundary into Content-Type, so
            # any Content-Type configured for a non-multipart request is dropped.
            headers = {k: v for k, v in headers.items() if k.lower() != "content-type"}
        elif payload is not None and "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"

        recorded = {
            "method": method,
            "url": url,
            "headers": headers,
            "body": payload if files is None else None,
            "multipart": None if files is None else _describe_multipart(files),
        }
        operation_id = operation.get("id", operation["connection"])
        started = time.monotonic()
        try:
            response = self._client.request(
                method,
                url,
                headers=headers,
                content=payload,
                files=files,
                timeout=operation.get("timeoutMs", 60_000) / 1000,
            )
            if context.evidence is not None:
                try:  # the wire headers include what the client added itself
                    recorded["headers"] = dict(response.request.headers.items())
                except RuntimeError:  # a response without its request (test doubles)
                    pass
                _record_exchange(
                    context.evidence,
                    operation_id,
                    recorded,
                    response,
                    (time.monotonic() - started) * 1000,
                    None,
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
                headers={name.lower(): value for name, value in response.headers.items()},
                body=body_value,
                stdout=text,
            )
        except httpx.HTTPError as cause:
            if context.evidence is not None:
                _record_exchange(
                    context.evidence,
                    operation_id,
                    recorded,
                    None,
                    (time.monotonic() - started) * 1000,
                    f"request did not complete: {cause}",
                )
            return ExecutionResult(
                operation=f"{method} {url}",
                ok=False,
                duration_ms=(time.monotonic() - started) * 1000,
                failure=f"request did not complete: {cause}",
            )
