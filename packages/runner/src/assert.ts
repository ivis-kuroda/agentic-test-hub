import { deepEqual, type Assertion } from "@agentic-test-hub/core";

import type { ExecutionResult } from "./executor/types.ts";

/** How an assertion turned out. */
export type AssertionVerdict =
  /** The assertion holds. */
  | "satisfied"
  /** The assertion does not hold. */
  | "violated"
  /**
   * The assertion cannot be settled by comparison.
   *
   * Reported rather than guessed at: a claim stated in prose needs a model to
   * judge it, and quietly treating it as satisfied would turn the honest
   * escape hatch into a way of passing without checking anything.
   */
  | "needs_judgement";

/** An assertion's outcome, with the reasoning behind it. */
export interface AssertionOutcome {
  readonly verdict: AssertionVerdict;
  readonly why: string;
}

/**
 * Picks the value an assertion compares against.
 *
 * Operations report through different channels — a query returns rows, a
 * request returns a body, a command writes to stdout — and an assertion
 * should not have to say which. The order reflects specificity: structured
 * output is preferred over text, because text is what is left when nothing
 * more precise is available.
 *
 * @param result - What the operation produced.
 * @returns The value to compare, and a description of where it came from.
 */
export function subjectOf(result: ExecutionResult): { value: unknown; from: string } {
  if (result.rows !== undefined) {
    const first = result.rows[0];
    const columns = first === undefined ? [] : Object.values(first);
    // A single cell is the common case for a counting or existence query, and
    // comparing it directly is what a specification means by "the query
    // returns 0".
    if (result.rows.length === 1 && columns.length === 1) {
      return { value: columns[0], from: "the single returned cell" };
    }
    return { value: result.rows, from: "the returned rows" };
  }
  if (result.body !== undefined) return { value: result.body, from: "the response body" };
  // Trailing whitespace on command output is an artifact of the shell, not
  // data. Without trimming, a count command printing "0\n" fails to equal 0,
  // which is a defect in the harness reported as a defect in the target.
  return { value: (result.stdout ?? "").trim(), from: "standard output" };
}

/** Text an assertion can search, whatever the operation produced. */
function textOf(result: ExecutionResult): string {
  const parts = [result.stdout ?? "", result.stderr ?? ""];
  if (result.rows !== undefined) parts.push(JSON.stringify(result.rows));
  else if (result.body !== undefined) parts.push(JSON.stringify(result.body));
  return parts.filter(Boolean).join("\n");
}

/**
 * Judges an assertion against what an operation produced.
 *
 * An operation that did not complete never satisfies an assertion, and says
 * so distinctly: an assertion reported as violated invites someone to go
 * looking at the system under test, when the real problem was that the query
 * never ran.
 *
 * @param assertion - The claim to judge.
 * @param result - What the operation produced.
 * @returns The verdict and why it was reached.
 */
export function checkAssertion(assertion: Assertion, result: ExecutionResult): AssertionOutcome {
  if (!result.ok) {
    return {
      verdict: "violated",
      why: `the operation did not complete: ${result.failure ?? "no reason given"}`,
    };
  }

  switch (assertion.kind) {
    case "natural":
      return { verdict: "needs_judgement", why: assertion.text };

    case "row_count": {
      if (result.rows === undefined) {
        return { verdict: "violated", why: "the operation returned no rows to count" };
      }
      return result.rows.length === assertion.count
        ? { verdict: "satisfied", why: `${assertion.count} row(s), as expected` }
        : {
            verdict: "violated",
            why: `expected ${assertion.count} row(s) but found ${result.rows.length}`,
          };
    }

    case "equals": {
      const { value, from } = subjectOf(result);
      // Specifications write counts as numbers; databases and JSON return
      // them as strings often enough that comparing only structurally would
      // fail for reasons that have nothing to do with the system under test.
      const matches =
        deepEqual(value, assertion.value) || String(value) === String(assertion.value);
      return matches
        ? { verdict: "satisfied", why: `${from} equals the expected value` }
        : {
            verdict: "violated",
            why: `${from} is ${JSON.stringify(value)}, expected ${JSON.stringify(assertion.value)}`,
          };
    }

    case "contains": {
      const text = textOf(result);
      return text.includes(assertion.value)
        ? { verdict: "satisfied", why: `output contains "${assertion.value}"` }
        : { verdict: "violated", why: `output does not contain "${assertion.value}"` };
    }

    case "matches": {
      const text = textOf(result);
      let pattern: RegExp;
      try {
        pattern = new RegExp(assertion.pattern);
      } catch (cause) {
        return {
          verdict: "violated",
          why: `the pattern is not a valid expression: ${cause instanceof Error ? cause.message : String(cause)}`,
        };
      }
      return pattern.test(text)
        ? { verdict: "satisfied", why: `output matches /${assertion.pattern}/` }
        : { verdict: "violated", why: `output does not match /${assertion.pattern}/` };
    }
  }
}
