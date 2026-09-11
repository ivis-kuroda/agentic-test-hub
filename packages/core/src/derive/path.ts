import type { Baseline } from "../schema/baseline.js";
import type { Override } from "../schema/case.js";

/**
 * A value read from a resolved baseline, distinguishing "absent" from
 * "present and undefined".
 *
 * The distinction is load-bearing: a great many test conditions are exactly
 * "this header is not sent", and collapsing that into `undefined` makes such
 * a case indistinguishable from one nobody configured.
 */
export type Resolved =
  | { readonly present: true; readonly value: unknown }
  | { readonly present: false };

/** Marks a value as absent. */
export const ABSENT: Resolved = { present: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads a dotted path out of a nested structure.
 *
 * @param root - Structure to read from.
 * @param path - Dotted path such as `context.headers.Accept`. Path segments
 *   are plain object keys; segments containing dots are not supported.
 * @returns The value, or {@link ABSENT} when any segment is missing.
 */
export function getAtPath(root: unknown, path: string): Resolved {
  let current: unknown = root;
  for (const segment of path.split(".")) {
    if (!isRecord(current) || !(segment in current)) return ABSENT;
    current = current[segment];
  }
  return { present: true, value: current };
}

/**
 * Writes a dotted path into a nested structure, creating intermediate
 * objects as needed. Mutates `root`.
 *
 * @param root - Structure to write into.
 * @param path - Dotted path to write.
 * @param value - Value to store.
 */
export function setAtPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(".");
  const last = segments.pop();
  if (last === undefined) return;
  let current: Record<string, unknown> = root;
  for (const segment of segments) {
    const next = current[segment];
    if (!isRecord(next)) current[segment] = {};
    current = current[segment] as Record<string, unknown>;
  }
  current[last] = value;
}

/** Removes a dotted path from a nested structure. Mutates `root`. */
export function removeAtPath(root: Record<string, unknown>, path: string): void {
  const segments = path.split(".");
  const last = segments.pop();
  if (last === undefined) return;
  let current: unknown = root;
  for (const segment of segments) {
    if (!isRecord(current)) return;
    current = current[segment];
  }
  if (isRecord(current)) delete current[last];
}

/** A baseline with a case's overrides applied. */
export interface ResolvedBaseline {
  readonly target: Baseline["target"];
  readonly preconditions: readonly string[];
  readonly config: Record<string, unknown>;
  readonly context: Record<string, unknown>;
  readonly action: Baseline["action"];
}

/**
 * Applies a case's overrides to its baseline, producing the fully expanded
 * definition a runner executes.
 *
 * Expansion is deliberately total: the result carries no inheritance and no
 * references to resolve, because everything downstream — the execution view,
 * matrix placement, generated code — is easier to get right when nothing is
 * implied.
 *
 * @param baseline - The family's starting point.
 * @param overrides - Differences to apply, in order.
 * @returns A new structure; `baseline` is not modified.
 */
export function applyOverrides(
  baseline: Baseline,
  overrides: readonly Override[],
): ResolvedBaseline {
  const draft = structuredClone({
    config: baseline.config,
    context: baseline.context,
    action: baseline.action,
  }) as Record<string, unknown>;

  for (const override of overrides) {
    if (override.op === "remove") {
      removeAtPath(draft, override.path);
      continue;
    }
    if (override.op === "append") {
      const existing = getAtPath(draft, override.path);
      const list = existing.present && Array.isArray(existing.value) ? existing.value : [];
      setAtPath(draft, override.path, [...list, override.value]);
      continue;
    }
    setAtPath(draft, override.path, override.value);
  }

  return {
    target: baseline.target,
    preconditions: baseline.preconditions,
    config: draft["config"] as Record<string, unknown>,
    context: draft["context"] as Record<string, unknown>,
    action: draft["action"] as Baseline["action"],
  };
}
