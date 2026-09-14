import type { TestCase } from "@agentic-test-hub/core";
import type { SaveResult, SpecStore } from "@agentic-test-hub/store";

/**
 * Marks a case as generated, pointing at the file generation just wrote.
 *
 * Scenarios have no `automation` field to update (see
 * `packages/core/src/schema/scenario.ts`) — only a case's own YAML gets this
 * write-back; a generated scenario's file is written to disk but the spec
 * itself is left otherwise untouched.
 *
 * @param store - The suite's `SpecStore`, so the write goes through the same
 *   optimistic-locking path as any other edit.
 * @param testCase - The case as loaded (its `automation` is replaced, not
 *   merged, so any stale `impl` from a previous language does not linger).
 * @param expectedHash - The hash last read for this case, from `SpecStore.load()`.
 * @param implPath - Where the generated test was written, relative to the
 *   target plugin repository.
 * @returns Where the updated case was written and its new hash.
 * @throws {ConflictError} When the case changed since `expectedHash` was read.
 */
export function writeGeneratedCase(
  store: SpecStore,
  testCase: TestCase,
  expectedHash: string,
  implPath: string,
): Promise<SaveResult> {
  const updated: TestCase = {
    ...testCase,
    automation: { status: "generated", impl: implPath },
  };
  return store.save({ kind: "case", entity: updated, expectedHash });
}
