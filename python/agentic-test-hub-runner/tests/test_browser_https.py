"""
Real Chromium against a real local HTTPS server with a throwaway self-signed
certificate. Skips when `openssl` or a Chromium for Playwright is missing.
"""

from __future__ import annotations

import shutil
import ssl
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from agentic_test_hub_runner.executors.browser import PlaywrightDriver, PlaywrightOptions


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        pass

    def do_GET(self) -> None:
        body = b"<html><body><h1>secure page</h1></body></html>"
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


@pytest.fixture
def https_url(tmp_path: Path):
    if shutil.which("openssl") is None:
        pytest.skip("openssl is not installed")
    cert, key = tmp_path / "cert.pem", tmp_path / "key.pem"
    subprocess.run(
        [
            "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
            "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
            "-keyout", str(key), "-out", str(cert),
        ],
        check=True,
        capture_output=True,
    )  # fmt: skip
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(str(cert), str(key))
    server.socket = context.wrap_socket(server.socket, server_side=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"https://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()


def _visit(url: str, options: PlaywrightOptions) -> str:
    try:
        session = PlaywrightDriver(options).open(url)
    except Exception as cause:  # no usable Chromium
        pytest.skip(f"Chromium is not available: {cause}")
    try:
        session.goto("/")
        return session.text_of("body") or ""
    finally:
        session.close()


def test_self_signed_certificate_is_rejected_by_default(https_url, monkeypatch):
    monkeypatch.delenv("ATH_BROWSER_IGNORE_HTTPS_ERRORS", raising=False)
    with pytest.raises(Exception, match="ERR_CERT"):
        _visit(https_url, PlaywrightOptions())


def test_ignore_https_errors_option_accepts_it(https_url, monkeypatch):
    monkeypatch.delenv("ATH_BROWSER_IGNORE_HTTPS_ERRORS", raising=False)
    assert "secure page" in _visit(https_url, PlaywrightOptions(ignore_https_errors=True))


def test_environment_variable_accepts_it(https_url, monkeypatch):
    monkeypatch.setenv("ATH_BROWSER_IGNORE_HTTPS_ERRORS", "1")
    assert "secure page" in _visit(https_url, PlaywrightOptions())
