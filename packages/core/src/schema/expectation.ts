import { z } from "zod";

import { traceableFields } from "./common.ts";
import { OperationId } from "./id.ts";

/**
 * Optional dotted path into an `ExecutionResult` selecting what an assertion
 * judges (`body.error`, `headers.location`, `status`, `durationMs`,
 * `exitCode`, `stdout`). Omitted, the assertion judges whatever the result
 * most specifically carries (rows, then body, then standard output).
 */
const AssertionPath = z.string().min(1).optional();

/**
 * How the result of an operation is judged.
 *
 * `natural` is the deliberate escape hatch: a claim stated in prose, settled
 * by an AI judge rather than by comparison. It is honest about needing
 * judgement, which a string comparison dressed up as a rule would not be.
 */
export const Assertion = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("equals"), value: z.unknown(), at: AssertionPath }),
  z.object({ kind: z.literal("contains"), value: z.string().min(1), at: AssertionPath }),
  z.object({ kind: z.literal("matches"), pattern: z.string().min(1), at: AssertionPath }),
  /**
   * The subject is an object whose key set equals `value` exactly, in any
   * order. Catches a response that grew or lost a field.
   */
  z.object({ kind: z.literal("keys"), value: z.array(z.string()), at: AssertionPath }),
  /** The subject equals one of `values`, compared as `equals` compares. */
  z.object({
    kind: z.literal("one_of"),
    values: z.array(z.unknown()).min(1),
    at: AssertionPath,
  }),
  /** The subject, read as a number, stands in this relation to `value`. */
  z.object({
    kind: z.literal("compare"),
    op: z.enum(["lt", "lte", "gt", "gte"]),
    value: z.number(),
    at: AssertionPath,
  }),
  z.object({ kind: z.literal("row_count"), count: z.number().int().min(0) }),
  z.object({ kind: z.literal("natural"), text: z.string().min(1) }),
]);
/** How the result of an operation is judged. */
export type Assertion = z.infer<typeof Assertion>;

/** How a literal is compared against observed text. */
export const TextMatch = z.enum(["exact", "contains", "regex"]);

/**
 * Annotations every expectation carries, placed after its own fields.
 *
 * Spread at the end of each variant so that `kind` leads: it is the
 * discriminator, and a reader scanning a list of expectations needs to know
 * what kind of claim each one is before anything else about it.
 */
const annotations = {
  ...traceableFields,
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
} as const;

/**
 * What must hold for a step or case to pass.
 *
 * The variants are ordered from most to least mechanically checkable, and
 * that ordering is the point: the `kind` tells a runner whether it may assert
 * exactly, must ask a model to judge, or cannot check the claim at all.
 */
export const Expectation = z.discriminatedUnion("kind", [
  /** An HTTP response carried this status code. */
  z.object({
    kind: z.literal("http_status"),
    status: z.number().int().min(100).max(599),
    /** Further statuses that also satisfy the expectation. */
    alsoAccepts: z.array(z.number().int().min(100).max(599)).optional(),
    ...annotations,
  }),

  /** Text is present on the surface under test. */
  z.object({
    kind: z.literal("text"),
    value: z.string().min(1),
    match: TextMatch.default("contains"),
    /** Optional region to look in, interpreted by the active plugin. */
    scope: z.string().min(1).optional(),
    ...annotations,
  }),

  /**
   * A specific error was reported.
   *
   * Distinct from `text` because an error is a contract with the caller, and
   * separating it lets coverage reporting answer "which failure modes are
   * actually asserted" — typically the weakest part of a hand-written suite.
   */
  z.object({
    kind: z.literal("error_message"),
    value: z.string().min(1),
    match: TextMatch.default("contains"),
    ...annotations,
  }),

  /** A command wrote this to standard output or standard error. */
  z.object({
    kind: z.literal("stdout_contains"),
    value: z.string().min(1),
    /** Stream to inspect; both are searched when omitted. */
    stream: z.enum(["stdout", "stderr"]).optional(),
    ...annotations,
  }),

  /**
   * A plugin-declared operation was run and its result judged.
   *
   * This is how database, search-cluster and command-line checks enter the
   * model without the hub knowing anything about them.
   */
  z.object({
    kind: z.literal("operation_result"),
    operation: OperationId,
    params: z.record(z.string(), z.unknown()).default({}),
    assert: Assertion,
    ...annotations,
  }),

  /**
   * The action's own result was judged by an assertion.
   *
   * `operation_result` judges a separately run operation; this judges what
   * the case or step's own action returned, so a response body or header can
   * be checked without declaring a second operation.
   */
  z.object({
    kind: z.literal("result"),
    assert: Assertion,
    ...annotations,
  }),

  /**
   * A claim settled by a model rather than by comparison.
   *
   * `visual` covers rendering ("the layout is not broken"); `semantic` covers
   * meaning ("the message explains which field was rejected"). Use it where
   * judgement is genuinely required, not to avoid writing an assertion.
   */
  z.object({
    kind: z.literal("ai_judgement"),
    aspect: z.enum(["visual", "semantic"]),
    value: z.string().min(1),
    ...annotations,
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
  z.object({
    kind: z.literal("unspecified"),
    text: z.string().min(1),
    ...annotations,
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
  "result",
] as const;

/**
 * Reports whether an expectation can be checked without a model, treating an
 * `operation_result` or `result` judged in prose as requiring judgement.
 *
 * @param expectation - The expectation to classify.
 * @returns `true` when a deterministic runner can settle it alone.
 */
export function isMechanical(expectation: Expectation): boolean {
  if (expectation.kind === "operation_result" || expectation.kind === "result") {
    return expectation.assert.kind !== "natural";
  }
  return (MECHANICAL_KINDS as readonly string[]).includes(expectation.kind);
}
