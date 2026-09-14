import {
  DEFAULT_EVIDENCE_PLAN,
  DEFAULT_VERDICT_POLICY,
  evaluateVerdict,
  getAtPath,
  type Scenario,
  type Step,
  type Verdict,
  type VerdictResult,
} from "@agentic-test-hub/core";

import { checkExpectation } from "./expectation.ts";
import {
  collectEvidence,
  composeVerdict,
  worstVerdict,
  type ExpectationOutcome,
  type RunOptions,
} from "./run-case.ts";
import { prepareStates, type PreparationReport } from "./state.ts";
import type { ExecutorRegistry } from "./executor/registry.ts";
import type { ExecutionContext, ExecutionResult } from "./executor/types.ts";

/** Stands in for a step with no action, so expectations still have something to check. */
const NO_ACTION: ExecutionResult = { operation: "(none)", ok: true, durationMs: 0 };

/** What running one step established. */
export interface StepRunResult {
  readonly stepId: string;
  /** Set when a dependency did not pass; nothing else here ran. */
  readonly skipped?: { readonly reason: string };
  readonly action?: ExecutionResult;
  readonly expectations: readonly ExpectationOutcome[];
  readonly verdict: Verdict;
  /** Values this step produced, for later steps' `context.scopes.step`. */
  readonly produced: Readonly<Record<string, unknown>>;
}

/**
 * Runs one scenario step: the action (if any), then every expectation
 * against it (or, for an `operation_result` expectation, against its own
 * operation's result), then extracts whatever the step `produces`.
 *
 * A step's `produces` expression is read as a dotted path into its own
 * `ExecutionResult` (`getAtPath`, the same reader overrides use) — the
 * schema calls this "an extraction expression the active plugin
 * understands", and this is the generic v1 interpretation; a plugin needing
 * something richer has the `extension` executor as its escape hatch.
 *
 * @param step - The step to run.
 * @param registry - Executors to run its operations with.
 * @param context - Manifest, scopes (with prior steps' `produces` already
 *   folded into `scopes.step`) and cancellation.
 * @returns What running the step established.
 */
export async function runStep(
  step: Step,
  registry: ExecutorRegistry,
  context: ExecutionContext,
): Promise<StepRunResult> {
  const action =
    step.action === undefined
      ? NO_ACTION
      : await registry.run(step.action.operation, step.action.params, context);

  const expectations: ExpectationOutcome[] = [];
  for (const expectation of step.expect) {
    const subject =
      expectation.kind === "operation_result"
        ? await registry.run(expectation.operation, expectation.params, context)
        : action;
    expectations.push({ expectation, outcome: checkExpectation(expectation, subject) });
  }

  const produced: Record<string, unknown> = {};
  for (const [name, path] of Object.entries(step.produces)) {
    const value = getAtPath(action, path);
    if (value.present) produced[name] = value.value;
  }

  return {
    stepId: step.id,
    action,
    expectations,
    verdict: composeVerdict(expectations),
    produced,
  };
}

/** What running one scenario established. */
export interface ScenarioRunResult {
  readonly scenarioId: string;
  readonly preparation: PreparationReport;
  readonly steps: readonly StepRunResult[];
  /** Unset only when preconditions were never satisfied. */
  readonly evidence?: VerdictResult;
  readonly verdict: Verdict;
}

/**
 * Runs a scenario: its preconditions once, then every step in order,
 * threading each step's `produces` into the next steps' `context.scopes.step`
 * and skipping (not running) a step whose dependency did not pass.
 *
 * v1 collects evidence once, after the last step, honouring
 * `EvidencePlan.timing` only as `"after"` (the default) or `"on_failure"` —
 * `"before"` and `"each_step"` are a deliberate follow-up; no scenario in
 * this suite uses them yet.
 *
 * A scenario has no top-level polarity (only its steps do), so evidence is
 * judged under the last step's polarity — the state the scenario actually
 * ends in is what its overall evidence should be judged against.
 *
 * @param scenario - The scenario to run.
 * @param registry - Executors to run its operations with.
 * @param context - Manifest, scopes and cancellation.
 * @param options - A browser session to read, a policy override, noise
 *   filtering.
 * @returns What preparing, running and judging the scenario established.
 */
export async function runScenario(
  scenario: Scenario,
  registry: ExecutorRegistry,
  context: ExecutionContext,
  options: RunOptions = {},
): Promise<ScenarioRunResult> {
  const policy = options.policy ?? context.manifest.policy ?? DEFAULT_VERDICT_POLICY;

  const preparation = await prepareStates(scenario.preconditions, registry, context);
  if (!preparation.ready) {
    return { scenarioId: scenario.id, preparation, steps: [], verdict: "inconclusive" };
  }

  const stepScope: Record<string, unknown> = {};
  const stepResults: StepRunResult[] = [];
  const passedSteps = new Set<string>();

  for (const step of scenario.steps) {
    const unmetDependency = step.dependsOn.find((id) => !passedSteps.has(id));
    if (unmetDependency !== undefined) {
      stepResults.push({
        stepId: step.id,
        skipped: { reason: `depends on step ${unmetDependency}, which did not pass` },
        expectations: [],
        verdict: "inconclusive",
        produced: {},
      });
      continue;
    }

    const stepContext: ExecutionContext = {
      ...context,
      scopes: { ...context.scopes, step: { ...context.scopes.step, ...stepScope } },
    };
    const result = await runStep(step, registry, stepContext);
    stepResults.push(result);
    if (result.verdict === "pass") passedSteps.add(step.id);
    Object.assign(stepScope, result.produced);
  }

  const worstStep = worstVerdict(stepResults.map((result) => result.verdict));
  const plan = scenario.evidence ?? DEFAULT_EVIDENCE_PLAN;
  const shouldCollect = plan.timing !== "on_failure" || worstStep === "fail";

  let evidence: VerdictResult | undefined;
  if (shouldCollect) {
    const lastStep = scenario.steps.at(-1)!;
    const observations = await collectEvidence(plan, registry, context, options);
    evidence = evaluateVerdict(policy, lastStep.polarity, observations, scenario.evidenceWaivers);
  }

  return {
    scenarioId: scenario.id,
    preparation,
    steps: stepResults,
    ...(evidence === undefined ? {} : { evidence }),
    verdict: worstVerdict(evidence === undefined ? [worstStep] : [worstStep, evidence.verdict]),
  };
}
