# Toolchain

What runs, why it was chosen, and what each command is responsible for.

## Commands

| Command | What it does |
|---|---|
| `pnpm lint` | `oxlint --type-aware` — lint rules, including those needing type information |
| `pnpm lint:fix` | Applies the fixes oxlint can make safely |
| `pnpm fmt` | `oxfmt --write .` — formats and sorts imports |
| `pnpm fmt:check` | Fails if anything is unformatted |
| `pnpm typecheck` | `oxlint -A all --type-aware --type-check` — every lint rule off, type errors only |
| `pnpm test` | Vitest, per package |
| `pnpm check` | All of the above, in the order a reviewer would want them |

## Why the type check runs through oxlint

`oxlint --type-check` delegates to `oxlint-tsgolint`, which uses the native
TypeScript compiler rather than the JavaScript one. It reads the ordinary
`tsconfig.json`, so strictness settings apply exactly as they would to `tsc` —
this has been checked against `noUncheckedIndexedAccess`, not assumed.

`-A all` turns every lint rule off, leaving type errors as the only output.
That keeps the two concerns separate: `lint` answers "is this code well
formed", `typecheck` answers "does it type", and a failure names which.

The whole workspace typechecks in about a second, which is the point. A check
that is cheap enough to run on every save is run on every save.

## TypeScript packages

Two are installed, under deliberately chosen names:

| Dependency | Resolves to | Used by |
|---|---|---|
| `@typescript/native` | `typescript@7` | the native compiler the type check runs on |
| `typescript` | `@typescript/typescript6` | anything consuming the compiler's JavaScript API |

The alias exists because tooling that calls the compiler API programmatically
still expects the JavaScript implementation. Keeping both under distinct names
means neither has to be downgraded for the other.

## No build step

Nothing here compiles to JavaScript. Packages expose their TypeScript sources
directly (`"exports": { ".": "./src/index.ts" }`), tests execute those sources,
and Node runs them as they are — modern Node strips types itself, so a build
would only add a stale artifact to get out of sync with.

Two things follow, and both are enforced:

- **Relative imports name the file that exists**, with its real `.ts`
  extension. The `.js` convention exists for projects that emit JavaScript and
  must name their output; naming a file that will never exist is a promise
  this project does not keep.
- **`erasableSyntaxOnly` is on.** Node can strip type annotations but cannot
  execute TypeScript syntax that carries runtime behaviour — enums,
  namespaces, constructor parameter properties. The compiler rejects them, so
  the constraint is a build error rather than a runtime failure in whichever
  script happens to be run without a bundler.

There is no `vite.config`, because nothing is bundled. There is one
`vitest.config.ts` at the root, which runs every package as a project in a
single pass.

Nothing is published to a registry. Every package is `private`, and none
carries `files`, `main`, `types` or `publishConfig`.

## Lint configuration notes

`vitest/require-to-throw-message` is off. Schema tests assert that validation
rejects an input; pinning them to the validator's wording would couple them to
a dependency's message format, which changes for reasons unrelated to this
project. Tests that throw for reasons of our own still assert the message.

## Node version

Node 26 or newer, pinned in `engines`, `.node-version` and `.nvmrc`. The
version matters more than usual here: direct execution of TypeScript is what
removes the build step, and the `erasableSyntaxOnly` constraint exists to
serve it.

## Formatting

`oxfmt` sorts imports into bands: built-ins, external packages, first-party
`@agentic-test-hub/*` packages, then relative imports, with type-only imports
following the values they accompany in each band. Nothing about this is worth
arguing over in review, which is why it is automated.
