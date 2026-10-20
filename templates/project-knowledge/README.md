# Project-knowledge template

Skeleton of the repository an integration-test campaign keeps next to the
system under test (SUT): what the agents know about the SUT, what the owner
decided, what changed in the environment, what was found, and where the work
stands. It holds no application code and no secrets.

Agents in `.claude/agents/` and skills in `.claude/skills/` of the hub assume
this layout. Copy it once per project:

```
cp -r <hub>/templates/project-knowledge <project-knowledge-repo>
mv docs/testing/SPEC-ID docs/testing/<spec-id>      # e.g. the spec's short name and version
git init && git add . && git commit -m "docs: start project knowledge from the hub template"
```

Then run the `test-kickoff` skill: it fills the decision log in `AGENTS.md`.

| File | Kept by | Purpose |
|---|---|---|
| `AGENTS.md` | orchestrator | Entry point: index, numbered owner decisions, rules for agents |
| `docs/app/ui-operations.md` | orchestrator (from explorer reports) | Selector registry with `UNVERIFIED` / `VERIFIED <date>` marks |
| `docs/testing/<spec>/HANDOFF.md` | orchestrator (`write-handoff`) | Resume point, refreshed at each block boundary |
| `docs/testing/<spec>/test-plan.md` | orchestrator | Per-scenario method, phases, blocks |
| `docs/testing/<spec>/findings.md` | orchestrator (`verify-claims`) | Defect and spec-error candidates, F-nn |
| `docs/testing/<spec>/env-changes/README.md` | orchestrator (`env-change-guard`) | Every SUT mutation and its restore proof |
| `docs/testing/<spec>/status-summary.md` | orchestrator (`status-report`) | Computed status for the owner |

Plugin- or target-specific skills (e.g. a target's own browser recipes or
config procedure) go in this repository's `.claude/skills/` and should assume
the hub's generic skills, holding only what differs.

Language: agent-facing documents in English; owner-facing reports in the
owner's language. Record that choice in the decision log.
