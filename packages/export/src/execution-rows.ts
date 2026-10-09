import {
  applyOverrides,
  type ActionRef,
  type AutomationStatus,
  type Baseline,
  type Expectation,
  type Suite,
  type TestCase,
} from "@agentic-test-hub/core";

/** One row of the flattened, fully-resolved suite: one step, one line. */
export interface DeliveryRow {
  /** The case or scenario step this row comes from. */
  readonly source:
    | { readonly caseId: string }
    | { readonly scenarioId: string; readonly stepId: string };
  /** Surface being acted on, e.g. a screen or endpoint name. */
  readonly target: string;
  /** The action performed, when distinct from the target. */
  readonly action: string;
  /** What distinguishes this row, in the reader's terms. */
  readonly summary: string;
  /** States required beforehand, rendered as text. */
  readonly preconditions: readonly string[];
  /** What the tester or agent does, fully resolved — no inheritance left. */
  readonly procedure: string;
  /** What must hold afterward. */
  readonly expected: readonly string[];
  /**
   * Automation state of the case this row comes from; absent for scenario
   * steps, which carry no automation status.
   */
  readonly automation?: {
    readonly status: AutomationStatus;
    /** Why the case cannot be run; set for `not_runnable`. */
    readonly reason?: string;
  };
}

/** Label shown in a delivery sheet's result column for a case nobody can run. */
export const NOT_RUNNABLE_LABEL = "実施不可";

/**
 * Renders a row's automation state for a delivery column.
 *
 * `not_runnable` reads `実施不可 / not runnable: <reason>`, never like
 * `manual`, because a manual case will be run by a person and this one will
 * not be run at all. Other statuses render as their name; a row without
 * automation (a scenario step) renders empty.
 *
 * @param row - The delivery row.
 * @returns Text for one cell.
 */
export function describeAutomation(row: DeliveryRow): string {
  if (row.automation === undefined) return "";
  if (row.automation.status !== "not_runnable") return row.automation.status;
  const reason = row.automation.reason === undefined ? "" : `: ${row.automation.reason}`;
  return `${NOT_RUNNABLE_LABEL} / not runnable${reason}`;
}

function describeAction(action: ActionRef | undefined): string {
  if (action === undefined) return "";
  const params = Object.entries(action.params)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(", ");
  return params === "" ? action.operation : `${action.operation}(${params})`;
}

function describeExpectation(expectation: Expectation): string {
  switch (expectation.kind) {
    case "http_status":
      return expectation.alsoAccepts === undefined || expectation.alsoAccepts.length === 0
        ? `HTTP status is ${expectation.status}`
        : `HTTP status is ${[expectation.status, ...expectation.alsoAccepts].join(" or ")}`;
    case "text":
      return `${expectation.match} "${expectation.value}"`;
    case "error_message":
      return `error ${expectation.match} "${expectation.value}"`;
    case "stdout_contains":
      return `output contains "${expectation.value}"`;
    case "operation_result":
      return `${expectation.operation} ${expectation.assert.kind}`;
    case "result":
      return `result ${expectation.assert.kind}`;
    case "ai_judgement":
      return `(${expectation.aspect}) ${expectation.value}`;
    case "unspecified":
      return expectation.text;
  }
}

/**
 * Flattens a case into one delivery row, with its baseline fully expanded.
 *
 * Expanding here rather than leaving the override visible is what makes the
 * row readable by someone who has never seen the baseline: "the same request,
 * with X changed" is a fact about how the suite is organised, not something a
 * reader of the delivered document needs to reconstruct.
 *
 * @param testCase - The case to flatten.
 * @param baseline - Its baseline, already looked up.
 * @returns One row.
 */
export function rowForCase(testCase: TestCase, baseline: Baseline): DeliveryRow {
  const resolved = applyOverrides(baseline, testCase.overrides);
  const target = resolved.target ?? baseline.target;
  return {
    source: { caseId: testCase.id },
    target: target?.surface ?? "",
    action: target?.action ?? "",
    summary: testCase.summary,
    preconditions: resolved.preconditions,
    procedure: describeAction(resolved.action),
    expected: testCase.expect.map(describeExpectation),
    automation: {
      status: testCase.automation.status,
      ...(testCase.automation.reason === undefined ? {} : { reason: testCase.automation.reason }),
    },
  };
}

/**
 * Flattens every case and scenario step in a suite into delivery rows.
 *
 * A scenario step is already a complete definition — nothing to expand — so
 * it becomes a row directly. Only cases go through {@link rowForCase}.
 *
 * A case whose baseline cannot be found is skipped rather than thrown on:
 * this function feeds a document meant to be read as-is, and the dangling
 * reference is already reported by {@link import("@agentic-test-hub/core").validateSuite}
 * — repeating it here as a crash would make the delivery view the wrong place
 * to learn about it.
 *
 * @param suite - The suite to flatten.
 * @returns Rows in a stable order: cases first, then scenarios, each in the
 *   order given.
 */
export function buildDeliveryRows(suite: Suite): DeliveryRow[] {
  const baselines = new Map(suite.baselines.map((baseline) => [baseline.id, baseline]));

  const caseRows = suite.cases.flatMap((testCase) => {
    const baseline = baselines.get(testCase.baseline);
    return baseline === undefined ? [] : [rowForCase(testCase, baseline)];
  });

  const scenarioRows = suite.scenarios.flatMap((scenario) =>
    scenario.steps.map((step): DeliveryRow => ({
      source: { scenarioId: scenario.id, stepId: step.id },
      target: step.target?.surface ?? "",
      action: step.target?.action ?? "",
      summary: step.summary,
      preconditions: step.dependsOn.length === 0 ? scenario.preconditions : [],
      procedure: step.action === undefined ? "" : `${step.action.operation}`,
      expected: step.expect.map(describeExpectation),
    })),
  );

  return [...caseRows, ...scenarioRows];
}
