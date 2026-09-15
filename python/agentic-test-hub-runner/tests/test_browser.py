from __future__ import annotations

from typing import cast

from agentic_test_hub_runner.executors.browser import PlaywrightDriver, _PlaywrightSession


def _fake_page():
    return type(
        "Page",
        (),
        {
            "on": lambda self, *a, **k: None,
            "set_default_timeout": lambda self, *a, **k: None,
        },
    )()


def test_close_stops_playwright_not_just_browser_and_context():
    # A leaked `playwright` object here is exactly the bug this guards: an
    # unstopped sync_playwright() leaves its event loop marked "running" for
    # the rest of the process, so the *next* sync_playwright() call anywhere
    # in the same test raises "Please use the Async API instead" even though
    # nothing touches asyncio directly — see executors/browser.py's own
    # comment on _PlaywrightSession.close.
    calls: list[str] = []
    playwright = type("PW", (), {"stop": lambda self: calls.append("playwright.stop")})()
    browser = type("Browser", (), {"close": lambda self: calls.append("browser.close")})()
    context = type("Context", (), {"close": lambda self: calls.append("context.close")})()

    session = _PlaywrightSession(
        playwright=playwright, browser=browser, context=context, page=_fake_page()
    )
    session.close()

    assert calls == ["context.close", "browser.close", "playwright.stop"]


def test_open_wires_the_started_playwright_into_the_session(monkeypatch):
    stopped = []
    fake_playwright = type(
        "PW",
        (),
        {
            "stop": lambda self: stopped.append(True),
            "chromium": type(
                "Chromium",
                (),
                {
                    "launch": lambda self, **k: type(
                        "Browser",
                        (),
                        {
                            "close": lambda self: None,
                            "new_context": lambda self, **k: type(
                                "Context",
                                (),
                                {"close": lambda self: None, "new_page": lambda self: _fake_page()},
                            )(),
                        },
                    )()
                },
            )(),
        },
    )()

    class FakeContextManager:
        def start(self):
            return fake_playwright

    # `open()` does `from playwright.sync_api import sync_playwright` inside
    # the method itself, freshly on every call — patch the name where it's
    # actually looked up (playwright.sync_api), not on our own module.
    import playwright.sync_api as sync_api_module

    monkeypatch.setattr(sync_api_module, "sync_playwright", lambda: FakeContextManager())

    driver = PlaywrightDriver()
    session = cast(_PlaywrightSession, driver.open("http://example.test"))

    assert session.playwright is fake_playwright
    session.close()
    assert stopped == [True]
