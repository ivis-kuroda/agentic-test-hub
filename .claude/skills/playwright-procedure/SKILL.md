---
name: playwright-procedure
description: Turn VERIFIED screen interactions into deterministic Python Playwright procedures — the shared helper set (wait_ready, click_and_expect, visible_alert, expand_panel, fill_then_verify, unlock_if_shown), per-user browser contexts, blocked unreachable hosts via ATH_BROWSER_BLOCK_URLS, default timeouts, docstring conventions, and the migration rule to hub browser steps and procedures. Use when writing or extending screen procedures that test runs call. Not for exploring screens (web-ui-explore) or for selectors still UNVERIFIED.
---

# Writing Playwright screen procedures

Procedures are where UI quirks get absorbed — once. Test steps call them and
never touch selectors.

Until EXPRESSIVENESS-GAPS G1 (browser step vocabulary) and G2 (named
procedures) land, procedures are Python code in the plugin, and a plugin may
carry its own implementation of the helpers below. Keep them shaped so that
moving them into the hub is mechanical.

## Browser setup

- One Playwright `Browser` per run; **one context per SUT user** (cookies are
  per context), reused for a whole step.
- Context options: `base_url`, `ignore_https_errors` when the SUT uses a
  self-signed certificate, a fixed viewport for comparable screenshots.
- Abort unreachable hosts before the first navigation. The hub runner reads
  `ATH_BROWSER_BLOCK_URLS` (comma-separated globs); use the same variable in
  plugin code so both paths agree:
  ```python
  for pattern in block_urls():           # from ATH_BROWSER_BLOCK_URLS
      context.route(pattern, lambda route: route.abort())
  context.set_default_timeout(default_timeout_ms())   # ATH_BROWSER_DEFAULT_TIMEOUT_MS, e.g. 60000
  ```
  Record in evidence that hosts were blocked (a difference from production).
- Credentials come from the environment or the project's state file (mode
  600), never from code.

## Helper set

Implement these once (signatures are the contract; names may be prefixed by
the plugin):

```python
def wait_ready(page) -> None:
    """Load state reached and the app's busy markers (overlay, spinner) gone."""

def click_and_expect(page, selector: str, expect: Callable[[], None]) -> None:
    """Wait visible, scroll into view, click, then run `expect` (wait_for_url,
    wait_for_response, wait_for_function). Raises if the post-condition fails."""

def visible_alert(page, selector: str) -> str | None:
    """Text of the first *visible* match (offsetParent set, height > 0), else None."""

def expand_panel(page, name: str) -> None:
    """Open a collapsible panel if closed; no-op when open (idempotent)."""

def fill_then_verify(page, selector: str, value: str, *, press: str | None = None) -> None:
    """Fill, optionally focus+press a key for keyup-driven UIs, read .value back."""

def unlock_if_shown(page, ev=None) -> bool:
    """Release a per-user lock/"locked by another session" screen left by an
    aborted run; record it in evidence; return whether it was shown."""
```

Also common: a dialog handler registered **before** the click that raises a
native `confirm()`; `wait_for_function` for async validation gates; polling a
hidden step marker for multi-step wizards; a login that retries once on a
CSRF mismatch.

## Procedure conventions

```python
def create_thing(page, name: str, *, kind: str = "default", ev: StepEvidence | None = None) -> dict:
    """Create a thing on <screen path> and return {"id": ..., "url": ...}.

    Selectors: registry §4 (VERIFIED 2026-10-15). Post-condition: the list shows `name`.
    Quirks: the save button is enabled only after async validation.
    VERIFIED <date> (first live pass).
    """
```

- One entry function per operation; keyword-only optional params; typed.
- Returns a dict (or frozen dataclass) of produced values; nothing global.
- Optional evidence recorder `ev`: one item (screenshot) per operation, taken
  after `wait_ready`, with a caption that names the operation and the user.
- Raises a typed `ProcedureError(reason)` when the screen misbehaves.
- No fixed sleeps. Waits target the real state.
- Docstring: what, where (screen path), registry section and its VERIFIED
  date, post-condition, quirks, `VERIFIED <date>` after the first live pass.

## Tests

- Unit tests for pure parts (URL builders, parsers of produced values).
- A live smoke test per procedure, marked so it runs only with SUT access.
- Lint, format and the suite's tests pass before commit.

## Migration rule (to G1/G2/G5)

| Python today | Hub later |
|---|---|
| entry function + typed params | `procedures:` entry with typed `params` (G2) |
| returned dict | `produces` (G2) |
| `ev` items | per-operation evidence `items[]` (G5) |
| primitive actions (press, dialog, wait for function, download) | G1 browser step actions |

Do not add behaviour that cannot be expressed as one of the right-hand
columns without noting it in `docs/EXPRESSIVENESS-GAPS.md`.
