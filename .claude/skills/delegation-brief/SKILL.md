---
name: delegation-brief
description: Fill in the delegation-brief template for an agent that explores screens, writes procedures, or runs a block of spec steps against a system under test — role/scope line, mandatory reading, binding decisions verbatim, per-step notes with measured timings, traps and fallbacks, rules, engineering, report contract and phase gating. Use every time the orchestrator hands work to ui-explorer, ui-procedure-author, scenario-runner or evidence-reviewer. Not for briefing pure read-only code searches (a one-paragraph prompt is enough).
---

# Writing a delegation brief

The agent knows nothing but the brief and the files it names. Briefs in this
shape produced blocks that ran without rework; briefs without measured timings
or a report contract produced guesswork and long reports.

## Template

Copy, fill every `<...>`, delete sections that truly do not apply (say so in
one line rather than leaving them out silently).

```
ROLE AND SCOPE
You <explore | implement procedures for | implement and run> ONE block:
<step ids / screens>. You are the ONLY process driving the SUT now; run steps
sequentially. <Or: you have NO SUT access in this phase.>

MANDATORY READING (in this order)
1. <knowledge repo>/AGENTS.md — decision log (binding) and rules for agents
2. <knowledge repo>/docs/testing/<spec>/HANDOFF.md
3. Spec: <file> lines <a>-<b> (steps <ids>)
4. Domain docs: <selector registry §n>, <API notes §m>
5. Findings relevant here: <F-nn, F-mm>
6. Code to reuse (patterns): <module paths and function names>

BINDING DECISIONS (verbatim from the decision log; new ones marked NEW)
- <decision N text>
- NEW (owner, <date>): <text>; use <verdict helper> for it; precedence <...>

PER-STEP NOTES
<step id>:
- Method: <concrete method>
- Measured: <timing/window/latency with date and how measured>
- Traps: <e.g. "treat >= <limit> ms as an invalid attempt; retry up to 3; never pass it">
- Fallback: <allowed alternative>; "record the difference if you use it"
- Fixtures: uses <R-n>; consumes <R-m> → re-create by <rule>

RULES
- Expected values come from the spec and <code/catalogue>, never bent to
  observations — record NG with the observed values.
- Consumable fixtures are re-created before the next step that needs them.
- Config only via <guard> and verified restored (<proof command> empty at the end).
- Containers you stop are started again in finally and verified healthy.
- Every API call via <recording client>; a screenshot for every screen operation.
- Data you create is prefixed <probe-> and deleted at the end; prove it.
- Do NOT edit <docs/other repos>; return corrections in the report.
- Do not touch: <objects that must survive>.

ENGINEERING
- Run: <exact command>
- Lint/format/tests must pass: <commands>
- Small Conventional Commits ending with <trailer>; do not push.
- Only edit <repo/paths>. Regenerate <deliverables> at the end.
- Scratch/screenshots: <path>. Session names: <names>.

REPORT CONTRACT (< 1500 words, these headings)
1. Verdicts per step, non-ok checks with observed values
2. Deviations from spec/brief with evidence paths
3. Every SUT/data/config change and its restore proof
4. Fixture consumption and re-creations
5. Commits; test counts
6. Judgements you made on your own
7. Questions for the owner (with impact)

PHASE GATING (for risky work)
Do PHASE A only now (<code only; no SUT access>), then report and stop.
I will message you to start PHASE B (<live run>).
```

## Variants

- **Exploration** (`ui-explorer`): add "do NOT edit docs (the orchestrator
  integrates your report)", the probe prefix and the deletion-proof query,
  "return the exact agent-browser commands that worked", and the UNVERIFIED
  registry section to confirm.
- **Procedure authoring**: list the VERIFIED registry entries allowed; the
  helper set to reuse; the migration properties (one entry function, typed
  params, dict results, one evidence recorder).
- **Evidence review**: run directory, step ids, the evidence rules, and
  "change nothing".

## Checks before sending

- Every number in "Measured" has a date and a method; no guessed timings.
- Binding decisions are pasted, not paraphrased.
- The block fits in about an hour; otherwise split it.
- No other SUT writer is running (or the brief says "no SUT access").
- No secrets in the brief; credentials are referenced by where they live.
