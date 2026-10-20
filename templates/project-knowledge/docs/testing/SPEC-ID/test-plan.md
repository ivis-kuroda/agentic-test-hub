# <spec> — integration test execution plan

Spec: `<file>` (label <v-label>; real version <v>, authoritative per decision 1).
Target: `<repo> <branch>`. Baseline: `<sha>` (decision 2). Decisions: `AGENTS.md`.

## 1. Approach

- Executors per kind of step: API = <recording client>; UI = Playwright
  procedures (explored with agent-browser); H = helper/CLI; D = service
  stop/start; F = data-level fault (spike first; impossible → not_runnable);
  R = review of captured responses/logs.
- Evidence: <per decision 8>.
- Order: preparation → non-destructive scenarios → destructive groups last.

## 2. Per-scenario method

| Scenario | Steps | Method | Fixtures used / consumed | SUT changes | Notes (measured timings, traps) |
|---|---|---|---|---|---|

## 3. Mocks and faults without source changes

| Mock | Spec need | Reproduced by | Status (spiked / not_runnable + reason) |
|---|---|---|---|

## 4. Phases and blocks

| Block | Steps | Agent | Est. duration (≤ ~1 h) | Destructive | Preconditions (backup, stack) | Status |
|---|---|---|---|---|---|---|

## 5. Decided / open

- Decided: <decision numbers>
- Open: <questions, with impact>
