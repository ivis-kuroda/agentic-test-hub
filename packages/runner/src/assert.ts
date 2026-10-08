import { deepEqual, getAtPath, type Assertion, type Resolved } from "@agentic-test-hub/core";

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

/**
 * Reads a dotted path out of an {@link ExecutionResult}.
 *
 * The one reader behind both an assertion's `at` and a scenario step's
 * `produces`, so the two always agree on what a path means. Response header
 * names are stored lower-cased, so the segment after `headers` is lower-cased
 * before the lookup.
 *
 * @param result - What an operation produced.
 * @param path - Dotted path such as `body.error` or `headers.location`.
 * @returns The value, or an absent marker when any segment is missing.
 */
export function getResultAtPath(result: ExecutionResult, path: string): Resolved {
  const segments = path.split(".");
  if (segments[0] === "headers" && segments[1] !== undefined) {
    segments[1] = segments[1].toLowerCase();
  }
  return getAtPath(result, segments.join("."));
}

type Subject = { ok: true; value: unknown; from: string } | { ok: false; why: string };

/** The value an assertion judges: what `at` selects, else {@link subjectOf}. */
function subjectFor(at: string | undefined, result: ExecutionResult): Subject {
  if (at === undefined) return { ok: true, ...subjectOf(result) };
  const read = getResultAtPath(result, at);
  if (!read.present) return { ok: false, why: `nothing at "${at}" in the result` };
  return { ok: true, value: read.value, from: `"${at}"` };
}

/** Text form of a subject chosen by `at`: strings as they are, anything else as JSON. */
function textOfSubject(value: unknown): string {
  return typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
}

function looselyEqual(a: unknown, b: unknown): boolean {
  return deepEqual(a, b) || String(a) === String(b);
}

/** Reads a value as a finite number, refusing blanks and booleans that `Number` would coerce. */
function toNumber(value: unknown): number | undefined {
  if (typeof value === "boolean") return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Text an assertion can search, whatever the operation produced.
 *
 * Exported for {@link checkExpectation} (see `expectation.ts`), which needs
 * the same body/rows/stdout flattening for its `text`/`error_message` kinds
 * — a second implementation of "what counts as searchable text" would drift
 * from this one.
 */
export function textOf(result: ExecutionResult): string {
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
      const subject = subjectFor(assertion.at, result);
      if (!subject.ok) return { verdict: "violated", why: subject.why };
      const { value, from } = subject;
      // Specifications write counts as numbers; databases and JSON return
      // them as strings often enough that comparing only structurally would
      // fail for reasons that have nothing to do with the system under test.
      return looselyEqual(value, assertion.value)
        ? { verdict: "satisfied", why: `${from} equals the expected value` }
        : {
            verdict: "violated",
            why: `${from} is ${JSON.stringify(value)}, expected ${JSON.stringify(assertion.value)}`,
          };
    }

    case "one_of": {
      const subject = subjectFor(assertion.at, result);
      if (!subject.ok) return { verdict: "violated", why: subject.why };
      return assertion.values.some((candidate) => looselyEqual(subject.value, candidate))
        ? { verdict: "satisfied", why: `${subject.from} is one of the accepted values` }
        : {
            verdict: "violated",
            why: `${subject.from} is ${JSON.stringify(subject.value)}, expected one of ${JSON.stringify(assertion.values)}`,
          };
    }

    case "keys": {
      const subject = subjectFor(assertion.at, result);
      if (!subject.ok) return { verdict: "violated", why: subject.why };
      const { value, from } = subject;
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return {
          verdict: "violated",
          why: `${from} is not an object, so it has no keys to compare`,
        };
      }
      const actual = new Set(Object.keys(value));
      const expected = new Set(assertion.value);
      const missing = [...expected].filter((key) => !actual.has(key));
      const extra = [...actual].filter((key) => !expected.has(key));
      return missing.length === 0 && extra.length === 0
        ? { verdict: "satisfied", why: `${from} has exactly the expected keys` }
        : {
            verdict: "violated",
            why: `${from} keys differ: missing ${JSON.stringify(missing)}, unexpected ${JSON.stringify(extra)}`,
          };
    }

    case "compare": {
      const subject = subjectFor(assertion.at, result);
      if (!subject.ok) return { verdict: "violated", why: subject.why };
      const n = toNumber(subject.value);
      if (n === undefined) {
        return {
          verdict: "violated",
          why: `${subject.from} is ${JSON.stringify(subject.value)}, which is not a number`,
        };
      }
      const holds = {
        lt: n < assertion.value,
        lte: n <= assertion.value,
        gt: n > assertion.value,
        gte: n >= assertion.value,
      }[assertion.op];
      return holds
        ? {
            verdict: "satisfied",
            why: `${subject.from} (${n}) is ${assertion.op} ${assertion.value}`,
          }
        : {
            verdict: "violated",
            why: `${subject.from} is ${n}, expected ${assertion.op} ${assertion.value}`,
          };
    }

    case "contains": {
      let text: string;
      if (assertion.at === undefined) text = textOf(result);
      else {
        const subject = subjectFor(assertion.at, result);
        if (!subject.ok) return { verdict: "violated", why: subject.why };
        text = textOfSubject(subject.value);
      }
      return text.includes(assertion.value)
        ? { verdict: "satisfied", why: `output contains "${assertion.value}"` }
        : { verdict: "violated", why: `output does not contain "${assertion.value}"` };
    }

    case "matches": {
      let text: string;
      if (assertion.at === undefined) text = textOf(result);
      else {
        const subject = subjectFor(assertion.at, result);
        if (!subject.ok) return { verdict: "violated", why: subject.why };
        text = textOfSubject(subject.value);
      }
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
