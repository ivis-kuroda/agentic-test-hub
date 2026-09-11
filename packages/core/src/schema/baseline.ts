import { z } from "zod";

import { Target } from "./common.ts";
import { BaselineId, OperationId, StateRef } from "./id.ts";

/**
 * The action a baseline performs, expressed as a plugin-declared operation.
 *
 * The hub never interprets `params`; it substitutes overrides into them and
 * hands the result to the executor the plugin nominated.
 */
export const ActionRef = z.object({
  operation: OperationId,
  params: z.record(z.string(), z.unknown()).default({}),
});
/** The action a baseline performs. */
export type ActionRef = z.infer<typeof ActionRef>;

/**
 * A complete, executable starting point that a family of cases varies.
 *
 * This is the model's answer to the "same as above" idiom, which pervades
 * hand-written specifications and breaks the moment a row moves: the shared
 * part lives here, named and addressable, and a case states only its
 * difference. Nothing depends on position any more, and an agent can execute
 * a case because the baseline is complete rather than implied.
 *
 * Cases sharing a baseline also share its setup, so setup runs once per
 * baseline rather than once per case — usually the difference between a suite
 * that can run on every change and one that cannot.
 */
export const Baseline = z.object({
  id: BaselineId,
  /** Short name, such as "workflow deposit, standard request". */
  title: z.string().min(1),
  /** What the family acts on. Cases inherit this unless they override it. */
  target: Target.optional(),
  /**
   * States that must hold before any case in the family runs.
   *
   * Declarations, not procedures: the plugin decides how to reach each state
   * and how to confirm it was reached.
   */
  preconditions: z.array(StateRef).default([]),
  /**
   * Application or environment configuration the family assumes.
   *
   * Kept apart from {@link Baseline.context} because overriding it changes
   * global state, which is what makes a case unable to share its group's
   * environment. Isolation is derived from that distinction.
   */
  config: z.record(z.string(), z.unknown()).default({}),
  /**
   * Request-shaped data the family sends: headers, body, form values,
   * whatever the nominated operation consumes. Overrides normally address
   * paths inside here.
   */
  context: z.record(z.string(), z.unknown()).default({}),
  /** The operation every case in the family performs. */
  action: ActionRef.optional(),
});
/** A complete, executable starting point that a family of cases varies. */
export type Baseline = z.infer<typeof Baseline>;
