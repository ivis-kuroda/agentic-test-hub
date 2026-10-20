# AGENTS.md — <project> test knowledge

Entry point for AI agents. This repository holds knowledge about the system
under test (SUT) and the state of the integration test of `<spec>`. It
contains no application code.

## Where things are

| Path | What |
|---|---|
| `docs/testing/<spec>/HANDOFF.md` | **Start here when resuming** |
| `docs/app/ui-operations.md` | Screens and selectors (registry, UNVERIFIED/VERIFIED) |
| `docs/testing/<spec>/test-plan.md` | How the spec is executed |
| `docs/testing/<spec>/findings.md` | Findings F-nn |
| `docs/testing/<spec>/env-changes/README.md` | Changes made to the running SUT |
| `docs/testing/<spec>/status-summary.md` | Current status (computed) |
| `<spec file>` | **The authoritative specification** (real version: <v>) |

Sibling checkouts (read-only unless stated):

- `<sut repo>` — the SUT, branch `<branch>`. **Never modify it.**
- `<plugin repo>` — test code for this SUT; may be modified on branch `<branch>`.
- `<hub repo>` — generic hub; <may / may not> be modified.

## Binding decisions

Numbered, never renumbered. A reversal is a new entry naming the one it
replaces. Each entry: rule in bold, who and when, detail.

1. **Authoritative documents** (owner, YYYY-MM-DD). <which file is
   authoritative for viewpoints, cases, expected values, delivery layout; real
   versions>.
2. **Target and baseline builds** (owner, YYYY-MM-DD). Target `<branch>@<sha>`;
   baseline `<sha>` derived with `git merge-base` (`<command>`); baseline runs
   from `<separate clone>`; one stack at a time.
3. **SUT modification policy** (owner, YYYY-MM-DD). <source never modified, not
   monkeypatched; what counts as configuration; a mock that cannot be
   reproduced by data/config/environment is not_runnable with the reason>.
4. **Verdicts** (owner, YYYY-MM-DD). <ok / ng / deferred / not_runnable /
   not_issuable / not judged; labels; precedence ng > deferred > not_runnable
   > ok; notation equivalences>.
5. **Log rule** (owner, YYYY-MM-DD). <expected line must exist at level X;
   coexisting error lines are remarks / failures>.
6. **Fixtures** (owner, YYYY-MM-DD). <created via screens/API; credentials
   just in time; consumed fixtures re-created by rule>.
7. **Environment defaults** (owner, YYYY-MM-DD). <leave vs restore; blocked
   external hosts; per-step settings>.
8. **Evidence** (owner, YYYY-MM-DD). <screenshot by default; one item per
   operation; one sheet per step; results one row per case>.
9. **Repositories** (owner, YYYY-MM-DD). <which may change; branches; commit,
   no push; foreign edits left alone>.
10. **Reporting** (owner, YYYY-MM-DD). <status format and cadence>.

## Rules for agents

- Ask the owner (AskUserQuestion) before any decision not covered above, with
  the impact count and a recommendation. Report every judgement you made on
  your own.
- One process drives the SUT at a time. Parallel agents only for read-only or
  offline work.
- Expected values come from the spec and the design, never from observations.
- Every SUT change is restored in `finally`, proven, and logged in
  `env-changes/README.md`.
- A selector or behaviour marked **UNVERIFIED** comes from reading code. When
  confirmed on the live SUT, the orchestrator changes it to
  `VERIFIED <date>` and fixes what was wrong.
- Counts are computed from the results file; titles are taken from the spec.
- Documents for agents are in English. Messages to the owner are in
  <owner language>.
- Never commit secrets (tokens, cookies, `.env`).
