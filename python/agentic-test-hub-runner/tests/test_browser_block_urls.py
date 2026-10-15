"""Blocking unreachable resources and the default-timeout override of the Playwright driver."""

from __future__ import annotations

import shutil
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from agentic_test_hub_runner.executors.browser import (
    PlaywrightDriver,
    PlaywrightOptions,
    resolve_block_urls,
    resolve_default_timeout_ms,
)


def test_block_urls_option_wins_over_environment(monkeypatch):
    monkeypatch.setenv("ATH_BROWSER_BLOCK_URLS", "https://a.example/**")
    assert resolve_block_urls(("https://b.example/**",)) == ("https://b.example/**",)


def test_block_urls_from_environment_are_split_and_trimmed(monkeypatch):
    monkeypatch.setenv("ATH_BROWSER_BLOCK_URLS", " https://a.example/** , ,**/slow.js ")
    assert resolve_block_urls(None) == ("https://a.example/**", "**/slow.js")


def test_block_urls_default_is_nothing(monkeypatch):
    monkeypatch.delenv("ATH_BROWSER_BLOCK_URLS", raising=False)
    assert resolve_block_urls(None) == ()


@pytest.mark.parametrize(
    ("raw", "expected"), [("60000", 60000), ("", 10000), ("0", 10000), ("x", 10000)]
)
def test_default_timeout_environment_override(monkeypatch, raw, expected):
    monkeypatch.setenv("ATH_BROWSER_DEFAULT_TIMEOUT_MS", raw)
    assert resolve_default_timeout_ms(10000) == expected


class _SlowScriptHandler(BaseHTTPRequestHandler):
    """Serves a page that loads /slow.js, which takes 5 s to answer."""

    def do_GET(self):  # noqa: N802 - http.server API
        if self.path == "/slow.js":
            time.sleep(5)
            body, ctype = b"window.slowLoaded = true;", "application/javascript"
        else:
            body = b'<html><body><p id="ok">ok</p><script src="/slow.js"></script></body></html>'
            ctype = "text/html"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # silence
        pass


@pytest.fixture
def slow_site():
    server = ThreadingHTTPServer(("127.0.0.1", 0), _SlowScriptHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()


def _playwright_available() -> bool:
    try:
        import playwright  # noqa: F401
    except ImportError:
        return False
    return shutil.which("node") is not None


@pytest.mark.skipif(not _playwright_available(), reason="playwright not installed")
def test_blocked_resource_does_not_stall_the_page(slow_site, monkeypatch):
    monkeypatch.delenv("ATH_BROWSER_BLOCK_URLS", raising=False)
    try:
        session = PlaywrightDriver(PlaywrightOptions(block_urls=("**/slow.js",))).open(slow_site)
    except Exception as cause:  # no usable Chromium
        pytest.skip(f"Chromium is not available: {cause}")
    try:
        started = time.monotonic()
        session.goto("/")
        elapsed = time.monotonic() - started
        assert elapsed < 4, f"page load waited for the blocked script ({elapsed:.1f}s)"
    finally:
        session.close()
