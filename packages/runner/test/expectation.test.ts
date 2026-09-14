import { describe, expect, it } from "vitest";

import type { Expectation } from "@agentic-test-hub/core";

import { checkExpectation } from "../src/expectation.ts";
import type { ExecutionResult } from "../src/executor/types.ts";

const result = (over: Partial<ExecutionResult> = {}): ExecutionResult => ({
  operation: "OP-X",
  ok: true,
  durationMs: 1,
  ...over,
});

describe("checkExpectation", () => {
  const incompleteCases: Expectation[] = [
    { kind: "http_status", status: 200, viewpoints: [] },
    { kind: "text", value: "x", match: "contains", viewpoints: [] },
    { kind: "error_message", value: "x", match: "contains", viewpoints: [] },
    { kind: "stdout_contains", value: "x", viewpoints: [] },
    {
      kind: "operation_result",
      operation: "OP-Y",
      params: {},
      assert: { kind: "contains", value: "x" },
      viewpoints: [],
    },
    { kind: "ai_judgement", aspect: "visual", value: "x", viewpoints: [] },
    { kind: "unspecified", text: "x", viewpoints: [] },
  ];
  it.each(incompleteCases)(
    "never satisfies $kind when the operation did not complete",
    (expectation) => {
      const outcome = checkExpectation(
        expectation,
        result({ ok: false, failure: "connection refused" }),
      );
      expect(outcome.verdict).toBe("violated");
      expect(outcome.why).toMatch(/did not complete/);
    },
  );

  describe("http_status", () => {
    it("is satisfied when the status matches", () => {
      expect(
        checkExpectation(
          { kind: "http_status", status: 201, viewpoints: [] },
          result({ status: 201 }),
        ).verdict,
      ).toBe("satisfied");
    });

    it("is violated when the status differs", () => {
      const outcome = checkExpectation(
        { kind: "http_status", status: 201, viewpoints: [] },
        result({ status: 401 }),
      );
      expect(outcome.verdict).toBe("violated");
      expect(outcome.why).toMatch(/401.*201/);
    });

    it("is violated when no status was observed", () => {
      const outcome = checkExpectation(
        { kind: "http_status", status: 200, viewpoints: [] },
        result({ stdout: "ok" }),
      );
      expect(outcome.verdict).toBe("violated");
      expect(outcome.why).toMatch(/no HTTP status/);
    });
  });

  describe("text", () => {
    it("matches by containment by default", () => {
      expect(
        checkExpectation(
          { kind: "text", value: "Dispatch", match: "contains", viewpoints: [] },
          result({ stdout: "Dispatch — Home" }),
        ).verdict,
      ).toBe("satisfied");
    });

    it("matches exactly when asked", () => {
      expect(
        checkExpectation(
          { kind: "text", value: "Dispatch", match: "exact", viewpoints: [] },
          result({ stdout: "Dispatch — Home" }),
        ).verdict,
      ).toBe("violated");
    });

    it("matches a regular expression", () => {
      expect(
        checkExpectation(
          { kind: "text", value: "^Dispatch", match: "regex", viewpoints: [] },
          result({ stdout: "Dispatch — Home" }),
        ).verdict,
      ).toBe("satisfied");
    });

    it("reports an invalid pattern as violated rather than throwing", () => {
      const outcome = checkExpectation(
        { kind: "text", value: "([", match: "regex", viewpoints: [] },
        result({ stdout: "x" }),
      );
      expect(outcome.verdict).toBe("violated");
      expect(outcome.why).toMatch(/not a valid expression/);
    });

    it("reports a scoped claim as needing judgement, not silently checked unscoped", () => {
      const outcome = checkExpectation(
        { kind: "text", value: "Dispatch", match: "contains", scope: "header", viewpoints: [] },
        result({ stdout: "Dispatch — Home" }),
      );
      expect(outcome.verdict).toBe("needs_judgement");
      expect(outcome.why).toContain("header");
    });
  });

  describe("error_message", () => {
    it("matches like text, with no scope field, and can find the message inside a JSON body", () => {
      expect(
        checkExpectation(
          {
            kind: "error_message",
            value: "recipient is required",
            match: "contains",
            viewpoints: [],
          },
          result({ body: { error: "recipient is required" } }),
        ).verdict,
      ).toBe("satisfied");
    });
  });

  describe("stdout_contains", () => {
    it("searches stdout by default when no stream is named", () => {
      expect(
        checkExpectation(
          { kind: "stdout_contains", value: "done", viewpoints: [] },
          result({ stdout: "migration done" }),
        ).verdict,
      ).toBe("satisfied");
    });

    it("searches stderr when named", () => {
      expect(
        checkExpectation(
          { kind: "stdout_contains", value: "deprecated", stream: "stderr", viewpoints: [] },
          result({ stderr: "deprecated flag used" }),
        ).verdict,
      ).toBe("satisfied");
    });

    it("does not find a stderr-only message when scoped to stdout", () => {
      expect(
        checkExpectation(
          { kind: "stdout_contains", value: "deprecated", stream: "stdout", viewpoints: [] },
          result({ stderr: "deprecated flag used" }),
        ).verdict,
      ).toBe("violated");
    });
  });

  describe("operation_result", () => {
    it("delegates to checkAssertion", () => {
      expect(
        checkExpectation(
          {
            kind: "operation_result",
            operation: "OP-READ-LOGS",
            params: {},
            assert: { kind: "row_count", count: 1 },
            viewpoints: [],
          },
          result({ rows: [{ id: 1 }] }),
        ).verdict,
      ).toBe("satisfied");
    });

    it("reports a natural-language assertion as needing judgement, via the same delegation", () => {
      expect(
        checkExpectation(
          {
            kind: "operation_result",
            operation: "OP-READ-LOGS",
            params: {},
            assert: { kind: "natural", text: "the log reads clearly" },
            viewpoints: [],
          },
          result({ stdout: "..." }),
        ).verdict,
      ).toBe("needs_judgement");
    });
  });

  describe("ai_judgement and unspecified", () => {
    it("always needs judgement for ai_judgement", () => {
      const outcome = checkExpectation(
        {
          kind: "ai_judgement",
          aspect: "visual",
          value: "the layout is not broken",
          viewpoints: [],
        },
        result(),
      );
      expect(outcome.verdict).toBe("needs_judgement");
      expect(outcome.why).toContain("visual");
      expect(outcome.why).toContain("the layout is not broken");
    });

    it("always needs judgement for unspecified", () => {
      const outcome = checkExpectation(
        { kind: "unspecified", text: "an error is returned", viewpoints: [] },
        result(),
      );
      expect(outcome.verdict).toBe("needs_judgement");
      expect(outcome.why).toBe("an error is returned");
    });
  });
});
