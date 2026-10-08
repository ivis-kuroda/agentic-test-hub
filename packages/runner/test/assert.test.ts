import { describe, expect, it } from "vitest";

import type { Assertion } from "@agentic-test-hub/core";

import { checkAssertion, subjectOf } from "../src/assert.ts";
import type { ExecutionResult } from "../src/executor/types.ts";

const result = (over: Partial<ExecutionResult> = {}): ExecutionResult => ({
  operation: "OP-X",
  ok: true,
  durationMs: 1,
  ...over,
});

describe("subjectOf", () => {
  it("uses the single cell when a query returned exactly one", () => {
    expect(subjectOf(result({ rows: [{ n: 0 }] })).value).toBe(0);
  });

  it("uses all rows when there is more than one", () => {
    const rows = [{ id: 1 }, { id: 2 }];
    expect(subjectOf(result({ rows })).value).toEqual(rows);
  });

  it("uses all rows when a single row has several columns", () => {
    const rows = [{ id: 1, name: "a" }];
    expect(subjectOf(result({ rows })).value).toEqual(rows);
  });

  it("prefers a response body over standard output", () => {
    expect(subjectOf(result({ body: { id: "n-1" }, stdout: "raw" })).value).toEqual({
      id: "n-1",
    });
  });

  it("falls back to standard output", () => {
    expect(subjectOf(result({ stdout: "done" })).value).toBe("done");
  });
});

describe("checkAssertion", () => {
  it("never satisfies an assertion when the operation did not complete", () => {
    const outcome = checkAssertion(
      { kind: "row_count", count: 0 },
      result({ ok: false, failure: "connection refused" }),
    );
    expect(outcome.verdict).toBe("violated");
    expect(outcome.why).toMatch(/did not complete/);
  });

  it("distinguishes a failed operation from a violated expectation", () => {
    const outcome = checkAssertion(
      { kind: "row_count", count: 0 },
      result({ ok: false, failure: "connection refused" }),
    );
    expect(outcome.why).toContain("connection refused");
  });

  it("counts rows", () => {
    expect(
      checkAssertion({ kind: "row_count", count: 2 }, result({ rows: [{}, {}] })).verdict,
    ).toBe("satisfied");
    expect(checkAssertion({ kind: "row_count", count: 0 }, result({ rows: [{}] })).verdict).toBe(
      "violated",
    );
  });

  it("reports what it found when a count is wrong", () => {
    const outcome = checkAssertion({ kind: "row_count", count: 0 }, result({ rows: [{}, {}] }));
    expect(outcome.why).toMatch(/expected 0 row\(s\) but found 2/);
  });

  it("refuses to count rows when the operation returned none", () => {
    expect(checkAssertion({ kind: "row_count", count: 0 }, result({ stdout: "" })).verdict).toBe(
      "violated",
    );
  });

  it("compares equality structurally", () => {
    expect(
      checkAssertion({ kind: "equals", value: { id: "n-1" } }, result({ body: { id: "n-1" } }))
        .verdict,
    ).toBe("satisfied");
  });

  it("accepts a count returned as a string, which databases often do", () => {
    expect(
      checkAssertion({ kind: "equals", value: 0 }, result({ rows: [{ n: "0" }] })).verdict,
    ).toBe("satisfied");
  });

  it("still rejects a genuinely different value", () => {
    expect(
      checkAssertion({ kind: "equals", value: 0 }, result({ rows: [{ n: "3" }] })).verdict,
    ).toBe("violated");
  });

  it("searches text for containment", () => {
    const found = result({ stdout: "Migration completed at 2026-01-01." });
    expect(checkAssertion({ kind: "contains", value: "Migration completed" }, found).verdict).toBe(
      "satisfied",
    );
  });

  it("searches standard error too, where tools often report", () => {
    expect(
      checkAssertion({ kind: "contains", value: "deprecated" }, result({ stderr: "deprecated" }))
        .verdict,
    ).toBe("satisfied");
  });

  it("searches serialised rows, so a query result can be matched as text", () => {
    expect(
      checkAssertion({ kind: "contains", value: "queued" }, result({ rows: [{ state: "queued" }] }))
        .verdict,
    ).toBe("satisfied");
  });

  it("matches a pattern", () => {
    expect(
      checkAssertion(
        { kind: "matches", pattern: "completed at \\d{4}" },
        result({ stdout: "completed at 2026" }),
      ).verdict,
    ).toBe("satisfied");
  });

  it("reports an invalid pattern as a violation rather than crashing the run", () => {
    const outcome = checkAssertion({ kind: "matches", pattern: "([" }, result({ stdout: "x" }));
    expect(outcome.verdict).toBe("violated");
    expect(outcome.why).toMatch(/not a valid expression/);
  });

  it("reports a claim stated in prose as needing judgement, not as satisfied", () => {
    const outcome = checkAssertion(
      { kind: "natural", text: "no duplicate rows remain" },
      result({ rows: [{ id: 1 }] }),
    );
    expect(outcome.verdict).toBe("needs_judgement");
    expect(outcome.why).toBe("no duplicate rows remain");
  });
});

describe("text output from real commands", () => {
  it("ignores the trailing newline a command prints", () => {
    // A count command writes "0\n". Comparing that to 0 must succeed: the
    // newline says nothing about the system under test.
    expect(checkAssertion({ kind: "equals", value: 0 }, result({ stdout: "0\n" })).verdict).toBe(
      "satisfied",
    );
  });

  it("ignores surrounding whitespace generally", () => {
    expect(
      checkAssertion({ kind: "equals", value: "ready" }, result({ stdout: "  ready \n" })).verdict,
    ).toBe("satisfied");
  });

  it("still distinguishes different values", () => {
    expect(checkAssertion({ kind: "equals", value: 0 }, result({ stdout: "1\n" })).verdict).toBe(
      "violated",
    );
  });

  it("reports the trimmed subject, so the message is readable", () => {
    expect(subjectOf(result({ stdout: "3\n" })).value).toBe("3");
  });
});

describe("checkAssertion with `at` and the extended kinds", () => {
  const verdictOf = (assertion: Assertion, over: Partial<ExecutionResult>) =>
    checkAssertion(assertion, result(over)).verdict;

  it("judges the value `at` selects instead of the default subject", () => {
    const body = { error: "bad" };
    expect(verdictOf({ kind: "equals", at: "body.error", value: "bad" }, { body })).toBe(
      "satisfied",
    );
    expect(verdictOf({ kind: "equals", at: "body.error", value: "x" }, { body })).toBe("violated");
    expect(verdictOf({ kind: "equals", at: "body.missing", value: 1 }, { body })).toBe("violated");
    expect(verdictOf({ kind: "equals", at: "status", value: 201 }, { status: 201 })).toBe(
      "satisfied",
    );
    expect(verdictOf({ kind: "equals", at: "exitCode", value: 0 }, { exitCode: 0 })).toBe(
      "satisfied",
    );
    expect(verdictOf({ kind: "contains", at: "stdout", value: "ok" }, { stdout: "all ok" })).toBe(
      "satisfied",
    );
    expect(
      verdictOf({ kind: "contains", at: "body.msg", value: "no" }, { body: { msg: "ok" } }),
    ).toBe("violated");
    expect(
      verdictOf({ kind: "matches", at: "body.id", pattern: "^\\d+$" }, { body: { id: 42 } }),
    ).toBe("satisfied");
  });

  it("reads response headers case-insensitively", () => {
    const headers = { location: "/items/7" };
    expect(
      verdictOf({ kind: "matches", at: "headers.Location", pattern: "/items/\\d+$" }, { headers }),
    ).toBe("satisfied");
  });

  it("keys compares the key set, ignoring order", () => {
    const body = { a: 1, b: 2 };
    expect(verdictOf({ kind: "keys", value: ["b", "a"] }, { body })).toBe("satisfied");
    expect(verdictOf({ kind: "keys", value: ["a"] }, { body })).toBe("violated");
    expect(verdictOf({ kind: "keys", value: ["a", "b", "c"] }, { body })).toBe("violated");
    expect(verdictOf({ kind: "keys", at: "body.x", value: ["k"] }, { body: { x: { k: 1 } } })).toBe(
      "satisfied",
    );
    expect(verdictOf({ kind: "keys", value: ["a"] }, { body: [1] })).toBe("violated");
  });

  it("one_of accepts any listed value, string/number tolerant", () => {
    expect(verdictOf({ kind: "one_of", at: "status", values: [200, 204] }, { status: 204 })).toBe(
      "satisfied",
    );
    expect(verdictOf({ kind: "one_of", at: "status", values: ["200"] }, { status: 200 })).toBe(
      "satisfied",
    );
    expect(verdictOf({ kind: "one_of", at: "status", values: [200, 204] }, { status: 500 })).toBe(
      "violated",
    );
  });

  it("compare coerces the subject to a number", () => {
    const cmp = (op: "lt" | "lte" | "gt" | "gte", value: number, n: unknown) =>
      verdictOf({ kind: "compare", op, value, at: "body.n" }, { body: { n } });
    expect(verdictOf({ kind: "compare", op: "lt", value: 100, at: "durationMs" }, {})).toBe(
      "satisfied",
    );
    expect(verdictOf({ kind: "compare", op: "gt", value: 100, at: "durationMs" }, {})).toBe(
      "violated",
    );
    expect(cmp("lte", 5, "5")).toBe("satisfied");
    expect(cmp("gte", 5, 4)).toBe("violated");
    expect(cmp("lt", 5, "abc")).toBe("violated");
    expect(cmp("lt", 5, "")).toBe("violated");
    expect(cmp("lt", 5, true)).toBe("violated");
  });
});
