import type { Baseline } from "./schema/baseline.ts";
import type { TestCase } from "./schema/case.ts";
import type { Factor } from "./schema/factor.ts";
import type { Matrix } from "./schema/matrix.ts";
import type { Scenario } from "./schema/scenario.ts";
import type { Viewpoint } from "./schema/viewpoint.ts";

/**
 * Every specification for one target, in memory.
 *
 * A plain shape rather than a class: it is assembled by whatever read the
 * files, and consumed by exporters, validators and the editor, none of which
 * should need to know where it came from.
 */
export interface Suite {
  readonly viewpoints: readonly Viewpoint[];
  readonly factors: readonly Factor[];
  readonly matrices: readonly Matrix[];
  readonly baselines: readonly Baseline[];
  readonly cases: readonly TestCase[];
  readonly scenarios: readonly Scenario[];
}

/** An empty suite, for building one up. */
export const EMPTY_SUITE: Suite = {
  viewpoints: [],
  factors: [],
  matrices: [],
  baselines: [],
  cases: [],
  scenarios: [],
};

/** A reference that does not resolve, or a rule the suite breaks. */
export interface SuiteProblem {
  /** Where the problem is, as `kind/id` or `kind/id.field`. */
  readonly at: string;
  readonly message: string;
  /**
   * Whether the suite is unusable as a result.
   *
   * A dangling baseline reference makes a case unrunnable and is an error. A
   * viewpoint nothing references is worth reporting and blocks nothing, so it
   * is a warning. Conflating the two means either blocking work on advice or
   * shipping with broken references.
   */
  readonly severity: "error" | "warning";
}

function duplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) repeated.add(id);
    seen.add(id);
  }
  return [...repeated];
}

/**
 * Reports every reference in a suite that does not resolve.
 *
 * Run when a specification is saved and again in CI. Catching a dangling
 * reference at save time is worth far more than catching it during a run: the
 * person who made it is still there, and no report has yet been produced from
 * a suite that was quietly incomplete.
 *
 * Problems are collected rather than thrown at the first one, because someone
 * fixing a rename wants the whole list.
 *
 * @param suite - The suite to check.
 * @returns Every problem found, errors and warnings together.
 */
export function validateSuite(suite: Suite): SuiteProblem[] {
  const problems: SuiteProblem[] = [];
  const error = (at: string, message: string): void => {
    problems.push({ at, message, severity: "error" });
  };
  const warn = (at: string, message: string): void => {
    problems.push({ at, message, severity: "warning" });
  };

  const viewpointIds = new Set(suite.viewpoints.map((viewpoint) => viewpoint.id));
  const factorsById = new Map(suite.factors.map((factor) => [factor.id, factor]));
  const baselineIds = new Set(suite.baselines.map((baseline) => baseline.id));

  for (const [kind, ids] of [
    ["viewpoint", suite.viewpoints.map((entity) => entity.id)],
    ["factor", suite.factors.map((entity) => entity.id)],
    ["matrix", suite.matrices.map((entity) => entity.id)],
    ["baseline", suite.baselines.map((entity) => entity.id)],
    ["case", suite.cases.map((entity) => entity.id)],
    ["scenario", suite.scenarios.map((entity) => entity.id)],
  ] as const) {
    for (const id of duplicates(ids)) {
      error(`${kind}/${id}`, "identifier is used more than once");
    }
  }

  const requireViewpoints = (at: string, refs: readonly string[]): void => {
    for (const ref of refs) {
      if (!viewpointIds.has(ref)) error(at, `refers to viewpoint ${ref}, which does not exist`);
    }
  };

  for (const viewpoint of suite.viewpoints) {
    requireViewpoints(`viewpoint/${viewpoint.id}.parents`, viewpoint.parents);
    if (viewpoint.parents.includes(viewpoint.id)) {
      error(`viewpoint/${viewpoint.id}.parents`, "lists itself as a parent");
    }
  }

  for (const factor of suite.factors) {
    for (const id of duplicates(factor.levels.map((level) => level.id))) {
      error(`factor/${factor.id}`, `level ${id} is declared more than once`);
    }
    const absent = factor.levels.filter((level) => level.absent);
    if (absent.length > 1) {
      error(
        `factor/${factor.id}`,
        "more than one level is marked absent, so a missing value is ambiguous",
      );
    }
  }

  for (const matrix of suite.matrices) {
    requireViewpoints(`matrix/${matrix.id}.viewpoints`, matrix.viewpoints);
    for (const [axis, id] of [
      ["rows", matrix.axes.rows],
      ["cols", matrix.axes.cols],
    ] as const) {
      if (!factorsById.has(id)) {
        error(`matrix/${matrix.id}.axes.${axis}`, `refers to factor ${id}, which does not exist`);
      }
    }
    if (matrix.axes.rows === matrix.axes.cols) {
      error(`matrix/${matrix.id}.axes`, "uses the same factor for both axes");
    }
    for (const id of matrix.additional) {
      if (!factorsById.has(id)) {
        error(`matrix/${matrix.id}.additional`, `refers to factor ${id}, which does not exist`);
      }
    }
    for (const [index, exclusion] of matrix.exclusions.entries()) {
      for (const [factorId, levelId] of Object.entries(exclusion.when)) {
        const factor = factorsById.get(factorId);
        if (!factor) {
          error(
            `matrix/${matrix.id}.exclusions[${index}]`,
            `refers to factor ${factorId}, which does not exist`,
          );
          continue;
        }
        if (!factor.levels.some((level) => level.id === levelId)) {
          error(
            `matrix/${matrix.id}.exclusions[${index}]`,
            `refers to level ${levelId}, which factor ${factorId} does not declare`,
          );
        }
      }
    }
  }

  for (const testCase of suite.cases) {
    const at = `case/${testCase.id}`;
    if (!baselineIds.has(testCase.baseline)) {
      error(at, `refers to baseline ${testCase.baseline}, which does not exist`);
    }
    requireViewpoints(`${at}.viewpoints`, testCase.viewpoints);
    for (const [index, expectation] of testCase.expect.entries()) {
      requireViewpoints(`${at}.expect[${index}]`, expectation.viewpoints);
    }
    for (const [factorId, levelId] of Object.entries(testCase.at ?? {})) {
      const factor = factorsById.get(factorId);
      if (!factor) {
        error(`${at}.at`, `refers to factor ${factorId}, which does not exist`);
        continue;
      }
      if (!factor.levels.some((level) => level.id === levelId)) {
        error(`${at}.at`, `refers to level ${levelId}, which factor ${factorId} does not declare`);
      }
    }
    if (testCase.expect.every((expectation) => expectation.kind === "unspecified")) {
      warn(at, "every expectation is unspecified, so nothing about it can be checked");
    }
  }

  for (const scenario of suite.scenarios) {
    const at = `scenario/${scenario.id}`;
    requireViewpoints(`${at}.viewpoints`, scenario.viewpoints);
    const stepIds = new Set<string>();
    for (const id of duplicates(scenario.steps.map((step) => step.id))) {
      error(at, `step ${id} is declared more than once`);
    }

    for (const step of scenario.steps) {
      const stepAt = `${at}/${step.id}`;
      requireViewpoints(`${stepAt}.viewpoints`, step.viewpoints);
      for (const [index, expectation] of step.expect.entries()) {
        requireViewpoints(`${stepAt}.expect[${index}]`, expectation.viewpoints);
      }
      for (const dependency of step.dependsOn) {
        if (dependency === step.id) {
          error(`${stepAt}.dependsOn`, "depends on itself");
        } else if (!stepIds.has(dependency)) {
          // Only earlier steps are in scope. A dependency on a later step is
          // either a typo or an ordering mistake, and both are worth naming
          // rather than resolving silently.
          error(
            `${stepAt}.dependsOn`,
            `depends on ${dependency}, which does not appear earlier in this scenario`,
          );
        }
      }
      stepIds.add(step.id);
    }
  }

  for (const viewpoint of suite.viewpoints) {
    const referenced =
      suite.cases.some(
        (testCase) =>
          testCase.viewpoints.includes(viewpoint.id) ||
          testCase.expect.some((expectation) => expectation.viewpoints.includes(viewpoint.id)),
      ) ||
      suite.scenarios.some((scenario) =>
        scenario.steps.some(
          (step) =>
            step.viewpoints.includes(viewpoint.id) ||
            step.expect.some((expectation) => expectation.viewpoints.includes(viewpoint.id)),
        ),
      );
    if (!referenced) {
      warn(`viewpoint/${viewpoint.id}`, "nothing verifies this viewpoint");
    }
  }

  return problems;
}

/** Reports whether any problem would make the suite unusable. */
export function hasErrors(problems: readonly SuiteProblem[]): boolean {
  return problems.some((problem) => problem.severity === "error");
}
