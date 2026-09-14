import {
  applyOverrides,
  DEFAULT_EVIDENCE_PLAN,
  DEFAULT_VERDICT_POLICY,
  evaluateVerdict,
  type Baseline,
  type EvidencePlan,
  type Expectation,
  type Observation,
  type TestCase,
  type Verdict,
  type VerdictPolicy,
  type VerdictResult,
} from "@agentic-test-hub/core";

import { deriveActionParams } from "./derive-params.ts";
import {
  COLLECTED_BY_OPERATION,
  observeBrowser,
  observeFromResult,
  type ObserveOptions,
} from "./evidence.ts";
import { checkExpectation } from "./expectation.ts";
import { prepareStates, type PreparationReport } from "./state.ts";
import type { AssertionOutcome } from "./assert.ts";
import type { BrowserSession } from "./executor/browser.ts";
import type { ExecutorRegistry } from "./executor/registry.ts";
import type { ExecutionContext, ExecutionResult } from "./executor/types.ts";

/** One expectation, and what became of it. */
export interface ExpectationOutcome {
  readonly expectation: Expectation;
  readonly outcome: AssertionOutcome;
}

/** Options shared by `runCase` and `runStep`/`runScenario`. */
export interface RunOptions {
  /**
   * A browser session already open for this run, for the two channels that
   * exist only while a page is open. Never opened or closed here — that is
   * the caller's lifecycle, same convention as `BrowserExecutor`'s own
   * borrowed-session mode.
   */
  readonly browserSession?: BrowserSession;
  /** Overrides the manifest's own policy, which overrides `DEFAULT_VERDICT_POLICY`. */
  readonly policy?: VerdictPolicy;
  /** Noise filtering passed through to evidence collection. */
  readonly observe?: ObserveOptions;
}

/** Why a case could not even be attempted. */
export interface Blocked {
  readonly reason: string;
  /** Override paths that have no mechanical path to the executed request. */
  readonly paths: readonly string[];
}

/** What running one case established. */
export interface CaseRunResult {
  readonly caseId: string;
  readonly preparation: PreparationReport;
  /** Set when the case's overrides could not be mechanically derived; nothing past this point ran. */
  readonly blocked?: Blocked;
  readonly action?: ExecutionResult;
  readonly expectations: readonly ExpectationOutcome[];
  readonly observations: readonly Observation[];
  readonly evidence: VerdictResult;
  readonly verdict: Verdict;
}

const VERDICT_RANK: Record<Verdict, number> = { pass: 0, inconclusive: 1, fail: 2 };

/** The worst of several verdicts, `pass` being the best case. */
export function worstVerdict(verdicts: readonly Verdict[]): Verdict {
  return verdicts.reduce<Verdict>(
    (worst, verdict) => (VERDICT_RANK[verdict] > VERDICT_RANK[worst] ? verdict : worst),
    "pass",
  );
}

function verdictOfOutcome(outcome: AssertionOutcome): Verdict {
  if (outcome.verdict === "violated") return "fail";
  if (outcome.verdict === "needs_judgement") return "inconclusive";
  return "pass";
}

/** Composes expectation outcomes and, optionally, an evidence verdict into one overall verdict. */
export function composeVerdict(
  expectations: readonly ExpectationOutcome[],
  evidence?: VerdictResult,
): Verdict {
  const verdicts = expectations.map((entry) => verdictOfOutcome(entry.outcome));
  if (evidence !== undefined) verdicts.push(evidence.verdict);
  return worstVerdict(verdicts);
}

/**
 * Collects the evidence a plan calls for, given what is actually available.
 *
 * `db_records`/`app_log`/`db_log` are gathered by running their declared
 * collector operation and scanning its output for problem words (see
 * `observeFromResult`); `browser_console`/`browser_network` come from a live
 * session instead, since they do not exist once it closes. `screenshot` is
 * never gathered here — deciding whether a page *looks* right is a judgement
 * this module does not make on its own (see `evidence.ts`'s own docs on
 * this). Deliberately no attempt is made to synthesise `db_records`'
 * `intendedChanges`/`residualChanges` beyond what `observeFromResult`
 * already reports (nothing today implements real before/after row diffing),
 * so a policy that binds `db_records` to `expected_change`/
 * `no_residual_change` will not pass on this alone — an honest limitation,
 * not a bug.
 */
export async function collectEvidence(
  plan: EvidencePlan,
  registry: ExecutorRegistry,
  context: ExecutionContext,
  options: RunOptions,
): Promise<Observation[]> {
  const observations: Observation[] = [];
  if (options.browserSession !== undefined) {
    observations.push(...observeBrowser(options.browserSession, options.observe));
  }
  for (const source of COLLECTED_BY_OPERATION) {
    if (!plan.sources.includes(source)) continue;
    const call = context.manifest.evidence[source];
    if (call === undefined) continue;
    const result = await registry.run(call.operation, call.params, context);
    observations.push(observeFromResult(source, result, options.observe));
  }
  return observations;
}

/**
 * Runs one test case: resolves it against its baseline, prepares its
 * preconditions, runs its action, judges every expectation, collects
 * evidence and reaches an overall verdict.
 *
 * This is the one function both a generated Playwright test and any future
 * direct-execution path (a CLI, a hub "run now" button) call — generated
 * code's own job is only to load a manifest, build a registry and context,
 * and call this.
 *
 * @param testCase - The case to run.
 * @param baseline - Its baseline, already looked up.
 * @param registry - Executors available to run its operations with.
 * @param context - Manifest, scopes and cancellation.
 * @param options - A browser session to read, a policy override, noise
 *   filtering.
 * @returns What preparing, running and judging the case established.
 */
export async function runCase(
  testCase: TestCase,
  baseline: Baseline,
  registry: ExecutorRegistry,
  context: ExecutionContext,
  options: RunOptions = {},
): Promise<CaseRunResult> {
  const policy = options.policy ?? context.manifest.policy ?? DEFAULT_VERDICT_POLICY;
  const resolved = applyOverrides(baseline, testCase.overrides);

  const preparation = await prepareStates(resolved.preconditions, registry, context);
  if (!preparation.ready) {
    return {
      caseId: testCase.id,
      preparation,
      expectations: [],
      observations: [],
      evidence: evaluateVerdict(policy, testCase.polarity, []),
      verdict: "inconclusive",
    };
  }

  if (resolved.action === undefined) {
    throw new Error(`case ${testCase.id}'s baseline declares no action to run`);
  }
  const operation = context.manifest.operations[resolved.action.operation];
  if (!operation) {
    throw new Error(
      `case ${testCase.id}'s baseline names operation ${resolved.action.operation}, which plugin "${context.manifest.name}" does not declare`,
    );
  }

  const derivation = deriveActionParams(
    testCase.overrides,
    resolved,
    resolved.action.operation,
    operation,
  );
  if (!derivation.ok) {
    return {
      caseId: testCase.id,
      preparation,
      blocked: {
        reason: "one or more overrides have no mechanical path to the operation they resolve to",
        paths: derivation.unexpressible.map((entry) => entry.path),
      },
      expectations: [],
      observations: [],
      evidence: evaluateVerdict(policy, testCase.polarity, []),
      verdict: "inconclusive",
    };
  }

  const action = await registry.run(resolved.action.operation, derivation.params, context);

  const expectations: ExpectationOutcome[] = [];
  for (const expectation of testCase.expect) {
    const subject =
      expectation.kind === "operation_result"
        ? await registry.run(expectation.operation, expectation.params, context)
        : action;
    expectations.push({ expectation, outcome: checkExpectation(expectation, subject) });
  }

  const plan = testCase.evidence ?? DEFAULT_EVIDENCE_PLAN;
  const observations = await collectEvidence(plan, registry, context, options);
  const evidence = evaluateVerdict(
    policy,
    testCase.polarity,
    observations,
    testCase.evidenceWaivers,
  );

  return {
    caseId: testCase.id,
    preparation,
    action,
    expectations,
    observations,
    evidence,
    verdict: composeVerdict(expectations, evidence),
  };
}
