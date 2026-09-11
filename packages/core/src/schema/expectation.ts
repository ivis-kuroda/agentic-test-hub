import { z } from "zod";

import { Traceable } from "./common.ts";
import { OperationId } from "./id.ts";

/**
 * How the result of an operation is judged.
 *
 * `natural` is the deliberate escape hatch: a claim stated in prose, settled
 * by an AI judge rather than by comparison. It is honest about needing
 * judgement, which a string comparison dressed up as a rule would not be.
 */
export const Assertion = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("equals"), value: z.unknown() }),
  z.object({ kind: z.literal("contains"), value: z.string().min(1) }),
  z.object({ kind: z.literal("matches"), pattern: z.string().min(1) }),
  z.object({ kind: z.literal("row_count"), count: z.number().int().min(0) }),
  z.object({ kind: z.literal("natural"), text: z.string().min(1) }),
]);
/** How the result of an operation is judged. */
export type Assertion = z.infer<typeof Assertion>;

/** How a literal is compared against observed text. */
export const TextMatch = z.enum(["exact", "contains", "regex"]);

const base = Traceable.extend({
  /**
   * Behaviour that is known to diverge from this expectation and is accepted
   * as correct.
   *
   * Hand-written specifications tend to bury this in a remarks column, where
   * it silently overrides the stated expectation. Naming it makes the
   * override visible to a reviewer and available to a runner, which can then
   * report a deviation rather than a failure.
   */
  knownDeviation: z.string().min(1).optional(),
});

/**
 * What must hold for a step or case to pass.
 *
 * The variants are ordered from most to least mechanically checkable, and
 * that ordering is the point: the `kind` tells a runner whether it may assert
 * exactly, must ask a model to judge, or cannot check the claim at all.
 */
export const Expectation = z.discriminatedUnion("kind", [
  /** An HTTP response carried this status code. */
  base.extend({
    kind: z.literal("http_status"),
    status: z.number().int().min(100).max(599),
  }),

  /** Text is present on the surface under test. */
  base.extend({
    kind: z.literal("text"),
    value: z.string().min(1),
    match: TextMatch.default("contains"),
    /** Optional region to look in, interpreted by the active plugin. */
    scope: z.string().min(1).optional(),
  }),

  /**
   * A specific error was reported.
   *
   * Distinct from `text` because an error is a contract with the caller, and
   * separating it lets coverage reporting answer "which failure modes are
   * actually asserted" — typically the weakest part of a hand-written suite.
   */
  base.extend({
    kind: z.literal("error_message"),
    value: z.string().min(1),
    match: TextMatch.default("contains"),
  }),

  /** A command wrote this to standard output or standard error. */
  base.extend({
    kind: z.literal("stdout_contains"),
    value: z.string().min(1),
    /** Stream to inspect; both are searched when omitted. */
    stream: z.enum(["stdout", "stderr"]).optional(),
  }),

  /**
   * A plugin-declared operation was run and its result judged.
   *
   * This is how database, search-cluster and command-line checks enter the
   * model without the hub knowing anything about them.
   */
  base.extend({
    kind: z.literal("operation_result"),
    operation: OperationId,
    params: z.record(z.string(), z.unknown()).default({}),
    assert: Assertion,
  }),

  /**
   * A claim settled by a model rather than by comparison.
   *
   * `visual` covers rendering ("the layout is not broken"); `semantic` covers
   * meaning ("the message explains which field was rejected"). Use it where
   * judgement is genuinely required, not to avoid writing an assertion.
   */
  base.extend({
    kind: z.literal("ai_judgement"),
    aspect: z.enum(["visual", "semantic"]),
    value: z.string().min(1),
  }),

  /**
   * A claim that is not yet checkable, preserved verbatim.
   *
   * Source specifications contain expectations such as "an error is
   * returned", which name no error and cannot be verified mechanically.
   * Importing them as this variant keeps migration lossless while making the
   * debt countable: the reviewer view reports how many remain, and CI can
   * hold the number to a ratchet.
   *
   * Never emitted by authoring tools. Only migration produces it, and every
   * occurrence is a task.
   */
  base.extend({
    kind: z.literal("unspecified"),
    text: z.string().min(1),
  }),
]);
/** What must hold for a step or case to pass. */
export type Expectation = z.infer<typeof Expectation>;

/** Expectation kinds a runner can check without consulting a model. */
export const MECHANICAL_KINDS = [
  "http_status",
  "text",
  "error_message",
  "stdout_contains",
  "operation_result",
] as const;

/**
 * Reports whether an expectation can be checked without a model, treating an
 * `operation_result` judged in prose as requiring judgement.
 *
 * @param expectation - The expectation to classify.
 * @returns `true` when a deterministic runner can settle it alone.
 */
export function isMechanical(expectation: Expectation): boolean {
  if (expectation.kind === "operation_result") {
    return expectation.assert.kind !== "natural";
  }
  return (MECHANICAL_KINDS as readonly string[]).includes(expectation.kind);
}
