import type { StateProvider } from "@agentic-test-hub/plugin";

import { checkAssertion } from "./assert.ts";
import type { ExecutorRegistry } from "./executor/registry.ts";
import type { ExecutionContext } from "./executor/types.ts";

/** How preparing one state turned out. */
export type StateStatus =
  /** The state already held; setup was skipped. */
  | "already_satisfied"
  /** Setup ran and the state now holds. */
  | "established"
  /** Setup ran and the state still does not hold. */
  | "unsatisfied"
  /** Whether the state holds cannot be settled by comparison. */
  | "needs_judgement";

/** The outcome of preparing one state. */
export interface StateOutcome {
  readonly state: string;
  readonly status: StateStatus;
  /** What the verification found. */
  readonly why: string;
  /** Whether setup was actually run. */
  readonly ensured: boolean;
}

/**
 * Brings a declared state about, checking before and after.
 *
 * Checking first is what makes a large suite affordable: setup is usually its
 * dominant cost, and most of it is redundant because the state already holds
 * from an earlier case.
 *
 * Checking afterwards is what makes failures legible. A seed script that
 * exits zero having done nothing is common, and without a second check the
 * consequence surfaces as an assertion failure in an unrelated place. Hours
 * go into chasing that. One extra query prevents it.
 *
 * @param state - The state being prepared, for reporting.
 * @param provider - How to reach and confirm it.
 * @param registry - Executors to run the operations with.
 * @param context - Manifest, scopes and cancellation.
 * @returns What happened, including whether setup was needed.
 */
export async function ensureState(
  state: string,
  provider: StateProvider,
  registry: ExecutorRegistry,
  context: ExecutionContext,
): Promise<StateOutcome> {
  const verify = async (): Promise<ReturnType<typeof checkAssertion>> => {
    const result = await registry.run(provider.verify.operation, provider.verify.params, context);
    return checkAssertion(provider.verify.assert, result);
  };

  const before = await verify();
  if (before.verdict === "satisfied") {
    return { state, status: "already_satisfied", why: before.why, ensured: false };
  }
  if (before.verdict === "needs_judgement") {
    return { state, status: "needs_judgement", why: before.why, ensured: false };
  }

  await registry.run(provider.ensure.operation, provider.ensure.params, context);

  const after = await verify();
  if (after.verdict === "satisfied") {
    return { state, status: "established", why: after.why, ensured: true };
  }
  return {
    state,
    status: after.verdict === "needs_judgement" ? "needs_judgement" : "unsatisfied",
    why: after.why,
    ensured: true,
  };
}

/** Order in which states are prepared: cheapest first. */
const COST_ORDER = { low: 0, medium: 1, high: 2 } as const;

/** What preparing a case's preconditions established. */
export interface PreparationReport {
  readonly outcomes: readonly StateOutcome[];
  /**
   * Whether every state holds.
   *
   * A case whose preconditions were not met is reported as such rather than
   * run and failed. The two look identical in a results table and are not the
   * same thing at all: one is a defect in the system, the other in the
   * harness.
   */
  readonly ready: boolean;
}

/**
 * Prepares every state a case requires, cheapest first.
 *
 * Cheap states are prepared first so that a suite whose environment is wrong
 * fails on a fast check rather than after an expensive restore. Preparation
 * stops at the first state that cannot be reached — continuing would pile
 * consequential failures on top of the real one.
 *
 * @param states - States required, as named by the specification.
 * @param registry - Executors to run the operations with.
 * @param context - Manifest, scopes and cancellation.
 * @returns Every outcome reached, and whether the case may proceed.
 */
export async function prepareStates(
  states: readonly string[],
  registry: ExecutorRegistry,
  context: ExecutionContext,
): Promise<PreparationReport> {
  const providers = states.map((state) => {
    const provider = context.manifest.states[state];
    if (!provider) {
      throw new Error(
        `state "${state}" is required but plugin "${context.manifest.name}" does not provide it`,
      );
    }
    return { state, provider };
  });

  providers.sort((a, b) => COST_ORDER[a.provider.cost] - COST_ORDER[b.provider.cost]);

  const outcomes: StateOutcome[] = [];
  for (const { state, provider } of providers) {
    const outcome = await ensureState(state, provider, registry, context);
    outcomes.push(outcome);
    if (outcome.status === "unsatisfied" || outcome.status === "needs_judgement") {
      return { outcomes, ready: false };
    }
  }
  return { outcomes, ready: true };
}
