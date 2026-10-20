---
name: status-report
description: Produce the campaign status from the results file — a per-scenario table with counts per verdict (including partial-OK), per-step reasons for every non-OK step, and an unblock path with its cost for every deferred or not-runnable step; all counts computed by script, titles taken from the spec. Use at the end of each block, before a handoff, or when the owner asks for progress. Not for classifying individual failures (triage-run-result) or for verifying an agent's report (verify-claims).
---

# Writing the status report

The owner should never have to ask "is the rest runnable?". Every number is
computed; every non-OK step says why and what would unblock it.

## Inputs

- The results file (one record per step: id, verdict, checks with status and
  observed value, remarks) and the evidence index.
- The spec, for step titles (verbatim) and scenario names.
- `findings.md` for the finding ids behind NGs.

## Procedure

1. **Compute** with a script kept in the project repo (so the next report is
   the same command):
   - per scenario: steps, and counts per verdict;
   - **partial-OK**: verdict ng but some checks ok (report "ok n / total m");
   - for deferred steps, the reason class (baseline, operating criterion,
     external caller, reference document, …) as separate columns.
2. **Titles**: extract step titles from the spec; never retype them.
3. **Per-step sections** for every non-OK step: title, verdict, the failing
   checks with observed values (grouped by operation), the finding id, and
   evidence paths.
4. **Unblock path** for each deferred / not-runnable / not-issuable step:
   what is missing, who can provide it, the cost (time, a second stack, an
   owner decision), and whether it can run now.
5. Cross-check: totals equal the number of steps in scope; the scope
   (e.g. "execution steps only, preparation excluded") is stated.

## Skeleton

```
# Status — <spec> (<build>), as of <date>

- Source: <results file>; scope: <which steps>; computed by `<command>`

## 1. Per scenario
Verdict definitions: <ok / partial-ok / ng / deferred(<reason>) / not_runnable / not_issuable>

| Scenario | Steps | ok | partial-ok | ng | deferred(<r1>) | deferred(<r2>) | not_runnable | Non-OK steps |
|---|--:|--:|--:|--:|--:|--:|--:|---|

## 2. Partial-OK and NG steps
### <step id> <spec title> (ok n / m)
#### <operation> (ng k checks) — F-nn
<observed vs expected, evidence path>

## 3. Deferred steps (with unblock path)
## 4. Not runnable / not issuable (reason, decision number)
```

Language follows the reader: the owner's language for owner reports,
English for agent-facing docs (see the project's rules).

## Rules

- No hand counts; paste the command that produced the numbers.
- Verdict labels come from the decision log (localised labels allowed).
- A step re-judged by an owner decision cites the decision number.
