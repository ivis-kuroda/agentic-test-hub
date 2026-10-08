---
name: generate-test
description: Turn reviewed spec entities (cases or scenarios in a plugin repository) into committed, runnable Python or TypeScript test code with ath-generate-test. Use when asked to generate, regenerate, or commit automated tests for TC-/SC- ids that already passed human review. Not for drafting the specs themselves (use generate-spec).
---

# Generating test code from reviewed specs

Operationalizes "AI at authoring time, deterministic code at run time" in
`docs/ARCHITECTURE.md`. Generated code is committed and then run
deterministically; a generated file that was never run is not a deliverable.

## Before you start

Establish, by asking if the request does not say:

1. **Which entities** (`TC-...`/`SC-...`) and that their specs are reviewed
   and merged (or at least on a branch the human named). Never generate from
   an unreviewed `spec-draft/*` branch unless told to.
2. **Paths:** `--specs` (the suite's specs dir), `--plugin` (the target's
   `plugin.yaml`), `--plugin-root` (the plugin repo root), and `--out` (where
   committed tests live in the plugin repo).
3. **Language.** Python is primary. TypeScript refuses plans that use
   Python-only features (e.g. `multipart`; see `pythonOnlyFeatures` in
   `packages/cli/src/plan.ts`) — use `--lang python` then, do not edit the plan.
4. **Where it will run** (live target or a rig). The execution method is the
   owner's decision: ask, do not assume.

## Procedure

1. Check the specs: `pnpm specs:check && pnpm specs:validate`.
2. Generate, once per entity (build the CLI first if needed: `pnpm build`):
   ```
   ath-generate-test <TC-or-SC-id> --specs <specs> --plugin <plugin.yaml> \
     --plugin-root <plugin-repo> --lang python \
     [--python-extensions-module <path/to/extensions.py>] --out <out-file>
   ```
   Exit 1 = refused or already generated (rerun with `--force` only when a
   regeneration is intended); exit 2 = usage error.
3. **Read the generated file.** Check imports resolve (missing imports have
   happened), the extensions module path is right, and the module name is
   importable. Hyphenated module names cannot be imported: name the file with
   underscores or load it by path.
4. **Run it for real**, against the live target or a rig, with evidence on:
   `ATH_EVIDENCE_DIR=<dir> pytest <out-file> -x` (see
   `python/agentic-test-hub-runner` docs). A collection error or a skip is not
   a run. If it fails, fix the cause (plugin, extensions, environment); do not
   edit assertions to make it green — hand failures to `triage-run-result`.
5. **Strip debug patches.** Temporary hacks used to get it running (browser
   executable paths, hard-coded URLs, tokens, skipped steps) must never be
   committed. After staging: `git diff --cached | grep -n -i -E
   "executable_path|/home/|/tmp/|token|password|skip"` and inspect hits.
6. **Two branches, because generation writes into the spec.** The CLI sets
   `automation: generated` (and `impl`) in the entity's spec file. That is spec
   content. Follow the review convention of the `generate-spec` skill:
   - **Code branch** (the branch you were asked to work on): commit only the
     generated test code (and any extensions/plugin fixes).
   - **Spec branch** (e.g. `spec-draft/automation-<topic>`, created from the
     current branch): commit only the changed spec files, push, then return to
     the code branch (`git checkout -`). Never merge or open a PR for it.
   Revert the spec-file change from the code branch's working tree before
   committing (`git restore <spec file>` after saving it to the spec branch).
7. Commit per `docs/GIT.md` (small commits, Conventional Commits, trailer),
   then `git fetch origin && git rebase origin/<branch> && git push`. Push
   often. Confirm CI is green before reporting.
8. Leave `git status` clean.

## Pitfalls

- Generating the same id twice without `--force` is refused on purpose.
- Evidence files may contain data from the live target; they belong in
  `ATH_EVIDENCE_DIR`, never in git.
- A green run against a polluted target proves little; check preconditions and
  cleanup results (`ScenarioRunResult.cleanup`) before trusting it.
- The hub must not name any specific target application; keep such knowledge in
  the plugin repo. `pnpm check` includes the lint.

## Report to the human

Entities generated (id, output path, language), what was actually run and
against what, the verdict of each run, the two branch names and commit SHAs,
CI status, anything left UNVERIFIED, and open decisions (execution method,
`--force` regenerations).
