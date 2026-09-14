import type { Expectation } from "@agentic-test-hub/core";

import { checkAssertion, textOf, type AssertionOutcome } from "./assert.ts";
import type { ExecutionResult } from "./executor/types.ts";

function matchText(
  match: "exact" | "contains" | "regex",
  text: string,
  value: string,
): AssertionOutcome {
  if (match === "regex") {
    let pattern: RegExp;
    try {
      pattern = new RegExp(value);
    } catch (cause) {
      return {
        verdict: "violated",
        why: `the pattern is not a valid expression: ${cause instanceof Error ? cause.message : String(cause)}`,
      };
    }
    return pattern.test(text)
      ? { verdict: "satisfied", why: `text matches /${value}/` }
      : { verdict: "violated", why: `text does not match /${value}/` };
  }

  const satisfied = match === "exact" ? text === value : text.includes(value);
  const verb = match === "exact" ? "equal" : "contain";
  return satisfied
    ? { verdict: "satisfied", why: `text ${verb}s "${value}"` }
    : { verdict: "violated", why: `text does not ${verb} "${value}"` };
}

function textForStream(result: ExecutionResult, stream: "stdout" | "stderr" | undefined): string {
  if (stream === "stdout") return result.stdout ?? "";
  if (stream === "stderr") return result.stderr ?? "";
  return [result.stdout ?? "", result.stderr ?? ""].filter(Boolean).join("\n");
}

/**
 * Judges an expectation against what an operation produced.
 *
 * Covers all seven {@link Expectation} kinds, unlike {@link checkAssertion}
 * which only judges the `Assertion` union nested inside an
 * `operation_result` expectation. For `operation_result` itself, this
 * delegates to `checkAssertion` directly — the caller (`runCase`/`runStep`)
 * is responsible for having already run `expectation.operation` with
 * `expectation.params` and passing *that* result here, since it is a
 * different operation from whatever the case's own action was.
 *
 * @param expectation - The claim to judge.
 * @param result - What the relevant operation produced.
 * @returns The verdict and why it was reached.
 */
export function checkExpectation(
  expectation: Expectation,
  result: ExecutionResult,
): AssertionOutcome {
  if (!result.ok) {
    return {
      verdict: "violated",
      why: `the operation did not complete: ${result.failure ?? "no reason given"}`,
    };
  }

  switch (expectation.kind) {
    case "http_status": {
      if (result.status === undefined) {
        return { verdict: "violated", why: "no HTTP status was observed" };
      }
      return result.status === expectation.status
        ? { verdict: "satisfied", why: `status is ${expectation.status}, as expected` }
        : {
            verdict: "violated",
            why: `status is ${result.status}, expected ${expectation.status}`,
          };
    }

    case "text": {
      // Nothing narrows an ExecutionResult to one region of a page yet, so a
      // scoped claim cannot be settled by comparison. Reported rather than
      // silently checked against the whole result, which would risk a false
      // pass on text present somewhere the case did not mean.
      if (expectation.scope !== undefined) {
        return {
          verdict: "needs_judgement",
          why: `scope "${expectation.scope}" is not yet checkable mechanically`,
        };
      }
      return matchText(expectation.match, textOf(result), expectation.value);
    }

    case "error_message":
      return matchText(expectation.match, textOf(result), expectation.value);

    case "stdout_contains": {
      const text = textForStream(result, expectation.stream);
      return text.includes(expectation.value)
        ? { verdict: "satisfied", why: `output contains "${expectation.value}"` }
        : { verdict: "violated", why: `output does not contain "${expectation.value}"` };
    }

    case "operation_result":
      return checkAssertion(expectation.assert, result);

    case "ai_judgement":
      return { verdict: "needs_judgement", why: `(${expectation.aspect}) ${expectation.value}` };

    case "unspecified":
      return { verdict: "needs_judgement", why: expectation.text };
  }
}
