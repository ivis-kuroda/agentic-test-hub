---
name: triage-run-result
description: Classify every non-pass of a test run (fail, inconclusive, error, skipped) as test defect, target defect, spec defect, environment defect or inconclusive-by-design, using saved evidence, and produce a result row for the spec's result-entry section. Use after a run when asked to triage, analyse, or record results. Never use it to make failing tests pass.
---

# Triaging a run result

Read the "Evidence" and "Saved evidence" sections of `docs/ARCHITECTURE.md`
first. A pass rests on evidence; missing or weak evidence is `inconclusive`,
never pass.

## Inputs

- The run output (pytest log or JSON result) and
  `<ATH_EVIDENCE_DIR>/<run-id>/index.json` (`entries[]`: `kind` 1-5, `source`,
  `path`, `phase`, `role`, `entity`, `step`, `sha256`; plus `warnings[]`).
- Files under `<run-id>/<entity-id>/<location>/`: `*-screenshot-*`,
  `after-console-*`/`after-network-*`, `during-network-http-*`,
  `{before,after,diff}-db-records|app-log|db-log-*`.
- The spec entity, the generated test, and the plugin manifest.

If `ATH_EVIDENCE_DIR` was unset there is no saved evidence: say so, and ask to
rerun with it set rather than judging from memory.

## Procedure

1. List non-passes: `jq -r '.entries[] | [.entity,.step,.kind,.source,.path]
   | @tsv' <run>/index.json`, and read `warnings` (a write error is a gap).
2. For each non-pass, read in this order: the failure reason, the step's
   request/response exchange, console/network, the diff files (what changed in
   data and logs between before and after), then the screenshot. Note which of
   the five evidence kinds exist and which are missing.
3. Classify (exactly one primary class, with the observation that decides it):
   - **Test defect** — generated code or plugin is wrong (bad import,
     wrong selector or template, mis-captured `produces`, extension bug).
   - **Target defect** — the application misbehaved against a correct,
     unambiguous expectation (wrong status, wrong data, server error in log).
   - **Spec defect** — the expectation is wrong, ambiguous, or contradicts the
     design source.
   - **Environment defect** — state pollution, leftover fault from an earlier
     run or failed cleanup, version mismatch, expired credentials.
   - **Inconclusive by design** — a required channel could not be read or the
     only deciding channel is insufficient alone. Name the missing channel.
   Confirm environment suspicion by rerunning on a clean state before blaming
   the target. Reproduce target defects at least once.
4. Propose the action per class: fix test/plugin (then rerun), file the
   target defect, **propose** a spec change as a diff for review, restore the
   environment, or add the missing collector.
5. Write the row (paste-ready Markdown for the spec's result-entry section):

   | Date | Executor | Verdict | Evidence (kind: path) | Remark |
   |---|---|---|---|---|
   | 2026-10-08 | <name or agent + human owner> | pass/fail/inconclusive | 1: `<path>`; 2: `<path>`; 3: ... | class + one-line reason |

   Paths are relative to the run directory and include the run id. List only
   kinds that exist; write `not collected` for the rest.

## Rules

- **Never turn a fail into a pass by loosening an expectation, adding a
  waiver, or filtering noise without human approval.** Propose the change with
  the reason and let the owner decide.
- Do not mask target defects as test defects to get a clean run.
- Test execution method and spec input choices belong to the owner: ask, do
  not assume.
- Evidence may hold sensitive data; masking covers known headers and patterns
  only. Do not paste raw bodies into shared channels without checking.
- Do not commit evidence directories.

## Report to the human

A table per non-pass: id, class, deciding observation, evidence paths,
proposed action. Then totals, open questions for the owner, and which rows you
recorded versus only proposed.
