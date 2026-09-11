import { deepEqual } from "./equal.js";
import { applyOverrides, getAtPath } from "./path.js";
import type { Baseline } from "../schema/baseline.js";
import type { TestCase } from "../schema/case.js";
import type { Factor, Level } from "../schema/factor.js";

/** Which level of each factor a case sits at. */
export type Placement = Readonly<Record<string, string>>;

/**
 * Finds the level a resolved value corresponds to.
 *
 * @param factor - Factor whose levels are candidates.
 * @param present - Whether the path was set at all.
 * @param value - The value found, when present.
 * @returns The matching level, or `undefined` when the value corresponds to
 *   no declared level — which is itself worth reporting, since it means the
 *   factor's levels do not describe the suite.
 */
export function matchLevel(factor: Factor, present: boolean, value: unknown): Level | undefined {
  if (!present) return factor.levels.find((level) => level.absent);
  return factor.levels.find((level) => !level.absent && deepEqual(level.value, value));
}

/**
 * Works out where a case sits on each factor, by resolving the baseline with
 * the case's overrides applied and matching the result against factor levels.
 *
 * Deriving placement rather than declaring it is what keeps the matrix and
 * the cases from drifting apart: a case that changes which header it omits
 * moves on the matrix automatically, because the override *is* the placement.
 *
 * An explicit `at` on the case wins, for factors that are not expressible as
 * a single override.
 *
 * @param testCase - The case to place.
 * @param baseline - The baseline it refers to.
 * @param factors - Factors to place it against. Those without a `path` are
 *   skipped unless the case declares them explicitly.
 * @returns The level of each factor the case could be placed on.
 */
export function derivePlacement(
  testCase: TestCase,
  baseline: Baseline,
  factors: readonly Factor[],
): Placement {
  const resolved = applyOverrides(baseline, testCase.overrides);
  const placement: Record<string, string> = {};

  for (const factor of factors) {
    const declared = testCase.at?.[factor.id];
    if (declared !== undefined) {
      placement[factor.id] = declared;
      continue;
    }
    if (factor.path === undefined) continue;

    const found = getAtPath(resolved, factor.path);
    const level = matchLevel(factor, found.present, found.present ? found.value : undefined);
    if (level) placement[factor.id] = level.id;
  }

  return placement;
}
