import { z } from "zod";

import { Assertion, OperationId } from "@agentic-test-hub/core";

/** Invoking a declared operation with arguments. */
export const OperationCall = z.object({
  operation: OperationId,
  params: z.record(z.string(), z.unknown()).default({}),
});
/** Invoking a declared operation with arguments. */
export type OperationCall = z.infer<typeof OperationCall>;

/**
 * Roughly what it costs to reach a state, used to order setup work.
 *
 * An estimate rather than a measurement: the scheduler only needs to know
 * which states are worth avoiding, and asking a plugin author for a number
 * they cannot know would get a made-up one.
 */
export const StateCost = z.enum(["low", "medium", "high"]);

/**
 * How to reach a declared state, and how to tell whether it holds.
 *
 * Specifications say what state they need; this says how to get there. The
 * split is what lets a specification stay readable — "the queue is empty"
 * rather than a paragraph of setup — while remaining executable.
 *
 * Both halves are required, and `verify` is the more important one:
 *
 * - Checking first lets setup be skipped when the state already holds, which
 *   is usually the difference between a suite that runs on every change and
 *   one that runs overnight.
 * - Checking afterwards catches setup that failed quietly. Without it, a seed
 *   script that silently did nothing surfaces as a confusing assertion
 *   failure somewhere else entirely, and the hours spent chasing it are the
 *   single most avoidable cost in this kind of automation.
 */
export const StateProvider = z.object({
  /** What holding this state means, in the target's own terms. */
  description: z.string().min(1).optional(),
  /** Brings the state about. Must be safe to run when it already holds. */
  ensure: OperationCall,
  /** Establishes whether the state holds. */
  verify: z.object({
    operation: OperationId,
    params: z.record(z.string(), z.unknown()).default({}),
    /** What the verification operation must report. */
    assert: Assertion,
  }),
  cost: StateCost.default("medium"),
});
/** How to reach a declared state, and how to tell whether it holds. */
export type StateProvider = z.infer<typeof StateProvider>;
