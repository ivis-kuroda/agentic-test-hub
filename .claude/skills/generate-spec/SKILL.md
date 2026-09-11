---
name: generate-spec
description: Derive Viewpoint/Factor/Matrix/Baseline/Case/Scenario draft entities for a target application from its design docs and/or implementation code, and hand them off for human review in the hub. Use when asked to generate, propose, or draft test specifications, viewpoints, factors, or cases from a design document, an API contract, or existing source code.
---

# Generating spec entities from design docs and code

This operationalizes the split documented in `docs/ARCHITECTURE.md` under
"AI at authoring time, deterministic code at run time":

| Phase | Who |
|---|---|
| Deriving factors and levels from design documents and implementation | AI, reviewed by a human |
| Deciding which combinations to test | Human, from AI proposals |

Read `AGENTS.md` and `docs/ARCHITECTURE.md` first if you have not already —
this skill assumes the hard constraints there (generic hub, no target
coupling, YAML is the source of truth).

## Before you start

Establish, from the user's request or by asking:

1. **What to read.** A design doc, an API contract, a set of source files, or
   some combination. Read all of it before drafting anything — do not derive
   a Viewpoint from a title alone.
2. **Where the specs live.** The suite's `SPECS_ROOT` (see
   `docs/ja/SETUP.md`). For a dry run or when nothing else is specified, use
   `examples/demo-app/specs`.
3. **What the plugin can actually do.** Read that target's `plugin.yaml` (or
   equivalent plugin source). Its `operations` keys are the only legal
   `OperationId` values and its `states` keys the only legal `StateRef`
   values anywhere you write `action.operation` or `preconditions`. Never
   invent one that is not declared there — if the behavior you want to test
   needs an operation or state the plugin does not expose yet, say so and
   stop rather than fabricating one.
4. **What already exists.** Read the suite's current viewpoints, factors,
   baselines and cases (`pnpm specs:validate` prints a count; read the files
   for content) so you propose new coverage rather than duplicating it.

## What to derive, and in what order

Schemas are in `packages/core/src/schema/*.ts` — read the TSDoc there for the
authoritative field-level contract; do not rely on this skill's summary for
field shapes.

1. **Viewpoints** — one per distinct claim worth reviewing ("why does this
   matter"). Every viewpoint's `source` must point at something real: a
   section of the design doc, or `path/to/file.ts:symbol` in the code you
   actually read. **Never fabricate a source.** A behavior you inferred
   without a citable origin is not a viewpoint yet — say so instead of
   inventing one.
2. **Factors** — the axes that vary, derived from the viewpoints and the
   overrides they imply. Set `path` when a factor is expressible as a single
   override into a baseline; leave it unset otherwise and say why.
3. **Matrix** — propose axes (`rows`/`cols` from the factors above) and
   `exclusions` with real reasons. **Do not choose `strategy` yourself.**
   Per the architecture doc this is explicitly a human decision — leave it at
   the schema default or the existing matrix's current value, and call out in
   your handoff summary that the coverage strategy is a decision the human
   still needs to make.
4. **Baselines** — a complete, executable starting point using only
   operations/states the plugin declares (see above).
5. **Cases / Scenarios** — baseline plus overrides per the levels the human
   ultimately wants covered. Do not enumerate the full combination space
   yourself when the matrix strategy is undecided; propose a small
   representative set and note that the rest follows once strategy is chosen.

## Writing the draft

Write entities as canonical YAML directly into the suite's specs directory
(the same shape `packages/store` writes), one file per entity, so the hub can
immediately load and render them. Then run, from the repo root:

```
pnpm specs:check      # canonical form
pnpm specs:validate   # cross-references resolve (viewpoints, factors, baseline, operations)
```

Fix anything either script flags before handing off — do not hand a human a
draft that fails the suite's own mechanical checks.

## Handoff: review gates saving, not just drafting

Writing the file to disk is necessary for the hub to display it at all, but
that is not the same as it being accepted. **Never `git commit` or `git push`
generated spec files on your own initiative.** Leave them as uncommitted
changes and tell the human explicitly:

- What you generated (each entity id, one line of rationale, and its source).
- Where to review it: `pnpm dev` in `apps/hub`, then the relevant
  `/viewpoints`, `/factors`, `/matrices`, `/baselines`, `/cases`, `/scenarios`
  page for each kind you touched.
- Any open decision you deliberately did not make (matrix strategy, above
  all).
- That nothing is committed yet, and you are waiting for their review before
  it becomes part of the suite's history.

If the human asks you to commit after reviewing, commit then — same as any
other change in this repository (see `docs/GIT.md`).
