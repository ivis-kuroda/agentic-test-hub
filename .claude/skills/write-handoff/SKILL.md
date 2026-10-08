---
name: write-handoff
description: Hand in-progress work to a fresh Claude Code session on another machine by writing HANDOFF.md, committing it to a dedicated tmp/handoff-<topic> branch, pushing it, and giving the human a starting prompt. Use when asked to hand off, continue elsewhere, or when work needs an environment (live target, credentials, network) this session lacks.
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
6. Give the human one paragraph to start the new session, for example: "Clone
   <repo>, check out `tmp/handoff-<topic>`, read `HANDOFF.md` and `AGENTS.md`,
   follow the first-run checklist, and report before making any open
   decision."

## Sufficiency checklist

- A stranger could run the first command without asking anything.
- Every claim is tagged verified or UNVERIFIED.
- Every branch you mention exists on origin at the stated SHA.
- Open decisions are listed, not silently made.
- No secrets, no uncommitted state, no reliance on this session's files.

## Report to the human

Branch name, SHA, the starting prompt, and the top three UNVERIFIED items.
