---
name: write-handoff
description: Hand in-progress work to a fresh Claude Code session by writing HANDOFF.md and a resume prompt that puts open questions first. Two forms - hub work on another machine (tmp/handoff-<topic> branch, pushed), and a test campaign's project-knowledge HANDOFF refreshed at every block boundary or at about 60 % context. Use when asked to hand off or continue elsewhere, when work needs an environment this session lacks, or when a test block ends. Not for status reports to the owner (status-report).
---

# Writing a handoff

The next session has none of your context, only the repository. Everything it
needs must be in git. Honesty matters more than polish: mark what you did not
verify.

## Procedure

1. Settle the repo state: commit and push finished work on its own branches
   (`docs/GIT.md`), so `git status` is clean. Unfinished work goes to its
   branch too, labelled WIP.
2. Gather facts with commands, not memory: `git branch -vv`,
   `git log --oneline -15`, CI status for the latest pushes.
3. Write `HANDOFF.md` with these sections:
   - **Goal** and the state reached, in a few lines.
   - **Verified** (what you ran and observed, with the command and result) vs
     **UNVERIFIED** (written but never run, assumed, or untestable here).
   - **Branch/commit map:** branch -> SHA -> what it holds, which branch is the
     base, which are spec-draft branches awaiting review.
   - **Open questions** for the owner, first in the reading order of the
     next session (see "Resume prompt").
   - **Exact commands** to set up and to run (copy-pasteable), including paths
     and flags.
   - **Environment variables** by name and meaning (e.g. `ATH_EVIDENCE_DIR`);
     never values or secrets — say where the human provides them.
   - **Open decisions** for the owner, with options and your recommendation.
   - **First-run checklist:** ordered steps with the expected result of each.
   - **Known hazards:** debug patches not to commit, polluted state, generated
     files that write back into specs, flaky steps, hub rule that no specific
     target application is ever named.
4. Create the branch from the current HEAD and commit only the handoff:
   ```
   git switch -c tmp/handoff-<topic>
   git add HANDOFF.md && git commit   # conventional message + trailer
   git fetch origin && git push -u origin tmp/handoff-<topic>
   git switch -     # back to where you were; tree clean
   ```
   Never commit HANDOFF.md to a feature branch. `tmp/` branches are throwaway
   and are deleted once the work lands.
5. Check the file for secrets, hostnames or application names that must not be
   in the hub (`pnpm check` if it lives in the hub).
6. Give the human the resume prompt (see below), for example: "Clone
   <repo>, check out `tmp/handoff-<topic>`, read `HANDOFF.md` and `AGENTS.md`,
   ask me the open questions, then follow the first-run checklist."

## Test-campaign form (project-knowledge HANDOFF)

In a test campaign the handoff lives in the project's knowledge repository
(`docs/testing/<spec>/HANDOFF.md`, skeleton in
`templates/project-knowledge/`), on the campaign branch, and is **refreshed,
not re-created**:

- at every block boundary, after the hand-back was verified
  (`verify-claims`) and recorded;
- whenever the orchestrator's context passes about 60 %;
- before any heavy or destructive step that might kill the session.

Sections: goal and where we are (counts computed from the results file),
repositories/branches/commits, how to run, current SUT state (prepared
objects, deliberately open sessions, changes kept on purpose, backups),
remaining work, recent owner decisions (by number), open questions, working
pattern that worked. Each claim verified or UNVERIFIED as above. No push
unless the decision log allows it.

## Resume prompt

Always end with a prompt the human pastes into the new session. It fixes the
reading order and makes the open questions come first, so the new session
does not act on an undecided point:

```
You are resuming <campaign/topic>. Read, in this order:
1. <path>/HANDOFF.md
2. <path>/AGENTS.md (binding decisions 1–N)
3. <path>/findings.md and <path>/env-changes/README.md
Before doing anything else, ask me the "Open questions" in HANDOFF §<n>
(AskUserQuestion, with impact and your recommendation). Then continue with
"Remaining work" item 1. Working rules: <one SUT writer at a time; delegate
blocks; verify claims; language rules>.
```

## Sufficiency checklist

- A stranger could run the first command without asking anything.
- Every claim is tagged verified or UNVERIFIED.
- Every branch you mention exists on origin at the stated SHA.
- Open decisions are listed, not silently made, and the resume prompt asks
  them first.
- No secrets, no uncommitted state, no reliance on this session's files.

## Report to the human

Branch name, SHA, the starting prompt, and the top three UNVERIFIED items.
