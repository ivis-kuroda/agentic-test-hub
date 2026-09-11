import { derivePlacement } from "./placement.js";
import type { Baseline } from "../schema/baseline.js";
import type { TestCase } from "../schema/case.js";
import type { Factor, Level } from "../schema/factor.js";
import type { Exclusion, Matrix } from "../schema/matrix.js";
import type { Scenario } from "../schema/scenario.js";
import type { Viewpoint } from "../schema/viewpoint.js";

/** What a reviewer sees in one cell of a rendered matrix. */
export type CellState =
  /** At least one case exercises this combination. */
  | { readonly kind: "covered"; readonly cases: readonly string[] }
  /** Deliberately not tested, for the stated reason. */
  | { readonly kind: "excluded"; readonly reason: string }
  /** Nothing covers it and no reason was given. This is the finding. */
  | { readonly kind: "gap" };

/** One cell of a rendered matrix. */
export interface MatrixCell {
  readonly row: Level;
  readonly col: Level;
  readonly state: CellState;
}

/** A matrix resolved against a concrete set of cases. */
export interface MatrixView {
  readonly matrix: Matrix;
  readonly rowFactor: Factor;
  readonly colFactor: Factor;
  /** Cells indexed as `cells[rowIndex][colIndex]`. */
  readonly cells: readonly (readonly MatrixCell[])[];
  readonly stats: {
    readonly covered: number;
    readonly excluded: number;
    readonly gap: number;
    readonly total: number;
  };
  /**
   * Cases that could not be placed on both axes.
   *
   * Usually means a factor's declared levels do not describe what the cases
   * actually do, which is worth surfacing rather than silently dropping.
   */
  readonly unplaced: readonly string[];
  /**
   * Exclusions constraining a factor that is not on either axis.
   *
   * They cannot be drawn on this projection without overstating what they
   * exclude, so they are reported alongside it instead.
   */
  readonly offAxisExclusions: readonly Exclusion[];
}

/** Inputs needed to resolve a matrix against a suite. */
export interface SuiteSlice {
  readonly factors: readonly Factor[];
  readonly baselines: readonly Baseline[];
  readonly cases: readonly TestCase[];
}

/** Separator for composite map keys. Safe because ids never contain it. */
const KEY_SEP = "::";

function requireFactor(factors: readonly Factor[], id: string): Factor {
  const factor = factors.find((candidate) => candidate.id === id);
  if (!factor) throw new Error(`matrix refers to unknown factor ${id}`);
  return factor;
}

function appliesToCell(
  exclusion: Exclusion,
  rowFactorId: string,
  colFactorId: string,
  rowLevelId: string,
  colLevelId: string,
): boolean {
  const constrained = Object.keys(exclusion.when);
  if (constrained.length === 0) return false;
  if (constrained.some((id) => id !== rowFactorId && id !== colFactorId)) return false;
  const wantRow = exclusion.when[rowFactorId];
  const wantCol = exclusion.when[colFactorId];
  if (wantRow !== undefined && wantRow !== rowLevelId) return false;
  if (wantCol !== undefined && wantCol !== colLevelId) return false;
  return true;
}

/**
 * Resolves a matrix against a suite, producing the grid a reviewer reads.
 *
 * The grid is computed, never authored. Its value to a reviewer is precisely
 * that it cannot flatter the suite: a combination nobody wrote a case for
 * shows as a gap whether or not anyone noticed, which reading a list of cases
 * in order will not reveal.
 *
 * @param matrix - The projection to render.
 * @param suite - Factors, baselines and cases to resolve against.
 * @returns The resolved grid, its statistics, and anything that could not be
 *   represented on it.
 */
export function buildMatrixView(matrix: Matrix, suite: SuiteSlice): MatrixView {
  const rowFactor = requireFactor(suite.factors, matrix.axes.rows);
  const colFactor = requireFactor(suite.factors, matrix.axes.cols);
  const baselines = new Map(suite.baselines.map((baseline) => [baseline.id, baseline]));

  const placed = new Map<string, string[]>();
  const unplaced: string[] = [];

  for (const testCase of suite.cases) {
    const baseline = baselines.get(testCase.baseline);
    if (!baseline) {
      unplaced.push(testCase.id);
      continue;
    }
    const placement = derivePlacement(testCase, baseline, suite.factors);
    const row = placement[rowFactor.id];
    const col = placement[colFactor.id];
    if (row === undefined || col === undefined) {
      unplaced.push(testCase.id);
      continue;
    }
    const key = `${row}${KEY_SEP}${col}`;
    const bucket = placed.get(key);
    if (bucket) bucket.push(testCase.id);
    else placed.set(key, [testCase.id]);
  }

  const offAxisExclusions = matrix.exclusions.filter((exclusion) =>
    Object.keys(exclusion.when).some((id) => id !== rowFactor.id && id !== colFactor.id),
  );

  let covered = 0;
  let excluded = 0;
  let gap = 0;

  const cells = rowFactor.levels.map((row) =>
    colFactor.levels.map((col) => {
      const hit = placed.get(`${row.id}${KEY_SEP}${col.id}`);
      if (hit && hit.length > 0) {
        covered += 1;
        return { row, col, state: { kind: "covered", cases: hit } as CellState };
      }
      const exclusion = matrix.exclusions.find((candidate) =>
        appliesToCell(candidate, rowFactor.id, colFactor.id, row.id, col.id),
      );
      if (exclusion) {
        excluded += 1;
        return { row, col, state: { kind: "excluded", reason: exclusion.reason } as CellState };
      }
      gap += 1;
      return { row, col, state: { kind: "gap" } as CellState };
    }),
  );

  return {
    matrix,
    rowFactor,
    colFactor,
    cells,
    stats: { covered, excluded, gap, total: covered + excluded + gap },
    unplaced,
    offAxisExclusions,
  };
}

/** How much evidence a single viewpoint has behind it. */
export interface ViewpointCoverage {
  readonly viewpoint: Viewpoint;
  /** Cases naming this viewpoint, directly or through an expectation. */
  readonly cases: readonly string[];
  /** Scenario steps naming it, as `scenarioId/stepId`. */
  readonly steps: readonly string[];
  /** True when nothing references it — a claim the suite does not check. */
  readonly uncovered: boolean;
}

/**
 * Reports, for each viewpoint, what actually verifies it.
 *
 * This is the inverse of the matrix and answers the other question reviewers
 * ask: not "which combinations are tested" but "is this particular claim
 * established at all". A viewpoint with no references is a stated intention
 * with nothing behind it.
 *
 * @param viewpoints - Viewpoints to report on.
 * @param cases - Cases that may reference them.
 * @param scenarios - Scenarios whose steps may reference them.
 * @returns One entry per viewpoint, in the order given.
 */
export function buildViewpointCoverage(
  viewpoints: readonly Viewpoint[],
  cases: readonly TestCase[],
  scenarios: readonly Scenario[],
): ViewpointCoverage[] {
  return viewpoints.map((viewpoint) => {
    const matchedCases = cases
      .filter(
        (testCase) =>
          testCase.viewpoints.includes(viewpoint.id) ||
          testCase.expect.some((expectation) => expectation.viewpoints.includes(viewpoint.id)),
      )
      .map((testCase) => testCase.id);

    const matchedSteps = scenarios.flatMap((scenario) =>
      scenario.steps
        .filter(
          (step) =>
            step.viewpoints.includes(viewpoint.id) ||
            step.expect.some((expectation) => expectation.viewpoints.includes(viewpoint.id)),
        )
        .map((step) => `${scenario.id}/${step.id}`),
    );

    return {
      viewpoint,
      cases: matchedCases,
      steps: matchedSteps,
      uncovered: matchedCases.length === 0 && matchedSteps.length === 0,
    };
  });
}
