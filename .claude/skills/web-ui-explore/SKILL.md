---
name: web-ui-explore
description: Explore a web UI of the system under test with agent-browser to confirm selectors (UNVERIFIED to VERIFIED), measure waits, locks and timing windows, and report exact working commands, using a catalogue of known UI friction. Use when a screen must be automated for the first time, a selector registry has UNVERIFIED entries, or a timing must be measured before a test method is fixed. Not for test runs (they use committed Playwright code, see playwright-procedure) or for API-only steps.
---

# Exploring a web UI

Exploration finds the live-only facts; committed Playwright code then runs
without an agent looking at the page. After a good exploration round, the
execution agents of a past campaign needed zero agent-browser calls.

A plugin or project may carry its own target-specific variant of this skill
(selectors, recipes); it should assume this one and hold only what differs.

## Pipeline

1. **Code scout** (read-only Explore agent): selectors from templates/scripts,
   with file:line, all marked `UNVERIFIED`. It never claims a selector works.
2. **Explorer** (`ui-explorer`): confirms on screen, measures, returns
   corrections. Does not edit docs.
3. **Orchestrator**: writes `VERIFIED <YYYY-MM-DD>` (or the correction) into
   the selector registry and the project's gotcha list.
4. **Procedure author** (`playwright-procedure`): code from VERIFIED entries
   only.

## Setup

```bash
agent-browser skills get core                 # CLI usage, once per task
S=<project>-<user>                            # one named session per SUT user
agent-browser --session "$S" --ignore-https-errors open "$BASE/<login path>"
# block unreachable third-party hosts listed at kickoff, before navigating:
agent-browser --session "$S" network route "<https://host/**>" --abort
```

Set a project-level timeout (tool defaults around 25 s are too short for slow
pages; 60 s worked). Check option names against the installed agent-browser
version and note the version in the report.

## Core loop

```bash
agent-browser --session "$S" snapshot -i            # refs @eN of interactive elements
agent-browser --session "$S" fill @e3 "<value>"
agent-browser --session "$S" click @e5
agent-browser --session "$S" wait --url "**/<expected>"   # or --text / --fn "<js predicate>"
agent-browser --session "$S" screenshot "$SCRATCH/NN-<what>.png"
```

Re-snapshot after every navigation. After **every** click, check a
post-condition (URL, request seen, DOM change, visible message). Record the
command sequence that worked; it goes into the report verbatim.

## UI friction catalogue

| Friction | Symptom | Handle it by |
|---|---|---|
| Unreachable third-party asset | every page waits tens of seconds | list external hosts at kickoff; abort them in both tools; record as an environment difference |
| Loading overlay | click "succeeds" but hits the overlay | wait for load state **and** the busy marker gone; never fixed sleeps |
| Hidden or off-viewport target | tool reports "Done", nothing is sent | wait visible, scroll into view, click, assert the post-condition |
| Collapsed/hidden result element | a hidden alert is taken as the result | results must be visible (`offsetParent !== null`, height > 0) |
| Re-render wipes input | a field filled earlier is empty at submit | fill order matters (re-rendering selects first, free text last); read `.value` back before submitting |
| Panels collapse after reload/save | next selector not visible | idempotent "expand panel" step |
| Slow server action | next screen appears seconds later | measure it; poll the real state (URL, DB row), never sleep |
| Per-user leftover lock | "locked by another session" screen after an aborted run | unlock-if-shown step; clean up at run start; record the leftover |
| Async validation gates a button | save stays disabled | wait for the gate with a JS predicate |
| Native `confirm()` | click blocks | accept the dialog (register the handler before the click in Playwright) |
| `fill` fires no key events | a keyup-enabled button stays disabled | focus + press a key after fill |
| Selector from code is wrong | element not found / different element | that is why everything starts UNVERIFIED |
| Session reuse across users | wrong user's data | one session/context per user; HTTPS when cookies are Secure |
| Screenshot during load | capture timeout | screenshot only after the ready wait |

Add new rows to the project's gotcha list (through the orchestrator).

## Measuring timings and windows

- Probe the state directly (cache key, DB row, URL) at a fixed short interval
  (e.g. 10 ms for sub-second windows), from the moment of the click.
- Repeat at least 3 times; report min/median/max and the probe method.
- Write what starts and ends the window (e.g. "lock appears ~0.1 s after the
  click, lives 3.0 s; the follow-up object appears ~10 s after the click").
- Timing-critical test methods then follow `timing-window-test`.

## Probe data

Name everything you create with the agreed prefix (default `probe-`), delete
it through the UI at the end, and prove it with a query or a screenshot of the
empty list. A clean-up by data access needs an owner decision; report it.

## Registry marking

Selector registry entries carry exactly one mark:

- `UNVERIFIED` — from code reading or inference.
- `VERIFIED <YYYY-MM-DD>` — seen working on the live SUT; wrong details fixed
  in the same edit.

## Report template

```
Version: agent-browser <v>; SUT <build>; date <YYYY-MM-DD>
| Operation | Selector | Status (VERIFIED <date> / wrong → right) | Wait | Post-condition |
Timings: <what> = <min/median/max> (<n> samples, <method>)
Commands that worked: <block>
Friction met: <catalogue row or new> → <workaround>
Probe objects: <list> → deleted; proof: <query/output>
SUT changes / leftovers: <list>
Screenshots: <scratch paths>
Own judgements / owner questions: <list>
```
