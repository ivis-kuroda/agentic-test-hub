# AGENTS.md

Entry point for AI agents working in this repository. Read this first, then
the documents it links to. Everything here is normative: if code and this
document disagree, the disagreement is a bug in one of them, and it must be
resolved rather than ignored.

## What this project is

`agentic-test-hub` manages integration-test specifications as structured data
and drives their execution.

The problem it solves: integration-test specifications are traditionally
written in Excel for human readability. That makes them hostile to automation,
forces a lossy Excel-to-Markdown conversion step before an AI can use them,
and splits the specification across two artifacts that drift apart.

The approach:

- **Structured YAML in git is the single source of truth.** Every human-facing
  artifact (delivery Excel, reviewer HTML) is *generated* from it.
- **Editing happens in a web UI**, never by hand-editing the generated Excel.
  There is no Excel-to-source import path in normal operation.
- **AI authors tests; deterministic code runs them.** An agent explores the
  target application and emits Playwright code, which is committed. Day-to-day
  runs execute that committed code. AI is used again at triage time and for
  assertions that genuinely need judgement.

## Hard constraint: this repository knows nothing about any specific application

The hub is generic. Application-specific knowledge lives in a *plugin*
repository, one per target application, maintained separately from this one.

The hub knows about `shell`, `http`, `sql` and `browser` executors. It does not
know about any particular product, framework, database schema, or URL.

This is enforced, not merely intended:

- `pnpm lint:no-target-coupling` fails the build when hub source names a
  target application. Terms are listed in `scripts/target-vocabulary.txt`, and
  every new plugin adds its target's name there.
- `examples/demo-app` is a small application unrelated to any real target. The
  hub's own end-to-end tests run against it. If hub code starts depending on a
  specific target, these tests break.

When the check fires, the fix is to move the knowledge into a plugin or
rename the thing in generic terms — never to remove the term from the list.

Before adding anything to this repository, ask: *would this still make sense
for a completely different application?* If not, it belongs in the plugin.

## Language rules

| Where | Language |
|---|---|
| Source code, identifiers, code comments | English |
| TSDoc on exported types, functions, classes | English, and mandatory |
| Documents addressed to AI agents (this file, `docs/*.md`) | English |
| Documents addressed to humans (`docs/ja/*.md`) | Japanese |
| Specification content authored by users | Whatever the user writes |

Every exported symbol carries TSDoc. Not a restatement of the name — say what
the thing is for, what the caller is responsible for, and anything surprising.

## Documents

- `docs/GIT.md` — commit and branching conventions. **Read before committing.**
- `docs/ARCHITECTURE.md` — the design and the reasoning behind it.
- `docs/SPEC-MODEL.md` — the specification data model in detail.
- `docs/ja/` — Japanese documents for human readers. Keep them in sync in
  substance, but they are not translations; they may differ in emphasis.
  - `docs/ja/SETUP.md` — how to run this locally: install, start the web
    editor, generate the reviewer view and delivery workbook, run the tests.

## Agents, skills and templates

Everything in `.claude/` and `templates/` is generic: it names no target and
refers to the system under test as "the SUT". Target-specific variants live in
the plugin or the project's knowledge repository and assume these.

`.claude/agents/` (run a test campaign; the orchestrator runs as the main
session, `claude --agent test-orchestrator`):

| Agent | Role |
|---|---|
| `test-orchestrator` | Plans, delegates, verifies, records, hands off; never drives the SUT or writes test code |
| `ui-explorer` | agent-browser exploration: UNVERIFIED → VERIFIED selectors, measured timings; returns corrections, edits no docs |
| `ui-procedure-author` | Deterministic Playwright procedures from VERIFIED selectors, with tests |
| `scenario-runner` | Implements and runs one block of spec steps as the only SUT client; fixed report contract |
| `evidence-reviewer` | Read-only review of saved evidence per step |

`.claude/skills/`:

| Skill | Use for |
|---|---|
| `generate-spec` | Draft specs from design docs/code |
| `generate-test` | Reviewed specs to committed test code |
| `triage-run-result` | Classify non-passes, record results |
| `write-handoff` | HANDOFF and resume prompt (another machine, or a campaign block boundary) |
| `test-kickoff` | Owner question batches → numbered decision log; baseline via merge-base; provenance check |
| `spec-reconcile` | Viewpoints ↔ cases mapping, version check, orphans |
| `delegation-brief` | Template for every brief to an agent |
| `verify-claims` | Checklist before recording a hand-back |
| `web-ui-explore` | agent-browser method, UI friction catalogue, VERIFIED marking |
| `playwright-procedure` | Helper set and conventions for screen procedures; migration to G1/G2/G5 |
| `timing-window-test` | Steps that must act inside a short server-side window |
| `env-change-guard` | Backup → apply → verify → restore in finally → verify → log |
| `status-report` | Computed status table with unblock paths |

`templates/project-knowledge/`: skeleton of a project's knowledge repository
(decision log, selector registry, HANDOFF, test plan, findings, env-change
log, status summary); see its `README.md`.

Some reusable code (per-step evidence recorder, verdict set, restore guard,
credential broker, screen helpers) is still written inside plugins. A plugin
may carry its own implementation until the matching gap in
`docs/EXPRESSIVENESS-GAPS.md` (G1–G7) lands in the hub.

## Working agreement

The project owner has explicitly opted into fast, autonomous development.
Routine implementation work proceeds without step-by-step approval. Bring
decisions to the owner when they are *material*: a change to the data model, a
new external dependency, a reversal of a documented decision, a trade-off with
no obviously correct answer. Do not ask for approval of routine edits.
