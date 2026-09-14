"""
Turning what an operation (or a live browser session) produced into
`Observation`s, mirroring `packages/runner/src/evidence.ts`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Protocol

from .types import ExecutionResult
from .verdict import EvidenceSource, Observation

_PROBLEM = re.compile(
    r"\b(error|exception|traceback|fatal|critical|constraint violation)\b", re.IGNORECASE
)

COLLECTED_BY_OPERATION: tuple[EvidenceSource, ...] = ("db_records", "app_log", "db_log")


@dataclass(frozen=True)
class ObserveOptions:
    ignore: list[str] = field(default_factory=list)


def _compile(patterns: list[str]) -> list[re.Pattern[str]]:
    compiled: list[re.Pattern[str]] = []
    for pattern in patterns:
        try:
            compiled.append(re.compile(pattern))
        except re.error:
            continue
    return compiled


def observe_from_result(
    source: EvidenceSource, result: ExecutionResult, options: ObserveOptions | None = None
) -> Observation:
    """
    Reads a channel gathered by running an operation (`db_records`/`app_log`/
    `db_log`), scanning its output for words that mark a problem.
    """
    options = options or ObserveOptions()
    if not result.ok:
        return Observation(source, collected=False, errors=[result.failure or "collection failed"])

    text = "\n".join(part for part in (result.stdout or "", result.stderr or "") if part)
    lines = [line for line in text.split("\n") if line.strip()]
    problems = [line for line in lines if _PROBLEM.search(line)]

    patterns = _compile(options.ignore)
    kept = [line for line in problems if not any(pattern.search(line) for pattern in patterns)]
    suppressed = len(problems) - len(kept)

    return Observation(source, collected=True, errors=kept, suppressed=suppressed)


class ConsoleMessage(Protocol):
    level: str
    text: str
    location: str | None


class NetworkExchange(Protocol):
    method: str
    url: str
    status: int
    failed: bool | None


class BrowserSession(Protocol):
    """The two evidence channels a live browser session supplies directly —
    they exist only while a page is open, so they cannot come from running
    an operation the way `observe_from_result`'s channels do."""

    def console_messages(self) -> list[ConsoleMessage]: ...

    def network_exchanges(self) -> list[NetworkExchange]: ...


def observe_browser(
    session: BrowserSession, options: ObserveOptions | None = None
) -> list[Observation]:
    """Reads the two channels that exist only while a page is open."""
    options = options or ObserveOptions()
    patterns = _compile(options.ignore)

    console_errors = [
        message for message in session.console_messages() if message.level in ("error", "warn")
    ]
    kept_console = [
        message
        for message in console_errors
        if not any(
            pattern.search(f"{message.text} {message.location or ''}") for pattern in patterns
        )
    ]
    suppressed_console = len(console_errors) - len(kept_console)

    exchanges = session.network_exchanges()
    network_failures = [
        exchange
        for exchange in exchanges
        if getattr(exchange, "failed", False) or exchange.status >= 500
    ]
    kept_network = [
        exchange
        for exchange in network_failures
        if not any(pattern.search(exchange.url) for pattern in patterns)
    ]
    suppressed_network = len(network_failures) - len(kept_network)

    mutations = [exchange for exchange in exchanges if exchange.method not in ("GET", "HEAD")]
    primary = mutations[-1] if mutations else (exchanges[-1] if exchanges else None)

    return [
        Observation(
            "browser_console",
            collected=True,
            errors=[f"{message.level}: {message.text}" for message in kept_console],
            suppressed=suppressed_console,
        ),
        Observation(
            "browser_network",
            collected=True,
            errors=[
                f"{exchange.method} {exchange.url} -> {exchange.status}"
                for exchange in kept_network
            ],
            suppressed=suppressed_network,
            status=primary.status if primary is not None else None,
        ),
    ]
