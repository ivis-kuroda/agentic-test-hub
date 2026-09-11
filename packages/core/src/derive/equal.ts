/**
 * Structural equality for values read out of specification documents.
 *
 * Kept local rather than pulled from a library: the inputs are YAML-derived
 * plain data, so the comparison never has to reason about class instances,
 * cycles or exotic built-ins, and a dependency would buy nothing.
 *
 * @param a - First value.
 * @param b - Second value.
 * @returns `true` when the two are structurally identical.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every((key) => Object.hasOwn(right, key) && deepEqual(left[key], right[key]));
}
