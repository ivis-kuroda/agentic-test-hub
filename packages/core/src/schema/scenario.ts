import { z } from "zod";

import { ActionRef } from "./baseline.ts";
import { AppliesTo, Target, traceableFields } from "./common.ts";
import { EvidencePlan, EvidenceWaiver, Polarity } from "./evidence.ts";
import { Expectation } from "./expectation.ts";
import { ScenarioId, StateRef, StepId } from "./id.ts";

/**
 * How a step extracts a value from its own result: a dotted path, or a path
 * plus a regular expression whose first capture group is the value.
 */
export const Production = z.union([
  z.string().min(1),
  z.object({
    from: z.string().min(1),
    pattern: z.string().min(1).refine(isRegExp, { message: "not a valid regular expression" }),
  }),
]);
/** How a step extracts a value from its own result. */
export type Production = z.infer<typeof Production>;

function isRegExp(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

/**
 * One judged action within a scenario.
 *
 * A step, not a scenario, is the unit of verdict. That follows the
 * spreadsheet format this model replaces, where every row carries its own
 * result, date and tester, and it is the right granularity: a scenario that
 * fails at step 9 has still established steps 1 through 8.
 */
export const Step = z.object({
  id: StepId,
  /** What this step establishes, as the specification would phrase it. */
  summary: z.string().min(1),
  /** What the step acts on, when it differs from the previous step. */
  target: Target.optional(),
  /** The operation performed. Omitted for a step that only observes. */
  action: ActionRef.optional(),
  /** What must hold after the action. */
  expect: z.array(Expectation).min(1),
  /** Whether this step expects success or expects to be rejected. */
  polarity: Polarity.default("nominal"),
  /**
   * Steps that must have run first.
   *
   * Source specifications express this in prose — "immediately after No. 2",
   * "the item type created in No. 9" — which breaks as soon as anything is
   * renumbered. Naming the dependency makes the order checkable and lets a
   * runner report a skipped prerequisite instead of a confusing failure.
   */
  dependsOn: z.array(StepId).default([]),
  /**
   * Values this step produces for later steps, mapping a name to an
   * extraction expression the active plugin understands.
   *
   * This is the other half of the prose problem: a later step referring to
   * "the item type created earlier" needs the identifier, not the sentence.
   *
   * An entry is either a dotted path into the step's result (`body.id`) or
   * `{from, pattern}`: read the path, then take the first capture group of
   * `pattern` from it — for an identifier at the tail of a `Location` header,
   * say.
   */
  produces: z.record(z.string(), Production).default({}),
  ...traceableFields,
});
/** One judged action within a scenario. */
export type Step = z.infer<typeof Step>;

/**
 * A step run after the scenario's steps to undo what they created.
 *
 * Shaped like {@link Step} except that `expect` may be empty: a teardown
 * request usually has nothing worth asserting beyond completing.
 */
export const CleanupStep = Step.extend({
  expect: z.array(Expectation).default([]),
});
/** A step run after the scenario's steps to undo what they created. */
export type CleanupStep = z.infer<typeof CleanupStep>;

/**
 * An ordered sequence of steps that share accumulated state.
 *
 * Distinct from a family of {@link TestCase}s because order is part of the
 * specification here: the steps build on one another and cannot be run
 * independently or in parallel. Both shapes occur in real suites, and
 * flattening one into the other loses either the ordering or the
 * independence.
 */
export const Scenario = z.object({
  id: ScenarioId,
  title: z.string().min(1),
  /**
   * States that must hold before the first step.
   *
   * Setup is separated from the steps rather than sitting among them as
   * unnumbered rows, so that a failure to prepare is never mistaken for a
   * test failure.
   */
  preconditions: z.array(StateRef).default([]),
  /** Steps in the order they must run. */
  steps: z.array(Step).min(1),
  /**
   * Steps that always run after `steps` and evidence collection, even when a
   * step failed or raised, in order.
   *
   * They see everything earlier steps `produces`. A cleanup step that does
   * not complete or whose expectation is violated cannot fail the scenario
   * but downgrades it to at most `inconclusive`, since the system under test
   * may now hold leftovers.
   */
  cleanup: z.array(CleanupStep).default([]),
  /** Overrides the suite's default evidence collection for this scenario. */
  evidence: EvidencePlan.optional(),
  /**
   * Channels this case will not be judged on, each with a reason.
   *
   * Validated against the policy: waiving a protected channel is rejected.
   */
  evidenceWaivers: z.array(EvidenceWaiver).default([]),
  tags: z.array(z.string().min(1)).default([]),
  appliesTo: AppliesTo.optional(),
  ...traceableFields,
});
/** An ordered sequence of steps that share accumulated state. */
export type Scenario = z.infer<typeof Scenario>;
