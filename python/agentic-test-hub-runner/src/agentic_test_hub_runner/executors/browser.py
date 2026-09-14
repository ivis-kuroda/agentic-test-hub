"""
Runs `browser` operations, mirroring `packages/runner/src/executor/browser.ts`
and `packages/runner/src/driver/playwright.ts` combined — Python needs no
separate driver interface split across two files the way the TypeScript
package does, since `PlaywrightDriver` here is the only driver a generated
Python test ever uses.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
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


class BrowserSession(Protocol):
    def goto(self, url: str) -> None: ...
    def fill(self, selector: str, value: str) -> None: ...
    def click(self, selector: str) -> None: ...
    def select(self, selector: str, value: str) -> None: ...
    def upload(self, selector: str, file: str) -> None: ...
    def wait_for(self, selector: str, timeout_ms: int) -> None: ...
    def text_of(self, selector: str) -> str | None: ...
    def screenshot(self) -> bytes: ...
    def console_messages(self) -> list[ConsoleMessage]: ...
    def network_exchanges(self) -> list[NetworkExchange]: ...
    def close(self) -> None: ...


class BrowserDriver(Protocol):
    """Opens browser sessions. Injected so tests need no real browser."""

    def open(self, base_url: str) -> BrowserSession: ...


@dataclass
class _PlaywrightSession:
    """A session backed by one Playwright page (sync API)."""

    browser: Any
    context: Any
    page: Any
    _console: list[ConsoleMessage] = field(default_factory=list)
    _network: list[NetworkExchange] = field(default_factory=list)

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
        self._network.append(
            NetworkExchange(
                method=response.request.method, url=response.url, status=response.status
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

    def console_messages(self) -> list[ConsoleMessage]:
        return self._console

    def network_exchanges(self) -> list[NetworkExchange]:
        return self._network

    def close(self) -> None:
        self.context.close()
        self.browser.close()


@dataclass(frozen=True)
class PlaywrightOptions:
    headless: bool = True
    executable_path: str | None = None
    storage_state: str | None = None
    default_timeout_ms: int = 10_000


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

        context_kwargs: dict[str, Any] = {"base_url": base_url}
        if self._options.storage_state is not None:
            context_kwargs["storage_state"] = self._options.storage_state
        context = browser.new_context(**context_kwargs)
        page = context.new_page()
        page.set_default_timeout(self._options.default_timeout_ms)
        return _PlaywrightSession(browser=browser, context=context, page=page)


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


class BrowserExecutor:
    """
    Runs `browser` operations.

    A session is opened per operation and closed afterwards unless one is
    supplied — supplying one is how a scenario keeps a signed-in page across
    steps.

    @param driver: Opens sessions when none is supplied.
    @param session: An existing session to reuse. Not closed by this
        executor, since its owner may still need it.
    """

    kind = "browser"

    def __init__(self, driver: BrowserDriver, session: BrowserSession | None = None) -> None:
        self._driver = driver
        self._session = session

    def run(self, operation: dict[str, Any], context: ExecutionContext) -> ExecutionResult:
        connection = context.manifest.connections.get(operation["connection"])
        if connection is None or connection.get("kind") != "browser":
            raise ExecutorError(
                f'connection "{operation["connection"]}" is not a browser connection',
                operation["connection"],
            )

        base_url = render_deep(connection["baseUrl"], context.scopes)
        steps = render_deep(operation["steps"], context.scopes)

        borrowed = self._session is not None
        session = self._session or self._driver.open(base_url)
        started = time.monotonic()
        try:
            for step in steps:
                _apply_step(session, step)
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
            if not borrowed:
                session.close()
