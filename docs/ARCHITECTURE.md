# Architecture

Why the system is shaped the way it is. Read `docs/SPEC-MODEL.md` for the data
model itself.

## Source of truth

YAML files in git are authoritative. Everything else is derived and
disposable.

```
specs/**/*.yaml          authoritative
      |
      +-- search index    derived, rebuildable, never authoritative
      +-- delivery Excel  generated
      +-- reviewer HTML   generated
      +-- Playwright code generated once, then committed and maintained
```

The invariant that matters: **deleting the search index and rebuilding it from
the files must restore the system exactly.** Hold that and the storage
question stays open — an in-memory index today, SQLite or OpenSearch later, is
a re-index rather than a data migration. Break it (by storing something only
the index has) and the migration cost jumps.

Practical consequences:

- Anything a user edits goes in the YAML, not the index.
- Run results are _not_ specifications. They live outside git entirely, keyed
  by run id, because they are large, binary-heavy and disposable.

## Writing YAML from a web application

Editing happens in a web UI, which means a server process writes files that
git tracks. Four things are required and easy to forget:

1. **Deterministic serialisation.** Key order, quoting style, indentation and
   line wrapping must be identical for identical data, or every save produces
   a noisy diff and the review value of git evaporates. One module owns YAML
   output; nothing else writes YAML. CI asserts round-tripping produces a
   byte-identical file.
2. **Optimistic locking.** The editor carries the content hash it loaded and
   the write is rejected if the file changed underneath. Without this,
   concurrent edits silently lose data.
3. **A single writer.** File writes and git operations are serialised through
   one queue. Concurrent writes corrupt a working tree.
4. **Commit per save**, authored as the editing user, with a generated
   message. Branch strategy starts as direct-to-main with a diff preview
   before saving; that catches most of what review would catch, at a fraction
   of the complexity.

## The plugin boundary

The hub is generic; application-specific knowledge lives in a plugin
repository. The boundary is drawn at a deliberate place:

> The hub knows `shell`, `http`, `sql` and `browser`. It does not know any
> particular application.

Those four executors cover what integration tests actually need — running a
script in a container, seeding a database, writing to a search cluster,
calling an API, driving a browser. So the hub never needs application
knowledge in the first place.

A plugin is primarily _configuration_, not code: a `plugin.yaml` declaring
operations, connections and state providers. A TypeScript escape hatch exists
for the rare thing that cannot be declared. Keeping the common case
declarative means a plugin can be maintained by people who do not write
TypeScript.

## Preconditions are declarations, not procedures

A case declares the state it needs. It does not describe how to reach that
state. The plugin maps each state to an `ensure` and a `verify`.

```
verify()  ->  satisfied?  ->  skip ensure        (this is the fast path)
                           -> ensure() -> verify() -> proceed
                                                   -> fail as PRECONDITION_NOT_MET
```

Two properties matter more than they look:

- **Verify-first skips most setup work.** Setup is usually the dominant cost
  of an integration suite.
- **A failed precondition is not a failed assertion.** Reporting them
  identically is how hours get lost chasing a test failure that was really a
  seed script failing silently.

State is layered by cost: a suite-level snapshot restore, a group-level
declarative setup, and per-step state produced by earlier steps in a scenario.

## Baseline plus overrides

Cases in a matrix-style suite are almost always "the standard request, with
one thing changed". Modelling that literally — a complete `baseline` plus a
list of `overrides` — collapses several problems at once:

- The "same as above" idiom that pervades hand-written specifications has
  nowhere to live, because the baseline holds the shared part. Nothing depends
  on row position any more.
- An agent can execute a case, because the baseline is a complete definition
  and the overrides are machine-readable deltas.
- A change to the shared setup is one edit, not one per case.
- Cases sharing a baseline share its setup, so setup runs once per baseline
  rather than once per case.
- **The coverage matrix becomes derivable.** A factor is "which path is
  overridden"; a level is "to what value". Nobody maintains the matrix by
  hand, so it cannot drift from the cases.

Whether a case can share its group's environment is derivable too: overriding
only the request is shareable, while overriding configuration or setup demands
exclusive execution.

## Three generated views

One source, three audiences:

| View      | Audience                | Shape                                                                       |
| --------- | ----------------------- | --------------------------------------------------------------------------- |
| Execution | Playwright, AI agents   | Baselines fully expanded, every reference resolved, no inheritance          |
| Review    | External reviewers      | Viewpoints with their rationale, the coverage matrix, gaps; steps collapsed |
| Delivery  | Contractual deliverable | The organisation's existing spreadsheet layout, one row per step            |

Reviewers look at viewpoints and matrices far more than at steps, so the
review view is a first-class output rather than a by-product.

The delivery view re-creates presentational abbreviations such as "same as
above" at render time by collapsing repeated values. Those abbreviations are a
rendering concern; they never enter the source.

## Evidence, and what a pass is allowed to rest on

A screenshot shows what a page rendered. It cannot show that the service
returned the status it should have, that the database changed as claimed, or
that an exception was logged on the way. A suite that judges by appearance
certifies systems whose backend failed quietly.

So a verdict is reached across six channels — the rendered page, the browser
console, the network exchange, the data before and after, the application log
and the database log — and the rules for reading them are data, not runner
behaviour, so that the standard a team holds itself to is reviewable.

Three properties carry most of the weight:

- **Success and rejection are judged by opposite rules.** A quiet application
  log proves a success case and undermines a rejection case, where silence
  means the system failed to reject what it should have. A case says which it
  is; a runner cannot guess.
- **Missing evidence is never a pass.** A channel that was supposed to be read
  and was not yields `inconclusive`, so a broken collector shows up as a gap
  instead of a green run.
- **Weak evidence is never a pass on its own.** If the only channel that
  decided the outcome is one the policy marks insufficient alone, the result
  is `inconclusive`.

Not every case can produce every kind of evidence, and a requirement that
cannot be met gets switched off rather than met. So a case may waive a
channel — but the escape is deliberately uncomfortable: one channel at a time,
with a mandatory reason, never touching the channels the policy protects, and
visible in the reviewer view, so that a case resting on thin evidence looks
thin.

What a policy protects is where a team's non-negotiables live. The defaults
say a change must introduce no client-side errors, introduce no server-side
errors, and leave the data as it claimed.

One practical caveat: "no errors on this channel" is unusable against a mature
application, where existing warnings would fail every case. Known pre-existing
noise is filtered by pattern so the condition asks whether _this change_
introduced anything — and suppressed entries are counted, so the allowance
stays visible rather than quietly growing.

`evidence.ignore` on a case or scenario is a list of regular expressions. It
applies to every channel that is scanned for problems: `app_log`, `db_log` and
`db_records` output (matched against each line), browser console messages
(matched against text and location) and browser network failures (matched
against the URL). It is merged with any `ObserveOptions.ignore` a caller
passes in `RunOptions.observe`; both apply. Invalid patterns are dropped.

Collector output is scanned line by line for the words `error`, `exception`,
`traceback`, `fatal`, `critical` and `constraint violation` (whole words, any
case). The scan does not look at log levels: a `WARNING` line containing one
of those words is a problem unless an `ignore` pattern matches it.

## Judging an action's result

An `Expectation` of kind `result` judges the action's own `ExecutionResult`
(`operation_result` judges a separately run operation). Both carry an
`Assertion`, whose `equals`/`contains`/`matches`/`keys`/`one_of`/`compare`
kinds take an optional `at`: a dotted path into the result (`body.error`,
`headers.location`, `status`, `durationMs`, `exitCode`, `stdout`). A scenario
step's `produces` reads the same paths through the same helper
(`getResultAtPath` / `get_result_at_path`), so the two never disagree. Python
accepts the camelCase names from YAML and maps them to snake_case.

- `keys`: the subject is an object whose key _set_ equals `value`.
- `one_of`: the subject equals one of `values`, string/number tolerant.
- `compare`: `op` (`lt|lte|gt|gte`) against a number; the subject is coerced.
- `http_status.alsoAccepts`: further statuses that also satisfy it.

## What an `http` operation can send and report

- `optionalParams: [name, ...]` lists parameters a caller may leave out. The
  registry does not require them, and a header or multipart part whose
  template references an absent optional parameter is omitted from the
  request (an absent parameter from `params` still fails the run). A case
  expresses "this header is not sent" with `op: remove` on
  `action.params.<name>`; the removal is never undone by a same-named value
  in the baseline `context`.
- `multipart: [{name, file?, value?, filename?, contentType?}]` sends
  `multipart/form-data`; exactly one of `file` (a template, relative to the
  plugin root) or `value` per part. `filename` defaults to the file's
  basename and may be `""`. It excludes `body`/`bodyFile`, and the library
  sets the boundary `Content-Type`, so a configured one is ignored. Python
  only: `ath-generate-test --lang typescript` refuses plans that use it
  (`pythonOnlyFeatures` in `packages/cli/src/plan.ts`).
- `ExecutionResult.headers` holds response headers with lower-cased names.
  A step's `produces` entry is a dotted path or `{from, pattern}`, taking
  capture group 1 of `pattern` from the path's value (an identifier at the
  tail of a `Location` header, say). The pattern form must yield a value: if
  `from` is absent or the pattern does not match (or has no group 1), the
  step fails (verdict `fail`, reason in `StepRunResult.error`, e.g.
  `produces "recid": pattern /…/ did not match "<value>"`) and its
  dependants are skipped as inconclusive. A plain-path entry that is absent
  is unchanged: it produces nothing, and a later `{{step.name}}` fails loudly.

## Params are rendered before they are used

Every `params` map a spec hands to an operation (a baseline's or a step's
`action.params`, an `operation_result` expectation, a state's `ensure`/`verify`
and an evidence collector's own `params`) is rendered by the registry before it
joins the `param` scope. Every string inside it, nested values and keys
included, is rendered with the current `env`, `step`, `run` and already-present
`param` scopes. So a spec can write `token: "{{env.API_TOKEN}}"` and a later
scenario step can write `recid: "{{step.recid}}"`. A string that is only one
placeholder keeps a non-scalar value as it is. An unresolved placeholder fails
the run with an `ExecutorError` naming the operation, the param and the
placeholder.

Generated tests embed a case's action params as written, so placeholders reach
run time untouched and are rendered there. A secret that arrives this way is
still masked in saved evidence, because masking learns the credential values a
run sends. The operation's own templates (`{{param.name}}` in a path, header or
body) work as before and see the rendered values.

## Cleanup and the `run` scope

A scenario's `cleanup: [Step]` (a cleanup step's `expect` may be empty) always
runs after its steps and after evidence collection, even when a step failed or
raised; an exception then propagates once cleanup is done. Cleanup steps see
every `{{step.*}}` value produced earlier. A cleanup step that does not
complete or breaks an expectation cannot fail the scenario but caps its
verdict at `inconclusive`, because leftovers may now exist; each is reported
in `ScenarioRunResult.cleanup`. If preconditions were not met nothing ran, so
no cleanup runs.

`runCase`/`runScenario` give the template a `run` scope, unless the caller
already supplied one: `{{run.startedAt}}` (UTC ISO-8601, seconds, `Z`) and
`{{run.id}}` (short id). An evidence collector's `params` in the manifest are
rendered with the context scopes, so a collector can read only what this run
produced, for example `since: "{{run.startedAt}}"`.

## Saved evidence

Judging a verdict reads evidence in memory; a reviewer also needs the files.
The Python runner saves them when `ATH_EVIDENCE_DIR` is set (or
`RunOptions.evidence_dir` is passed). Unset, nothing is written and nothing
else changes. Generated tests need no edit: options come from the
environment.

```
<ATH_EVIDENCE_DIR>/<run-id>/index.json
<ATH_EVIDENCE_DIR>/<run-id>/<entity-id>/<location>/<phase>-<kind>-<name>.<ext>
```

`<run-id>` is `{{run.id}}`. `<location>` is `case`, `scenario` (collected
around all steps), `NN-<step-id>` or `cleanup-NN-<step-id>`. `<phase>` is
`before`, `after` or `during` (an http exchange); `diff-...` files are the
unified diff of a before/after pair. Repeated names get `-2`, `-3`.

| Kind | Evidence                                           | Files                                                                                                                                                             |
| ---- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | screenshot                                         | `{before,after}-screenshot-<op>.png` per browser operation                                                                                                        |
| 2    | browser console + network, or API request/response | `after-console-<op>.json`, `after-network-<op>.json` (with a 16 KiB `response_body_preview` for non-GET xhr/fetch); `during-network-http-<op>.json` per http call |
| 3    | DB records before/after                            | `{before,after,diff}-db-records-<collector op>`                                                                                                                   |
| 4    | application log                                    | `{before,after,diff}-app-log-<collector op>`                                                                                                                      |
| 5    | DB log                                             | `{before,after,diff}-db-log-<collector op>`                                                                                                                       |

`index.json` is rewritten atomically after every file, so it is always valid:
`{schemaVersion, runId, startedAt, entries[], warnings[]}`. An entry has
`kind` (1-5), `source` (the channel: `screenshot`, `browser_console`,
`browser_network`, `http_exchange`, `db_records`, `app_log`, `db_log`),
`path` (relative to the run directory), `capturedAt` (UTC), `phase`, `role`
(`capture` or `diff`), `entity`, `step` (id or null), `bytes` and `sha256`.
Saving never fails a run: a write error becomes a `warnings` entry.

**Timing.** Collector channels (kinds 3-5) are read before the action and
after it whenever evidence is being saved (except `timing: on_failure`), so
`before`, `after` and `each_step` all save before and after; `each_step` is
otherwise ignored in Python. `timing: before_and_after` additionally judges
`app_log` on the lines added since the before read (whole output when either
read failed); with any other timing the verdict still reads the whole
after output. The TypeScript runner does not save evidence and treats
`before_and_after` as `after`.

**Browser.** A `BrowserExecutor` keeps the last session it opened until the
run ends (`registry.close_all()`, called by `run_case`/`run_scenario` in a
`finally`) and the runner reads that session's console and network for the
verdict, so a policy binding `browser_console` now sees real page errors.

**Masking.** Everything text written is masked first. Values of the
`Authorization`, `Cookie`, `Set-Cookie`, `Proxy-Authorization` and
`X-API-Key` headers (any case) and of headers matching the manifest's
`redact.headers` regexes become `***REDACTED***`. `Bearer`/`Basic`
credentials, any secret value the run sent in such a header, and matches of
`redact.patterns` are masked in bodies, logs and header values. Multipart
requests record part names, filenames, content types and sizes, never file
bytes. The in-memory `ExecutionResult` is unchanged.

## Runtime parity

Python is the primary runtime; the TypeScript runner mirrors it where the
shared schema types force it. Everything above except `multipart` and saving
evidence to disk runs on both. `ath-generate-test --lang typescript` refuses a plan that uses a
Python-only feature (`pythonOnlyFeatures` in `packages/cli/src/plan.ts`,
alongside the unsupported-executor check) and says to use `--lang python`.
Add a feature there when it cannot be implemented in the TypeScript runner.

## AI at authoring time, deterministic code at run time

Running an agent for every test execution is slow, expensive and
non-reproducible. The division is:

| Phase                                                                | Who                                     |
| -------------------------------------------------------------------- | --------------------------------------- |
| Deriving factors and levels from design documents and implementation | AI, reviewed by a human                 |
| Deciding which combinations to test                                  | Human, from AI proposals                |
| Writing the test code                                                | AI; output is committed                 |
| Routine execution                                                    | The committed code                      |
| Diagnosing a failure                                                 | AI, reading trace, logs and screenshots |
| Assertions that need judgement                                       | AI, only for expectations typed as such |

Combination explosion is real: a suite with fifteen factors has an
intractable full product. Strategy is explicit per matrix — vary one factor at
a time, cover all pairs, or take the full product — and it is a human's choice.
