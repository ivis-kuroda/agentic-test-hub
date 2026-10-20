---
name: timing-window-test
description: Design and run a test step whose action must happen inside a short server-side window (a lock, a TTL, "within N seconds after a click") or only after an asynchronously created state exists — measure first, act in one process, record elapsed time, treat out-of-window attempts as invalid and retry them, never pass them. Use when a spec step depends on a timing window or a delayed state. Not for performance/latency acceptance tests or for plain waits for page load.
---

# Testing inside a timing window

A window test has three outcomes per attempt: valid-and-judged,
invalid-and-retried, or (after the retry budget) inconclusive. An attempt that
missed the window says nothing about the SUT; it is never a pass and never a
fail.

Until EXPRESSIVENESS-GAPS G4 (`within` / `until`) lands, this is plugin code;
keep the anchor, the deadline and the recorded `elapsed_ms` explicit so the
step maps onto G4 later.

## 1. Measure first

Before writing the step, measure on the live SUT (`web-ui-explore`):

- when the window opens and closes relative to the trigger (probe the real
  state — cache key, DB row, lock flag — at ~10 ms intervals);
- delayed states (e.g. an object created ~10 s after the click);
- the latency of the action you will send inside the window.

At least 3 samples; record min/median/max, method and date in the project
docs. If the action's latency alone can exceed the window, say so before
coding: the spec may need a different method (owner decision).

## 2. Act in one process

Trigger and action run in the same process, without hand-offs between tools:

```python
t0 = click_trigger(page)                     # returns time.monotonic() right before the click
assert probe_window_open(), "window not open"   # read-only probe, optional but recorded
resp = client.request(...)                   # the action under test
elapsed_ms = (time.monotonic() - t0) * 1000
ev.note("timing", {"elapsed_ms": elapsed_ms, "limit_ms": LIMIT, "probe": probe_result})
```

For "only after a state exists": poll that state (`until`) with a deadline
and record how long it took; never a fixed sleep.

## 3. Valid, invalid, retry

```python
for attempt in range(1, MAX_ATTEMPTS + 1):          # e.g. 3
    outcome = run_attempt()
    if outcome.elapsed_ms < LIMIT_MS and outcome.window_confirmed:
        judge(outcome)                              # normal checks; ok or ng
        break
    ev.note(f"attempt {attempt} invalid", outcome.summary())   # kept, labelled
    clean_up_side_effects(outcome)                  # see 4
else:
    checks.hold("timing window", f"no valid attempt in {MAX_ATTEMPTS}")  # deferred, not ng
```

- Invalid attempts stay in the evidence, labelled `invalid (outside window)`.
- A fallback that recreates the window artificially (e.g. setting the lock
  directly) is used only if the spec or the decision log allows it, and the
  evidence says so.

## 4. Side effects

Triggers often start work that outlives the window (an edit session, an
activity, a lock held by the user). After each attempt, valid or not:
release/close what was started, verify it is gone, and record it. Leftovers
break the next attempt and the next step.

## Report

Per step: attempts (n valid / n invalid), elapsed_ms per attempt, limit,
window evidence, fallback used (and the decision that allows it), side effects
cleaned up with proof.
