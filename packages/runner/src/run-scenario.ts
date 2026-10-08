import {
  DEFAULT_EVIDENCE_PLAN,
  DEFAULT_VERDICT_POLICY,
  evaluateVerdict,
  type CleanupStep,
  type Scenario,
  type Step,
  type Verdict,
  type VerdictResult,
} from "@agentic-test-hub/core";

import { getResultAtPath } from "./assert.ts";
import { checkExpectation } from "./expectation.ts";
import {
  collectEvidence,
  composeVerdict,
  worstVerdict,
  type ExpectationOutcome,
  type RunOptions,
} from "./run-case.ts";
import { withRunScope } from "./run-scope.ts";
import { prepareStates, type PreparationReport } from "./state.ts";
import type { ExecutorRegistry } from "./executor/registry.ts";
import type { ExecutionContext, ExecutionResult } from "./executor/types.ts";

/** Stands in for a step with no action, so expectations still have something to check. */
const NO_ACTION: ExecutionResult = {
  operation: "(none)",
  ok: true,
  durationMs: 0,
};

/**
 * Evaluates one `produces` entry. A dotted path that is absent just produces
 * nothing. `{from, pattern}` takes capture group 1 of the pattern from the
 * path's value and must succeed: an absent path, a non-scalar value, or a
 * pattern that does not match (or has no group 1) is a `failure` reason,
 * which fails the step.
 */
function extract(
  action: ExecutionResult,
  name: string,
  production: Step["produces"][string],
): { present: true; value: unknown } | { present: false; failure?: string } {
  if (typeof production === "string") return getResultAtPath(action, production);
  const read = getResultAtPath(action, production.from);
  if (!read.present) {
    return {
      present: false,
      failure: `produces "${name}": "${production.from}" is absent from the result`,
    };
  }
  const raw = read.value;
  if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "boolean") {
    return {
      present: false,
      failure: `produces "${name}": "${production.from}" is not a scalar value`,
    };
  }
  const captured = new RegExp(production.pattern).exec(String(raw))?.[1];
  return captured === undefined
    ? {
        present: false,
        failure: `produces "${name}": pattern /${production.pattern}/ did not match "${String(raw)}"`,
      }
    : { present: true, value: captured };
}

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
  /**
   * Why the step failed outside its expectations: the message of what a
   * cleanup step threw, or the reason a `{from, pattern}` production did not
   * yield a value (the verdict is then `fail`).
   */
  readonly error?: string;
}

/**
 * Runs one scenario step: the action (if any), then every expectation
 * against it (or, for an `operation_result` expectation, against its own
 * operation's result), then extracts whatever the step `produces`.
 *
 * A step's `produces` entry is a dotted path into its own `ExecutionResult`
 * (read by `getResultAtPath`, the reader assertions' `at` uses too), or
 * `{from, pattern}` taking capture group 1 of the pattern from that path's
 * value; the latter fails the step (verdict `fail`, reason in `error`) when
 * it yields nothing. A plugin needing something richer has the `extension` executor as
 * its escape hatch.
 *
 * @param step - The step to run.
 * @param registry - Executors to run its operations with.
 * @param context - Manifest, scopes (with prior steps' `produces` already
 *   folded into `scopes.step`) and cancellation.
 * @returns What running the step established.
 */
export async function runStep(
  step: Step | CleanupStep,
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
    expectations.push({
      expectation,
      outcome: checkExpectation(expectation, subject),
    });
  }

  const produced: Record<string, unknown> = {};
  const failures: string[] = [];
  for (const [name, production] of Object.entries(step.produces)) {
    const extracted = extract(action, name, production);
    if (extracted.present) produced[name] = extracted.value;
    else if (extracted.failure !== undefined) failures.push(extracted.failure);
  }

  return {
    stepId: step.id,
    action,
    expectations,
    verdict: failures.length > 0 ? "fail" : composeVerdict(expectations),
    produced,
    ...(failures.length > 0 ? { error: failures.join("; ") } : {}),
  };
}

/** What running one scenario established. */
export interface ScenarioRunResult {
  readonly scenarioId: string;
  readonly preparation: PreparationReport;
  readonly steps: readonly StepRunResult[];
  /** The cleanup steps, in order. Empty when there were none or preparation failed. */
  readonly cleanup: readonly StepRunResult[];
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
 * `"before_and_after"` is treated as `"after"` (only the Python runtime saves
 * before/after evidence); `"before"` and `"each_step"` are a deliberate follow-up; no scenario in
 * this suite uses them yet.
 *
 * A scenario has no top-level polarity (only its steps do), so evidence is
 * judged under the last step's polarity — the state the scenario actually
 * ends in is what its overall evidence should be judged against.
 *
 * The scenario's `cleanup` steps always run afterwards, after evidence
 * collection, even when a step failed or threw (the throw then propagates).
 * A cleanup step that does not complete or breaks an expectation downgrades
 * the verdict to at most `inconclusive`. If preconditions are not met nothing
 * ran, so no cleanup runs either.
 *
 * @param scenario - The scenario to run.
 * @param registry - Executors to run its operations with.
 * @param baseContext - Manifest, scopes and cancellation. A `run` scope
 *   (`startedAt`, `id`) is added unless it already carries one.
 * @param options - A browser session to read, a policy override, noise
 *   filtering.
 * @returns What preparing, running and judging the scenario established.
 */
export async function runScenario(
  scenario: Scenario,
  registry: ExecutorRegistry,
  baseContext: ExecutionContext,
  options: RunOptions = {},
): Promise<ScenarioRunResult> {
  const context = withRunScope(baseContext);
  const policy = options.policy ?? context.manifest.policy ?? DEFAULT_VERDICT_POLICY;

  const preparation = await prepareStates(scenario.preconditions, registry, context);
  if (!preparation.ready) {
    // Nothing was created, so there is nothing to clean up.
    return {
      scenarioId: scenario.id,
      preparation,
      steps: [],
      cleanup: [],
      verdict: "inconclusive",
    };
  }

  const stepScope: Record<string, unknown> = {};
  const stepResults: StepRunResult[] = [];
  const cleanupResults: StepRunResult[] = [];
  const stepContext = (): ExecutionContext => ({
    ...context,
    scopes: {
      ...context.scopes,
      step: { ...context.scopes.step, ...stepScope },
    },
  });
  let outcome: { worstStep: Verdict; evidence: VerdictResult | undefined };

  try {
    const passedSteps = new Set<string>();
    for (const step of scenario.steps) {
      const unmetDependency = step.dependsOn.find((id) => !passedSteps.has(id));
      if (unmetDependency !== undefined) {
        stepResults.push({
          stepId: step.id,
          skipped: {
            reason: `depends on step ${unmetDependency}, which did not pass`,
          },
          expectations: [],
          verdict: "inconclusive",
          produced: {},
        });
        continue;
      }

      const result = await runStep(step, registry, stepContext());
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
      const observations = await collectEvidence(plan, registry, stepContext(), options);
      evidence = evaluateVerdict(policy, lastStep.polarity, observations, scenario.evidenceWaivers);
    }
    outcome = { worstStep, evidence };
  } finally {
    // Runs whether the steps passed, failed or threw; a throw then continues
    // to propagate once the leftovers have been dealt with.
    for (const step of scenario.cleanup) {
      cleanupResults.push(await runCleanupStep(step, registry, stepContext()));
    }
  }

  const cleanupFailed = cleanupResults.some(cleanupDidNotSucceed);
  const verdicts: Verdict[] = [outcome.worstStep];
  if (outcome.evidence !== undefined) verdicts.push(outcome.evidence.verdict);
  // Cleanup can only make the verdict less certain, never fail the scenario.
  if (cleanupFailed) verdicts.push("inconclusive");

  return {
    scenarioId: scenario.id,
    preparation,
    steps: stepResults,
    cleanup: cleanupResults,
    ...(outcome.evidence === undefined ? {} : { evidence: outcome.evidence }),
    verdict: worstVerdict(verdicts),
  };
}

/** Whether a cleanup step failed to complete or broke one of its expectations. */
function cleanupDidNotSucceed(result: StepRunResult): boolean {
  return result.error !== undefined || result.action?.ok === false || result.verdict !== "pass";
}

/** Runs a cleanup step, turning anything it throws into a recorded result so later steps still run. */
async function runCleanupStep(
  step: CleanupStep,
  registry: ExecutorRegistry,
  context: ExecutionContext,
): Promise<StepRunResult> {
  try {
    const result = await runStep(step, registry, context);
    // runStep's own expectations-only verdict ignores an action that did not
    // complete; for cleanup that is exactly the failure worth reporting.
    return result.action?.ok === false && result.verdict === "pass"
      ? { ...result, verdict: "inconclusive" }
      : result;
  } catch (cause) {
    return {
      stepId: step.id,
      expectations: [],
      verdict: "inconclusive",
      produced: {},
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}
