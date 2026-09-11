import { z } from "zod";

import { ActionRef } from "./baseline.ts";
import { AppliesTo, Target, Traceable } from "./common.ts";
import { EvidencePlan, EvidenceWaiver, Polarity } from "./evidence.ts";
import { Expectation } from "./expectation.ts";
import { ScenarioId, StateRef, StepId } from "./id.ts";

/**
 * One judged action within a scenario.
 *
 * A step, not a scenario, is the unit of verdict. That follows the
 * spreadsheet format this model replaces, where every row carries its own
 * result, date and tester, and it is the right granularity: a scenario that
 * fails at step 9 has still established steps 1 through 8.
 */
export const Step = Traceable.extend({
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
   */
  produces: z.record(z.string(), z.string()).default({}),
});
/** One judged action within a scenario. */
export type Step = z.infer<typeof Step>;

/**
 * An ordered sequence of steps that share accumulated state.
 *
 * Distinct from a family of {@link TestCase}s because order is part of the
 * specification here: the steps build on one another and cannot be run
 * independently or in parallel. Both shapes occur in real suites, and
 * flattening one into the other loses either the ordering or the
 * independence.
 */
export const Scenario = Traceable.extend({
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
});
/** An ordered sequence of steps that share accumulated state. */
export type Scenario = z.infer<typeof Scenario>;
