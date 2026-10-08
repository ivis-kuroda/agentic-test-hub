"""
Masking secrets before evidence reaches the disk.

Saved evidence is passed around for review, so it must not carry credentials.
The rules, applied to everything written by the evidence store:

- Header values are masked when the header name (case-insensitive) is
  `Authorization`, `Cookie`, `Set-Cookie`, `Proxy-Authorization` or
  `X-API-Key`, or fully matches a regex in the manifest's `redact.headers`.
- `Bearer <token>` / `Basic <token>` credentials are masked wherever they
  appear in text (log lines, bodies, header values).
- Every match of a regex in the manifest's `redact.patterns` is masked in
  text (bodies and header values).
- Any secret value the run actually sent in a masked header is remembered, and
  every literal occurrence of it in later text is masked too, so a service
  that logs the bare token is covered.

The masked value is `***REDACTED***`. The in-memory `ExecutionResult` is never
altered; only what is written to disk is.
"""

from __future__ import annotations

import json
import re
import threading
from collections.abc import Iterable, Mapping
from typing import Any

REDACTED = "***REDACTED***"

DEFAULT_SENSITIVE_HEADERS = frozenset(
    {"authorization", "cookie", "set-cookie", "proxy-authorization", "x-api-key"}
)

_CREDENTIAL = re.compile(r"\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+", re.IGNORECASE)

_MIN_LEARNED_LENGTH = 6


def _compile(patterns: Iterable[str], flags: int = 0) -> list[re.Pattern[str]]:
    compiled: list[re.Pattern[str]] = []
    for pattern in patterns:
        try:
            compiled.append(re.compile(pattern, flags))
        except re.error:
            continue  # the TypeScript schema already rejected non-regexes
    return compiled


class Redactor:
    """Applies the masking rules above. Safe to share between threads."""

    def __init__(self, headers: Iterable[str] = (), patterns: Iterable[str] = ()) -> None:
        self._header_patterns = _compile(headers, re.IGNORECASE)
        self._patterns = _compile(patterns)
        self._learned: set[str] = set()
        self._lock = threading.Lock()

    @classmethod
    def from_manifest(cls, redact: Mapping[str, Any] | None) -> Redactor:
        """Builds the redactor for a manifest's optional `redact` section."""
        redact = redact or {}
        return cls(redact.get("headers") or [], redact.get("patterns") or [])

    def is_sensitive_header(self, name: str) -> bool:
        """Whether a header's value must be masked."""
        lowered = name.lower()
        return lowered in DEFAULT_SENSITIVE_HEADERS or any(
            pattern.fullmatch(name) for pattern in self._header_patterns
        )

    def _learn(self, value: str) -> None:
        parts = value.split(None, 1)
        secret = parts[1] if len(parts) == 2 and parts[0].lower() in ("bearer", "basic") else value
        for candidate in {value, secret}:
            if len(candidate) >= _MIN_LEARNED_LENGTH:
                with self._lock:
                    self._learned.add(candidate)

    def headers(self, headers: Mapping[str, str]) -> dict[str, str]:
        """Headers with sensitive values replaced; others have patterns applied."""
        masked: dict[str, str] = {}
        for name, value in headers.items():
            if self.is_sensitive_header(name):
                self._learn(value)
                masked[name] = REDACTED
            else:
                masked[name] = self.text(value)
        return masked

    def text(self, text: str) -> str:
        """Text with credentials, learned secrets and declared patterns masked."""
        text = _CREDENTIAL.sub(lambda match: f"{match.group(1)} {REDACTED}", text)
        with self._lock:
            learned = sorted(self._learned, key=len, reverse=True)
        for secret in learned:
            text = text.replace(secret, REDACTED)
        for pattern in self._patterns:
            text = pattern.sub(REDACTED, text)
        return text

    def json_text(self, raw: str) -> str:
        """
        `raw` (JSON text) with masking applied to its string values, so a
        pattern can never break the JSON. Falls back to plain text masking
        when `raw` does not parse.
        """
        try:
            parsed = json.loads(raw)
        except ValueError:
            return self.text(raw)
        return json.dumps(self._walk(parsed), indent=2, ensure_ascii=False)

    def _walk(self, value: Any) -> Any:
        if isinstance(value, str):
            return self.text(value)
        if isinstance(value, list):
            return [self._walk(item) for item in value]
        if isinstance(value, dict):
            return {key: self._walk(item) for key, item in value.items()}
        return value
