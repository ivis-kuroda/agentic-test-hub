---
name: test-kickoff
description: Start an integration-test campaign by asking the owner one batch of questions per category (source of truth, target and baseline builds, SUT modification policy, verdict rules, fixtures, environment state, evidence format, repositories, reporting) and recording the answers as a numbered decision log in the project's AGENTS.md. Includes deriving the pre-change baseline with git merge-base and checking artifact provenance. Use at the start of a campaign, when a new spec version arrives, or when a decision log is missing. Not for decisions that come up mid-run (ask those individually) or for drafting spec entities (generate-spec).
---

# Kicking off a test campaign

Most owner interventions in a past campaign fell into nine categories, and
seven of them could have been decided on day one. Decide them up front, in
batches, with evidence; write each answer down once.

## Before asking

1. Create the knowledge repository from `templates/project-knowledge/` if it
   does not exist.
2. **Artifact provenance check** for every input document (spec text,
   spreadsheet, design docs, earlier test assets). For each, record:
   - the version label inside the file **and** the version it really is
     (compare content, change history, dates; labels are often stale);
   - who wrote it and for what (a pruned viewpoint sheet and a full case list
     are authoritative for different things);
   - which aspect it is authoritative for (viewpoints, cases, expected values,
     delivery layout).
   Do not choose "the newer-looking file wins". Present the comparison.
3. **Baseline derivation** (when the spec compares against the pre-change
   behaviour). Never copy a "branch point" from a design document; derive it:
   ```
   git -C <target> log --oneline --merges <target-branch> | head -20
   git -C <target> merge-base <target-branch> <upstream-branch>
   git -C <target> log --oneline <baseline>..<target-branch> | wc -l   # commits of this change
   git -C <target> log --oneline --first-parent <baseline>..<target-branch>
   ```
   Check which upstream was merged into the target last, and that
   `<baseline>..<target>` contains only the change's commits. Present the
   commit, the count, and how you got it; the owner confirms. A wrong baseline
   was once 343 commits too old because it came from a document.
4. Gather what can be measured without asking (repos, branches, which stacks
   exist, resources of the host).

## Question batches (AskUserQuestion, one category per round)

For every question: the evidence, the options, the **impact** (how many steps
or verdicts depend on it) and your recommendation.

| # | Category | Decide |
|---|---|---|
| 1 | Source of truth | authoritative document per aspect; its real version; how earlier-version assets are used (as parts, not as truth) |
| 2 | Target and baseline | target repo/branch/commit; baseline commit (derived above); where the baseline runs (separate clone); "one stack at a time" |
| 3 | SUT modification policy | may source be changed or monkeypatched (usually never); what counts as config vs source; data/DB writes allowed for preparation or only screens/API; clean-up by SQL allowed?; what a mock that cannot be reproduced becomes (`not_runnable` with reason) |
| 4 | Verdict rules | the verdict set and labels (ok / ng / deferred / not_runnable / not_issuable, plus "not judged" for preparation); precedence; notation equivalences (e.g. spec shorthand vs real error-code format); log rule (positive line required; coexisting error lines = remark or failure) |
| 5 | Fixtures | created through screens/API or data; credentials issued just in time; consumed fixtures re-created by which rule |
| 6 | Environment state | default "leave vs restore" for each kind of change; external hosts to block; settings switched per step only |
| 7 | Evidence and delivery | screenshot by default, text only when impossible; one item per operation; one sheet per step; results one row per case; image width, separators, labels |
| 8 | Repositories and VCS | which repos may be changed; branch names; commit yes, push no?; foreign edits left untouched |
| 9 | Reporting cadence | status table format, progress unit, how deferred/not-runnable are explained (with unblock path) |

Scope changes (cases to add/drop) are not pre-decidable: they come out of
`spec-reconcile`.

## Recording

Append each answer to the decision log in `AGENTS.md` as one numbered entry:

```
N. **<short rule>** (owner, YYYY-MM-DD). <detail, scope, exceptions>.
```

Rules: numbers never reused; a reversed decision gets a new entry that names
the one it replaces ("replaces the commit in decision 9"); the date and "owner"
always appear; agent-made judgements are not decisions until the owner
confirms them. Commit the log after each batch.

## Report to the owner

The decisions recorded (numbers), the provenance table, the derived baseline
with its commands, and the questions still open with their impact.
