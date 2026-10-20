---
name: spec-reconcile
description: Reconcile test viewpoints with test cases across spec artifacts (e.g. a viewpoint sheet in a spreadsheet and a case list in a text spec) — check versions, map every viewpoint to the cases that cover it, list orphan viewpoints and orphan cases, and produce a mapping table plus owner questions. Use after kickoff, when a spec version changes, or when a case-number column refers to an older numbering. Not for drafting new cases (generate-spec) or for executing them.
---

# Reconciling viewpoints and cases

Two artifacts often describe one test: a list of viewpoints (what must be
covered) and a list of cases/steps (how). They drift: different versions,
renumbered cases, viewpoints dropped on one side. Decide nothing silently;
produce a table and questions.

## Inputs

- The viewpoint source and the case source named authoritative in the
  decision log (`test-kickoff`, category 1).
- Their version labels and real versions (provenance check).

## Procedure

1. **Version check.** Record the label and the real version of each
   artifact. If a cross-reference column (e.g. "covered by case") uses another
   version's numbering, say so and do not trust it.
2. **Extract** with a script, not by reading: viewpoint id, text; case id,
   title, the viewpoint ids it cites, its steps. Keep the script in the
   project repo so the table can be regenerated. Take titles verbatim from the
   source.
3. **Map** each viewpoint to cases by, in order of strength: explicit citation
   in the case → matching the viewpoint text against expected results →
   judgement (mark these `inferred`).
4. **Orphans**:
   - viewpoints with no case (coverage gap);
   - cases citing no viewpoint or a viewpoint that does not exist;
   - viewpoints whose only mapping is `inferred`.
5. **Diff against the stale column**: list rows where the old numbering points
   to a different case than your mapping.
6. Write the table to the project's docs (e.g.
   `docs/testing/<spec>/viewpoint-case-map.md`), header stating the generator
   and the source versions, status `draft — owner review pending`.

## Output table

| Viewpoint | Text (verbatim, shortened) | Cases | How mapped | Stale column says | Note |
|---|---|---|---|---|---|
| VP-12 | ... | S3-01, S3-02 | cited | 3-1 | — |
| VP-31 | ... | — | — | 7-2 | **orphan** |

## Owner questions

One AskUserQuestion batch: for each orphan or `inferred` row, the options
(add a case, drop the viewpoint, accept the inferred mapping) with the impact
on the case count and your recommendation. Record answers in the decision log
and regenerate the table.

## Report

Counts (viewpoints, cases, mapped, inferred, orphans each way), the table
path, the questions asked and their answers.
