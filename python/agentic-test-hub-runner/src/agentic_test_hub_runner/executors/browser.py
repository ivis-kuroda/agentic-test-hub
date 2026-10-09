"""
Runs `browser` operations, mirroring `packages/runner/src/executor/browser.ts`
and `packages/runner/src/driver/playwright.ts` combined — Python needs no
separate driver interface split across two files the way the TypeScript
package does, since `PlaywrightDriver` here is the only driver a generated
Python test ever uses.
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Protocol

from ..template import render_deep
from ..types import ExecutionContext, ExecutionResult, ExecutorError


@dataclass(frozen=True)
class ConsoleMessage:
    level: str
    text: str
    location: str | None = None


@dataclass(frozen=True)
class NetworkExchange:
    method: str
    url: str
    status: int
    failed: bool = False
    response_body_preview: str | None = None
    """The first 16 KiB of the response body, kept only for non-GET XHR/fetch calls."""


class BrowserSession(Protocol):
    def goto(self, url: str) -> None: ...
    def fill(self, selector: str, value: str) -> None: ...
    def click(self, selector: str) -> None: ...
    def select(self, selector: str, value: str) -> None: ...
    def upload(self, selector: str, file: str) -> None: ...
    def wait_for(self, selector: str, timeout_ms: int) -> None: ...
    def text_of(self, selector: str) -> str | None: ...
    def screenshot(self) -> bytes: ...
    def current_url(self) -> str: ...
    def console_messages(self) -> list[ConsoleMessage]: ...
    def network_exchanges(self) -> list[NetworkExchange]: ...
    def close(self) -> None: ...


class BrowserDriver(Protocol):
    """Opens browser sessions. Injected so tests need no real browser."""

    def open(self, base_url: str) -> BrowserSession: ...


PREVIEW_LIMIT = 16 * 1024


@dataclass
class _PlaywrightSession:
    """A session backed by one Playwright page (sync API)."""

    playwright: Any
    browser: Any
    context: Any
    page: Any
    _console: list[ConsoleMessage] = field(default_factory=list)
    _network: list[NetworkExchange] = field(default_factory=list)
    _closed: bool = False

    def __post_init__(self) -> None:
        self.page.on("console", self._on_console)
        self.page.on("response", self._on_response)
        self.page.on("requestfailed", self._on_request_failed)

    def _on_console(self, message: Any) -> None:
        type_ = message.type
        level = (
            "error"
            if type_ == "error"
            else "warn"
            if type_ == "warning"
            else type_
            if type_ in ("info", "log")
            else "log"
        )
        location = message.location
        where = (
            f"{location['url']}:{location['lineNumber']}"
            if location and location.get("url")
            else None
        )
        self._console.append(ConsoleMessage(level=level, text=message.text, location=where))

    def _on_response(self, response: Any) -> None:
        request = response.request
        preview: str | None = None
        if request.method != "GET" and request.resource_type in ("xhr", "fetch"):
            try:
                preview = response.body()[:PREVIEW_LIMIT].decode("utf8", errors="replace")
            except Exception:  # a redirect or an already-closed page has no body to read
                preview = None
        self._network.append(
            NetworkExchange(
                method=request.method,
                url=response.url,
                status=response.status,
                response_body_preview=preview,
            )
        )

    def _on_request_failed(self, request: Any) -> None:
        self._network.append(
            NetworkExchange(method=request.method, url=request.url, status=0, failed=True)
        )

    def goto(self, url: str) -> None:
        self.page.goto(url)

    def fill(self, selector: str, value: str) -> None:
        self.page.fill(selector, value)

    def click(self, selector: str) -> None:
        self.page.click(selector)

    def select(self, selector: str, value: str) -> None:
        self.page.select_option(selector, value)

    def upload(self, selector: str, file: str) -> None:
        self.page.set_input_files(selector, file)

    def wait_for(self, selector: str, timeout_ms: int) -> None:
        self.page.wait_for_selector(selector, timeout=timeout_ms)

    def text_of(self, selector: str) -> str | None:
        locator = self.page.locator(selector).first
        return locator.text_content() if locator.count() > 0 else None

    def screenshot(self) -> bytes:
        return self.page.screenshot()

    def current_url(self) -> str:
        return self.page.url

    def console_messages(self) -> list[ConsoleMessage]:
        return self._console

    def network_exchanges(self) -> list[NetworkExchange]:
        return self._network

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self.context.close()
        self.browser.close()
        # sync_playwright()'s own event loop stays marked "running" (it pumps
        # a dispatcher greenlet across the whole session, not just one call)
        # until this stop() runs — skip it and the *next* sync_playwright()
        # call in the same process finds that stale running loop and refuses
        # to start with "Please use the Async API instead", even though
        # nothing here ever touches asyncio directly.
        self.playwright.stop()


@dataclass(frozen=True)
class PlaywrightOptions:
    headless: bool = True
    executable_path: str | None = None
    storage_state: str | None = None
    default_timeout_ms: int = 10_000
    ignore_https_errors: bool | None = None
    """Accept invalid TLS certificates (self-signed, expired, wrong host).

    `None` (the default) means "not chosen": the environment variable
    `ATH_BROWSER_IGNORE_HTTPS_ERRORS` decides (`1`/`true`/`yes`/`on` enables),
    and without it certificates are verified. An explicit `True` or `False`
    always wins over the environment. Enable it only for targets that
    legitimately run with a throwaway certificate.
    """


IGNORE_HTTPS_ERRORS_ENV = "ATH_BROWSER_IGNORE_HTTPS_ERRORS"


def _resolve_ignore_https_errors(option: bool | None) -> bool:
    if option is not None:
        return option
    return os.environ.get(IGNORE_HTTPS_ERRORS_ENV, "").strip().lower() in ("1", "true", "yes", "on")


class PlaywrightDriver:
    """Opens a real Playwright (sync API) browser session."""

    def __init__(self, options: PlaywrightOptions | None = None) -> None:
        self._options = options or PlaywrightOptions()

    def open(self, base_url: str) -> BrowserSession:
        from playwright.sync_api import sync_playwright

        playwright = sync_playwright().start()
        launch_kwargs: dict[str, Any] = {"headless": self._options.headless}
        if self._options.executable_path is not None:
            launch_kwargs["executable_path"] = self._options.executable_path
        browser = playwright.chromium.launch(**launch_kwargs)

        context_kwargs: dict[str, Any] = {
            "base_url": base_url,
            "ignore_https_errors": _resolve_ignore_https_errors(self._options.ignore_https_errors),
        }
        if self._options.storage_state is not None:
            context_kwargs["storage_state"] = self._options.storage_state
        context = browser.new_context(**context_kwargs)
        page = context.new_page()
        page.set_default_timeout(self._options.default_timeout_ms)
        return _PlaywrightSession(
            playwright=playwright, browser=browser, context=context, page=page
        )


def _apply_step(session: BrowserSession, step: dict[str, Any]) -> None:
    action = step["action"]
    if action == "goto":
        session.goto(step["url"])
    elif action == "fill":
        session.fill(step["selector"], step["value"])
    elif action == "click":
        session.click(step["selector"])
    elif action == "select":
        session.select(step["selector"], step["value"])
    elif action == "upload":
        session.upload(step["selector"], step["file"])
    elif action == "waitFor":
        session.wait_for(step["selector"], step.get("timeoutMs", 10_000))
    else:
        raise ValueError(f"unknown browser step action: {action}")


def _has_page(session: BrowserSession) -> bool:
    """Whether a session already shows a page (sessions that cannot say count as blank)."""
    probe = getattr(session, "current_url", None)
    try:
        return callable(probe) and probe() not in ("", "about:blank")
    except Exception:
        return False


class _OperationEvidence:
    """Saves one browser operation's evidence: a screenshot before and after,
    and the full console and network logs. Every failure becomes a warning."""

    def __init__(self, session: BrowserSession, target: Any, name: str) -> None:
        self._session = session
        self._target = target
        self._name = name
        self._before_done = False

    def _guard(self, what: str, action: Any) -> None:
        try:
            action()
        except Exception as cause:
            self._target.store.warn(f"could not save {what} for {self._name}: {cause}")

    def _screenshot(self, phase: Any) -> None:
        self._target.save(
            phase=phase,
            source="screenshot",
            name=self._name,
            data=self._session.screenshot(),
            ext="png",
        )

    def start(self) -> None:
        """Before shot, when the session already shows a page."""
        if _has_page(self._session):
            self._before_done = True
            self._guard("a before screenshot", lambda: self._screenshot("before"))

    def after_step(self, step: dict[str, Any]) -> None:
        """A fresh session has no page to show yet, so its before shot is the
        page as the first navigation left it."""
        if not self._before_done and step["action"] == "goto":
            self._before_done = True
            self._guard("a before screenshot", lambda: self._screenshot("before"))

    def finish(self) -> None:
        """After shot, then the console and network logs as JSON."""
        if _has_page(self._session):
            self._guard("an after screenshot", lambda: self._screenshot("after"))
        self._guard(
            "the console log",
            lambda: self._target.save(
                phase="after",
                source="browser_console",
                name=self._name,
                data=json.dumps(
                    [asdict(message) for message in self._session.console_messages()], indent=2
                ),
                ext="json",
            ),
        )
        self._guard(
            "the network log",
            lambda: self._target.save(
                phase="after",
                source="browser_network",
                name=self._name,
                data=json.dumps(
                    [asdict(exchange) for exchange in self._session.network_exchanges()], indent=2
                ),
                ext="json",
            ),
        )


class BrowserExecutor:
    """
    Runs `browser` operations.

    A session is opened per operation unless one is supplied — supplying one
    is how a scenario keeps a signed-in page across steps. A session this
    executor opened stays open after its operation, so the runner can read
    the browser's console and network (`browser_session()`) when it collects
    evidence at the end of the run; it is closed when the next operation
    opens its own, or by `close_all()`, which `run_case`/`run_scenario` call
    when a run ends (also when a step raised). Closing happens once.

    While an evidence directory is configured each operation saves a
    screenshot before and after, plus the full console and network logs.

    @param driver: Opens sessions when none is supplied.
    @param session: An existing session to reuse. Never closed by this
        executor, since its owner may still need it.
    """

    kind = "browser"

    def __init__(self, driver: BrowserDriver, session: BrowserSession | None = None) -> None:
        self._driver = driver
        self._session = session
        self._owned: BrowserSession | None = None

    def browser_session(self) -> BrowserSession | None:
        """The session whose console and network the runner reads as evidence:
        the supplied one, else the last one this executor opened."""
        return self._session or self._owned

    def close_all(self) -> None:
        """Closes the session this executor opened, if still open. Idempotent."""
        owned, self._owned = self._owned, None
        if owned is not None:
            owned.close()

    def __enter__(self) -> BrowserExecutor:
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close_all()

    def _open(self, base_url: str) -> BrowserSession:
        # The previous session must be closed first: Playwright's sync API
        # refuses to start a second driver while the first is still running.
        self.close_all()
        self._owned = self._driver.open(base_url)
        return self._owned

    def run(self, operation: dict[str, Any], context: ExecutionContext) -> ExecutionResult:
        connection = context.manifest.connections.get(operation["connection"])
        if connection is None or connection.get("kind") != "browser":
            raise ExecutorError(
                f'connection "{operation["connection"]}" is not a browser connection',
                operation["connection"],
            )

        base_url = render_deep(connection["baseUrl"], context.scopes)
        steps = render_deep(operation["steps"], context.scopes)

        session = self._session or self._open(base_url)
        evidence = (
            _OperationEvidence(
                session, context.evidence, operation.get("id", operation["connection"])
            )
            if context.evidence is not None
            else None
        )
        started = time.monotonic()
        try:
            if evidence is not None:
                evidence.start()
            for step in steps:
                _apply_step(session, step)
                if evidence is not None:
                    evidence.after_step(step)
            return ExecutionResult(
                operation=operation["connection"],
                ok=True,
                duration_ms=(time.monotonic() - started) * 1000,
                stdout=session.text_of("body") or "",
            )
        except Exception as cause:
            return ExecutionResult(
                operation=operation["connection"],
                ok=False,
                duration_ms=(time.monotonic() - started) * 1000,
                failure=f"browser step failed: {cause}",
            )
        finally:
            if evidence is not None:
                evidence.finish()
