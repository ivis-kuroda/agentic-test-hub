import type { Override, TestCase } from "../schema/case.ts";

/** Whether a case may share the environment prepared for its baseline. */
export type Isolation = "shared" | "exclusive";

/**
 * Path prefixes whose modification changes state outside the request, and so
 * cannot be shared with concurrently running cases.
 */
const EXCLUSIVE_PREFIXES = ["config", "preconditions", "target"] as const;

/**
 * Decides whether a case needs an environment of its own.
 *
 * Setup is normally the dominant cost of an integration suite, so cases are
 * grouped by baseline and prepared once. That is only sound for cases whose
 * differences are confined to the request they send: one that alters
 * application configuration changes what every concurrent case observes.
 *
 * The distinction is already encoded in which part of the baseline an
 * override addresses, so it is derived rather than asked for. An explicit
 * `isolation` on the case overrides the inference, for the cases where a
 * request-shaped override happens to have global effect.
 *
 * @param testCase - The case to classify.
 * @returns The isolation the case requires.
 */
export function deriveIsolation(testCase: TestCase): Isolation {
  if (testCase.isolation !== undefined) return testCase.isolation;
  return requiresExclusive(testCase.overrides) ? "exclusive" : "shared";
}

function requiresExclusive(overrides: readonly Override[]): boolean {
  return overrides.some((override) =>
    EXCLUSIVE_PREFIXES.some(
      (prefix) => override.path === prefix || override.path.startsWith(`${prefix}.`),
    ),
  );
}

/**
 * Groups cases into execution units: one shared group per baseline, plus one
 * singleton group per case that needs isolation.
 *
 * @param cases - Cases to group.
 * @returns Groups keyed by a stable identifier, each naming the baseline to
 *   prepare and the cases to run against it.
 */
export function groupForExecution(
  cases: readonly TestCase[],
): { key: string; baseline: string; isolation: Isolation; cases: TestCase[] }[] {
  const shared = new Map<string, TestCase[]>();
  const exclusive: { key: string; baseline: string; isolation: Isolation; cases: TestCase[] }[] =
    [];

  for (const testCase of cases) {
    if (deriveIsolation(testCase) === "exclusive") {
      exclusive.push({
        key: `${testCase.baseline}#${testCase.id}`,
        baseline: testCase.baseline,
        isolation: "exclusive",
        cases: [testCase],
      });
      continue;
    }
    const bucket = shared.get(testCase.baseline);
    if (bucket) bucket.push(testCase);
    else shared.set(testCase.baseline, [testCase]);
  }

  return [
    ...[...shared].map(([baseline, grouped]) => ({
      key: baseline,
      baseline,
      isolation: "shared" as const,
      cases: grouped,
    })),
    ...exclusive,
  ];
}
