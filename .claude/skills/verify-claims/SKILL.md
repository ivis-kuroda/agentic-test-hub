---
name: verify-claims
description: Verify an agent's hand-back report before anything from it is recorded — re-derive verdicts from the results file, back each NG with the SUT code, back each restore claim with a DB/state query, rerun the tests, compute counts, take step titles from the spec, and detect foreign edits with git status. Use after every scenario-runner, ui-explorer or ui-procedure-author hand-back, and before writing a status report or handoff. Not for triaging failures from scratch (triage-run-result) or for reviewing evidence images (evidence-reviewer).
---

# Verifying a hand-back

A report is a claim. Past reports have contained a false "restored" (leftover
internal clients), a wrong count (11 vs 10), paraphrased step titles, and an
explanation reasoned from names instead of data. Every one would have been
caught by this list.

## Checklist

Work through all items; write the outcome of each into your notes (ok /
corrected / could not check and why).

1. **Verdicts from the results file.** Load the results file (e.g.
   `results.json`) and recompute each step's verdict from its checks with the
   project's precedence. Compare with the report. Any mismatch: the file wins;
   ask the agent why.
   ```
   jq -r '.[] | [.step, .verdict, ([.checks[] | select(.status != "ok")] | length)] | @tsv' results.json
   ```
2. **Each NG backed by code.** Open the SUT code path that produces the
   observed behaviour (handler, validator, error mapping). Confirm the
   observation is what the code does and the expectation is what the
   spec/design says. If the code agrees with the expectation, suspect the test.
3. **Each restore claim backed by a query.** Run the read-only query that
   proves it: config file `git status --short` empty, service health,
   injected rows/triggers absent, locks/sessions released, created credentials
   gone. "Restored" without output is not accepted.
4. **Tests rerun by you.** Run the suite's lint and tests; compare the counts
   with the report (a 270 vs 201 discrepancy once revealed skipped modules).
5. **Counts computed, never hand-counted.** Every number you will write
   (steps per verdict, items, findings) comes from a command over the results
   file.
6. **Titles from the spec.** Step titles in summaries are extracted from the
   spec text, not retyped.
7. **Foreign edits.** `git status --short` (and `git log -3`) in every repo the
   agent could touch, including the SUT checkout. Unexpected changes are
   reported to the owner, not reverted by you.
8. **Inferences marked.** Explanations not checked against data stay
   UNVERIFIED in what you record.
9. **Deviations accepted explicitly.** Each deviation from the brief is
   either covered by a decision or goes to the owner.
10. **Commits exist** at the stated hashes, on the stated branch, not pushed
    if the rules say so.

## After the checklist

Only now update the decision log, env-change log, findings and status
(`test-orchestrator` "After every hand-back"). Note what you corrected in the
agent's claims in the commit message body.

## Report

One table: claim, how checked (command/file), result (confirmed / corrected
to X / unverifiable). Then the corrections that changed a verdict or count.
