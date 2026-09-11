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
- Run results are *not* specifications. They live outside git entirely, keyed
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

A plugin is primarily *configuration*, not code: a `plugin.yaml` declaring
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

| View | Audience | Shape |
|---|---|---|
| Execution | Playwright, AI agents | Baselines fully expanded, every reference resolved, no inheritance |
| Review | External reviewers | Viewpoints with their rationale, the coverage matrix, gaps; steps collapsed |
| Delivery | Contractual deliverable | The organisation's existing spreadsheet layout, one row per step |

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
noise is filtered by pattern so the condition asks whether *this change*
introduced anything — and suppressed entries are counted, so the allowance
stays visible rather than quietly growing.

## AI at authoring time, deterministic code at run time

Running an agent for every test execution is slow, expensive and
non-reproducible. The division is:

| Phase | Who |
|---|---|
| Deriving factors and levels from design documents and implementation | AI, reviewed by a human |
| Deciding which combinations to test | Human, from AI proposals |
| Writing the test code | AI; output is committed |
| Routine execution | The committed code |
| Diagnosing a failure | AI, reading trace, logs and screenshots |
| Assertions that need judgement | AI, only for expectations typed as such |

Combination explosion is real: a suite with fifteen factors has an
intractable full product. Strategy is explicit per matrix — vary one factor at
a time, cover all pairs, or take the full product — and it is a human's choice.
