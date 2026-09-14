import {
  applyOverrides,
  DEFAULT_EVIDENCE_PLAN,
  type Baseline,
  type ResolvedBaseline,
  type Scenario,
  type Suite,
  type TestCase,
} from "@agentic-test-hub/core";
import { deriveActionParams } from "@agentic-test-hub/runner";
import type { Operation, PluginManifest } from "@agentic-test-hub/plugin";

/** A case, fully resolved and confirmed mechanically expressible, ready to generate. */
export interface CaseGenerationPlan {
  readonly kind: "case";
  readonly id: string;
  readonly testCase: TestCase;
  readonly baseline: Baseline;
  readonly resolved: ResolvedBaseline;
  readonly operationId: string;
  readonly operation: Operation;
  readonly params: Record<string, unknown>;
}

/**
 * A scenario, ready to generate.
 *
 * Unlike a case, a scenario has no baseline/overrides to resolve — each step
 * declares its own action and params directly — so there is nothing here for
 * `deriveActionParams` to judge; a scenario is either found or not.
 */
export interface ScenarioGenerationPlan {
  readonly kind: "scenario";
  readonly id: string;
  readonly scenario: Scenario;
}

export type GenerationPlan = CaseGenerationPlan | ScenarioGenerationPlan;

/** Which output language generation targets. */
export type GenerationLanguage = "typescript" | "python";

/** Why generation cannot proceed. */
export interface GenerationRefusal {
  readonly reason: string;
  /** Override paths with no mechanical path to the operation they resolve to, when that is why. */
  readonly paths: readonly string[];
}

export type PlanOutcome =
  | { readonly ok: true; readonly plan: GenerationPlan }
  | { readonly ok: false; readonly refusal: GenerationRefusal };

function refuse(reason: string, paths: readonly string[] = []): PlanOutcome {
  return { ok: false, refusal: { reason, paths } };
}

/** Every operation a set of state names' `ensure`/`verify` steps invoke. */
function stateOperationIds(names: readonly string[], manifest: PluginManifest): string[] {
  const ids: string[] = [];
  for (const name of names) {
    const provider = manifest.states[name];
    if (!provider) continue;
    ids.push(provider.ensure.operation, provider.verify.operation);
  }
  return ids;
}

/** Evidence sources collected by running an operation (`collectEvidence`'s own division). */
const COLLECTED_BY_OPERATION = ["db_records", "app_log", "db_log"] as const;

/** Every collector operation an evidence plan's sources actually invoke. */
function evidenceOperationIds(sources: readonly string[], manifest: PluginManifest): string[] {
  const ids: string[] = [];
  for (const source of COLLECTED_BY_OPERATION) {
    if (!sources.includes(source)) continue;
    const call = manifest.evidence[source];
    if (call) ids.push(call.operation);
  }
  return ids;
}

/**
 * Every operation id a plan actually invokes at run time: its action(s),
 * `operation_result` expectations, its preconditions' `ensure`/`verify`
 * operations (`runCase`/`runScenario` prepare these before the action ever
 * runs — see `packages/runner/src/state.ts`), and whichever evidence
 * collectors its evidence plan calls for (`collectEvidence`). Missing any of
 * these means a generated test's registry lacks an executor it needs the
 * moment it actually runs against a live target — found by running one for
 * real, not by the unit tests alone.
 */
export function operationsTouched(
  plan: GenerationPlan,
  manifest: PluginManifest,
): readonly string[] {
  const ids = new Set<string>();
  if (plan.kind === "case") {
    ids.add(plan.operationId);
    for (const expectation of plan.testCase.expect) {
      if (expectation.kind === "operation_result") ids.add(expectation.operation);
    }
    for (const id of stateOperationIds(plan.resolved.preconditions, manifest)) ids.add(id);
    const sources = plan.testCase.evidence?.sources ?? DEFAULT_EVIDENCE_PLAN.sources;
    for (const id of evidenceOperationIds(sources, manifest)) ids.add(id);
  } else {
    for (const step of plan.scenario.steps) {
      if (step.action !== undefined) ids.add(step.action.operation);
      for (const expectation of step.expect) {
        if (expectation.kind === "operation_result") ids.add(expectation.operation);
      }
    }
    for (const id of stateOperationIds(plan.scenario.preconditions, manifest)) ids.add(id);
    const sources = plan.scenario.evidence?.sources ?? DEFAULT_EVIDENCE_PLAN.sources;
    for (const id of evidenceOperationIds(sources, manifest)) ids.add(id);
  }
  return [...ids];
}

/** Which executor kinds a plan's operations need registered, so a template imports only those. */
export function executorKindsFor(
  plan: GenerationPlan,
  manifest: PluginManifest,
): readonly Operation["executor"][] {
  const kinds = new Set<Operation["executor"]>();
  for (const id of operationsTouched(plan, manifest)) {
    const operation = manifest.operations[id];
    if (operation) kinds.add(operation.executor);
  }
  return [...kinds];
}

/**
 * Which executor kinds a language track cannot generate a working test for.
 *
 * `sql` is unsupported in both tracks: unlike `http` (defaults to the
 * platform `fetch`), `shell` (defaults to `node:child_process.spawn`) and
 * `browser` (a real `PlaywrightDriver`/`playwright.sync_api` driver), there
 * is no generic, zero-configuration way to run a raw SQL query — neither
 * language has a generic `QueryFn`/DB client this CLI can wire up on its
 * own. `extension` is additionally unsupported in TypeScript: no TS
 * extension executor is implemented or planned (it exists specifically so
 * the Python track can import a plugin's own SQLAlchemy models/ES client
 * in-process); Python does implement it, since that is the whole reason the
 * Python track exists.
 */
function unsupportedExecutors(language: GenerationLanguage): readonly Operation["executor"][] {
  return language === "typescript" ? ["sql", "extension"] : ["sql"];
}

/** Refuses generation when a plan touches an operation `language` cannot execute. */
function refuseIfUnsupportedExecutor(
  plan: GenerationPlan,
  manifest: PluginManifest,
  language: GenerationLanguage,
): PlanOutcome | undefined {
  const unsupported = new Set(unsupportedExecutors(language));
  const badOperations = operationsTouched(plan, manifest).filter((id) => {
    const executor = manifest.operations[id]?.executor;
    return executor !== undefined && unsupported.has(executor);
  });
  if (badOperations.length === 0) return undefined;
  return refuse(
    `operation(s) ${badOperations.join(", ")} use an executor generation does not support for ${language} yet — ${
      language === "typescript"
        ? "expose real database access through the extension executor and generate this case as Python instead"
        : "generic sql generation has no generic client in either language"
    }`,
  );
}

function planCase(
  suite: Suite,
  manifest: PluginManifest,
  id: string,
  language: GenerationLanguage,
): PlanOutcome {
  const testCase = suite.cases.find((candidate) => candidate.id === id);
  if (!testCase) return refuse(`no case ${id} in this suite`);

  const baseline = suite.baselines.find((candidate) => candidate.id === testCase.baseline);
  if (!baseline) {
    return refuse(`case ${id} names baseline ${testCase.baseline}, which this suite does not have`);
  }

  const resolved = applyOverrides(baseline, testCase.overrides);
  if (resolved.action === undefined) {
    return refuse(`baseline ${baseline.id} declares no action, so case ${id} cannot run`);
  }

  const operation = manifest.operations[resolved.action.operation];
  if (!operation) {
    return refuse(
      `case ${id} resolves to operation ${resolved.action.operation}, which plugin "${manifest.name}" does not declare`,
    );
  }

  const derivation = deriveActionParams(
    testCase.overrides,
    resolved,
    resolved.action.operation,
    operation,
  );
  if (!derivation.ok) {
    return refuse(
      "one or more overrides have no mechanical path to the operation they resolve to",
      derivation.unexpressible.map((entry) => entry.path),
    );
  }

  const plan: CaseGenerationPlan = {
    kind: "case",
    id,
    testCase,
    baseline,
    resolved,
    operationId: resolved.action.operation,
    operation,
    params: derivation.params,
  };
  return refuseIfUnsupportedExecutor(plan, manifest, language) ?? { ok: true, plan };
}

function planScenario(
  suite: Suite,
  manifest: PluginManifest,
  id: string,
  language: GenerationLanguage,
): PlanOutcome {
  const scenario = suite.scenarios.find((candidate) => candidate.id === id);
  if (!scenario) return refuse(`no scenario ${id} in this suite`);

  for (const step of scenario.steps) {
    if (step.action === undefined) continue;
    if (!manifest.operations[step.action.operation]) {
      return refuse(
        `step ${step.id} names operation ${step.action.operation}, which plugin "${manifest.name}" does not declare`,
      );
    }
  }

  const plan: ScenarioGenerationPlan = { kind: "scenario", id, scenario };
  return refuseIfUnsupportedExecutor(plan, manifest, language) ?? { ok: true, plan };
}

/**
 * Decides whether `id` (a case or scenario) can be generated for `language`,
 * and resolves everything a template needs if so.
 *
 * A case's overrides are gated by {@link deriveActionParams}: an override
 * with no mechanical path to the operation it resolves to (a header the
 * operation never parameterised, say) refuses generation outright rather
 * than emitting a test that silently ignores it. A scenario has no such
 * gate — its steps declare their actions directly, with nothing to derive.
 * Either kind is also refused when it touches an operation `language` cannot
 * execute (see {@link unsupportedExecutors}) — `sql` in both languages,
 * `extension` in TypeScript only.
 *
 * @param suite - The loaded suite `id` is looked up in.
 * @param manifest - The plugin manifest `id`'s operations are looked up in.
 * @param id - A `TC-*` case id or `SC-*` scenario id.
 * @param language - Which output language generation targets.
 * @returns The resolved plan, or why generation was refused.
 */
export function planGeneration(
  suite: Suite,
  manifest: PluginManifest,
  id: string,
  language: GenerationLanguage,
): PlanOutcome {
  if (id.startsWith("TC-")) return planCase(suite, manifest, id, language);
  if (id.startsWith("SC-")) return planScenario(suite, manifest, id, language);
  return refuse(`"${id}" is neither a case id (TC-...) nor a scenario id (SC-...)`);
}
