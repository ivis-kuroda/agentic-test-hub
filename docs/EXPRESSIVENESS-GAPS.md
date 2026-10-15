# Expressiveness gaps found while running a real integration-test specification

Status: design proposal (2026-10-15). Nothing here is implemented yet except where marked.

A plugin for a server-rendered web application with an OAuth-protected deposit API had to write
its preparation and UI-coupled cases as **Python procedures in the plugin** (the `extension`
executor and direct Playwright code) because the spec model and the `browser` step DSL could not
express them. That was the owner's explicit choice for speed; this document keeps the design
needed to move such cases back into specifications later. Each gap lists what was needed, why
the current model falls short, and a proposed extension. The order is the suggested order of work.

## G1. Browser step vocabulary

Needed: `press` (a key, to fire `keyup`-driven enablement), `focus`, `check`/`uncheck`,
`waitForFunction` (a JS predicate, e.g. an async validation marker or a hidden field's value),
`waitForUrl` (pattern), `acceptDialog` (a native `confirm()` raised by a click), `download`
(save the file a click produces, with its path produced as a step value), `expectVisible`, and a
`poll` wrapper (repeat a probe until a predicate holds or a deadline passes).

Today: `goto`, `fill`, `click`, `select`, `upload`, `waitFor` only (`executors/browser.py`
`_apply_step`). `fill` sets the value without key events, so forms whose save button is enabled
by `keyup` cannot be completed.

Proposal: extend the step union in `packages/core/src/schema` and both drivers; every new action
takes a `timeoutMs`. `download` produces `{{step.<id>.path}}`. Keep actions primitive; anything
longer becomes a procedure (G2).

## G2. Named procedures as operations

Needed: reusable multi-screen procedures (log in as a role, register an OAuth application,
authorize it and exchange the code, register an item through a multi-step workflow) called from
many scenarios with parameters, each producing values (ids, URLs) and per-operation evidence.

Today: a scenario step is one operation; long screen flows are either inlined (unreadable,
duplicated) or hidden in an untyped `extension` call.

Proposal: `plugin.yaml` declares `procedures:` — a name, typed `params`, typed `produces`, and an
implementation that is either a list of browser steps (G1) or a plugin-language function
reference (Python today). Scenarios call them like operations (`action.procedure: PROC-LOGIN`).
The generator emits a call; the runner records each inner operation as its own evidence item.

## G3. Managed credentials (resources with acquisition policy)

Needed: OAuth access tokens that (a) are issued through a consent screen, (b) exist **at most
once per (application, user)** — issuing a new one deletes the previous one —, (c) expire after
an hour, and (d) come in kinds (scope sets) that cannot coexist for the same pair. Steps ask for
"a token of kind K for application A and user U" right before use.

Today: tokens are environment variables (`{{env.X}}`) fixed for the whole run, which is wrong on
all four points.

Proposal: `plugin.yaml` declares `resources:` with a `kind` (e.g. `token`), a key shape
(`app`, `user`, `variant`), an `acquire` procedure (G2), optional `refresh` procedure, `ttlSeconds`,
and an `exclusive: [app, user]` rule meaning "acquiring one variant invalidates the others for the
same key". Steps reference `{{resource.token[app=A,user=U,variant=K]}}`; the runner acquires lazily,
caches, and re-acquires when the variant differs, the TTL margin is reached, or a step marks it
revoked. An acquisition the target refuses yields a first-class outcome (G6).

## G4. Timing constraints between operations

Needed: "call the API within 3 s after clicking a button" (a short-lived lock), with the measured
delay recorded and an attempt above the limit treated as invalid (retry), not as a failure; and
"call the API only after a state exists" (an activity row created ~10 s after the click).

Today: steps run sequentially with no timing contract; waits are fixed sleeps or absent.

Proposal: a step may carry `within: {after: <stepId>, ms: 3000, onViolation: retry|inconclusive}`
and `until: {probe: <operation>, predicate: ..., timeoutMs: ...}` (a precondition poll). The runner
records `elapsedMs` from the anchor step in evidence. Steps with `within` must run in one process
with their anchor (the browser session and the HTTP client share a process today in Python only).

## G5. Evidence per operation and the delivery workbook

Needed: one evidence item per operation (screenshot; API exchanges and log excerpts rendered as
terminal-style images with the raw text kept), all items of a step on one sheet top-to-bottom in
time order, and a delivery workbook with **one sheet per spec step** generated from them.

Today: evidence is saved per phase/source (`evidence_store.py`), which is good raw material, but
there is no ordered per-operation index and no workbook export in that shape.

Proposal: add an ordered `items[]` index per step (seq, kind, caption, timestamp, files) next to
the existing files, a text-to-image renderer in the runner, and an exporter
(`packages/export`) that lays a step's items onto one sheet using a template sheet from the
delivery workbook.

## G6. Outcomes beyond pass/fail for preparation

Needed: "not issuable" (the system refuses to create the precondition the spec asks for, which the
spec says to record), and "deferred" (needs a baseline that is not available yet), distinct from
`not_runnable` (cannot be reproduced without changing the target) and from failures.

Proposal: extend the verdict vocabulary with `not_issuable` and `deferred`, each with `reason`,
`checkedAt`, `checkedBy`, reported separately in the reviewer view.

## G7. Destructive and stateful ordering

Needed: scenarios share state on purpose (prepared records are reused; some are consumed and must
be re-created by rule before the next user), destructive groups run last, and anything changed
(server config, container state, injected faults) is restored in a `finally`.

Today: `cleanup` exists per scenario; there is no declarative "re-create resource R4 before the
next step that uses it" rule, and no run-level ordering groups.

Proposal: resources (G3) gain `consumedBy` markers on steps and a `recreate` procedure; the runner
re-creates a consumed resource lazily before its next use. Add `group: destructive` with run-order
semantics and a mandatory `restore` block.

## G8. TypeScript generation parity

The TypeScript generator refuses plans with `multipart`; deposit APIs need it. Parity is needed
before a TypeScript-only plugin can exist.

## Migration path for the Python procedures written now

Each plugin procedure written as Python should keep: a single entry function per procedure, typed
parameters, returned values as a dict, and evidence written through one per-step recorder. Those
three properties map one-to-one onto G2 (procedure + produces) and G5 (items), so moving a case
into YAML later is a mechanical translation once G1–G5 exist.
