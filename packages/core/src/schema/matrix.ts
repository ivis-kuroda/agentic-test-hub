import { z } from "zod";

import { Traceable } from "./common.ts";
import { FactorId, LevelId, MatrixId } from "./id.ts";

/**
 * How much of the condition space a matrix intends to cover.
 *
 * Stated explicitly because it is a judgement with consequences, not a
 * detail: a suite with fifteen factors has an intractable full product, and
 * the choice of how to sample it determines which defects are reachable at
 * all. Varying one factor at a time — the usual hand-written approach —
 * cannot by construction find an interaction between two factors.
 */
export const CoverageStrategy = z.enum([
  /** Change one factor from the baseline at a time. */
  "single_factor",
  /** Cover every pair of levels across factors at least once. */
  "pairwise",
  /** Every combination. Only viable for very few factors. */
  "full",
]);
/** How much of the condition space a matrix intends to cover. */
export type CoverageStrategy = z.infer<typeof CoverageStrategy>;

/**
 * A combination deliberately left untested, with the reason why.
 *
 * The distinction a reviewer cares about is between "considered and ruled
 * out" and "not thought of". An empty cell cannot express the former, so
 * exclusions carry a mandatory reason and are rendered differently from gaps.
 */
export const Exclusion = z.object({
  /** Partial assignment of levels that this exclusion covers. */
  when: z.record(FactorId, LevelId),
  /** Why the combination need not be tested. Shown to reviewers verbatim. */
  reason: z.string().min(1),
});
/** A combination deliberately left untested. */
export type Exclusion = z.infer<typeof Exclusion>;

/**
 * A two-dimensional projection of the condition space, for review.
 *
 * A matrix declares its axes, its intended strategy and its exclusions. It
 * does not list which case fills which cell: that is computed by matching
 * case overrides against factor paths. Declaring it would create a second
 * place to maintain the same fact — precisely the duplication this system
 * exists to remove.
 */
export const Matrix = Traceable.extend({
  id: MatrixId,
  title: z.string().min(1),
  /** Factors forming the rows and columns of the rendered table. */
  axes: z.object({ rows: FactorId, cols: FactorId }),
  /**
   * Further factors held constant or folded into the cells. The reviewer
   * view offers them as alternative axes.
   */
  additional: z.array(FactorId).default([]),
  strategy: CoverageStrategy.default("single_factor"),
  exclusions: z.array(Exclusion).default([]),
});
/** A two-dimensional projection of the condition space, for review. */
export type Matrix = z.infer<typeof Matrix>;
