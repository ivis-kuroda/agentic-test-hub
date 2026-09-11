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
repository (for the first target, `weko-test-suite`).

The hub knows about `shell`, `http`, `sql` and `browser` executors. It does not
know about any particular product, framework, database schema, or URL.

This is enforced, not merely intended:

- `pnpm lint:no-target-coupling` fails the build if target-specific
  vocabulary appears in hub source.
- `examples/demo-app` is a small application unrelated to any real target. The
  hub's own end-to-end tests run against it. If hub code starts depending on a
  specific target, these tests break.

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

## Working agreement

The project owner has explicitly opted into fast, autonomous development.
Routine implementation work proceeds without step-by-step approval. Bring
decisions to the owner when they are *material*: a change to the data model, a
new external dependency, a reversal of a documented decision, a trade-off with
no obviously correct answer. Do not ask for approval of routine edits.
