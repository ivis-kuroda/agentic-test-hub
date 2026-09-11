import { describe, expect, it } from "vitest";

import { TestCase } from "../src/schema/case.js";
import { DEFAULT_EVIDENCE_PLAN } from "../src/schema/evidence.js";
import { Expectation, isMechanical } from "../src/schema/expectation.js";
import { Factor } from "../src/schema/factor.js";
import { CaseId, StateRef, ViewpointId } from "../src/schema/id.js";
import { Scenario } from "../src/schema/scenario.js";
import { Viewpoint } from "../src/schema/viewpoint.js";

describe("identifiers", () => {
  it("accepts a prefixed, hyphenated identifier", () => {
    expect(CaseId.parse("TC-DISPATCH-001")).toBe("TC-DISPATCH-001");
  });

  it("rejects an identifier carrying the wrong prefix", () => {
    expect(() => CaseId.parse("VP-DISPATCH-001")).toThrow();
  });

  it("rejects lower case, so identifiers stay visually distinct from prose", () => {
    expect(() => ViewpointId.parse("vp-auth")).toThrow();
  });

  it("accepts a dotted state name", () => {
    expect(StateRef.parse("queue.empty")).toBe("queue.empty");
  });

  it("rejects a state name shaped like an entity identifier", () => {
    expect(() => StateRef.parse("ST-QUEUE-EMPTY")).toThrow();
  });
});

describe("expectations", () => {
  it("treats a status assertion as mechanically checkable", () => {
    expect(isMechanical(Expectation.parse({ kind: "http_status", status: 200 }))).toBe(true);
  });

  it("treats a judgement as not mechanically checkable", () => {
    const judged = Expectation.parse({
      kind: "ai_judgement",
      aspect: "visual",
      value: "the list is not visually broken",
    });
    expect(isMechanical(judged)).toBe(false);
  });

  it("treats an operation judged in prose as needing judgement", () => {
    const prose = Expectation.parse({
      kind: "operation_result",
      operation: "OP-QUERY-ROWS",
      assert: { kind: "natural", text: "no duplicate rows remain" },
    });
    expect(isMechanical(prose)).toBe(false);
  });

  it("treats the same operation judged by a count as mechanical", () => {
    const counted = Expectation.parse({
      kind: "operation_result",
      operation: "OP-QUERY-ROWS",
      assert: { kind: "row_count", count: 0 },
    });
    expect(isMechanical(counted)).toBe(true);
  });

  it("carries an unverifiable imported claim verbatim, and marks it as such", () => {
    const imported = Expectation.parse({ kind: "unspecified", text: "an error is returned" });
    expect(isMechanical(imported)).toBe(false);
    expect(imported).toHaveProperty("text", "an error is returned");
  });

  it("keeps accepted divergence out of free-form remarks", () => {
    const parsed = Expectation.parse({
      kind: "text",
      value: "saved",
      knownDeviation: "the record stays public by design",
    });
    expect(parsed.knownDeviation).toBe("the record stays public by design");
  });

  it("defaults text matching to containment rather than equality", () => {
    expect(Expectation.parse({ kind: "text", value: "saved" })).toHaveProperty("match", "contains");
  });
});

describe("viewpoints", () => {
  it("refuses a viewpoint with no traceable source", () => {
    expect(() => Viewpoint.parse({ id: "VP-X", title: "t", rationale: "r", source: [] })).toThrow();
  });
});

describe("factors", () => {
  it("refuses a factor with fewer than two levels, which would not vary", () => {
    expect(() =>
      Factor.parse({ id: "F-X", name: "x", levels: [{ id: "L-A", name: "a" }] }),
    ).toThrow();
  });
});

describe("cases", () => {
  const minimal = {
    id: "TC-X-001",
    summary: "s",
    baseline: "BL-X",
    expect: [{ kind: "http_status", status: 200 }],
  };

  it("refuses a case with nothing to check", () => {
    expect(() => TestCase.parse({ ...minimal, expect: [] })).toThrow();
  });

  it("defaults to expecting success", () => {
    expect(TestCase.parse(minimal).polarity).toBe("nominal");
  });

  it("leaves isolation unset so it can be derived", () => {
    expect(TestCase.parse(minimal).isolation).toBeUndefined();
  });

  it("defaults automation to manual, so imported cases are not claimed as automated", () => {
    expect(TestCase.parse(minimal).automation.status).toBe("manual");
  });
});

describe("scenarios", () => {
  it("refuses a scenario with no steps", () => {
    expect(() => Scenario.parse({ id: "SC-X", title: "t", steps: [] })).toThrow();
  });

  it("keeps step dependencies and produced values as data", () => {
    const parsed = Scenario.parse({
      id: "SC-X",
      title: "t",
      steps: [
        {
          id: "S-1",
          summary: "create the record",
          expect: [{ kind: "http_status", status: 201 }],
          produces: { recordId: "response.body.id" },
        },
        {
          id: "S-2",
          summary: "read it back",
          expect: [{ kind: "http_status", status: 200 }],
          dependsOn: ["S-1"],
        },
      ],
    });
    expect(parsed.steps[0]?.produces).toEqual({ recordId: "response.body.id" });
    expect(parsed.steps[1]?.dependsOn).toEqual(["S-1"]);
  });
});

describe("evidence defaults", () => {
  it("collects every channel by default, not only screenshots", () => {
    expect(DEFAULT_EVIDENCE_PLAN.sources).toContain("app_log");
    expect(DEFAULT_EVIDENCE_PLAN.sources).toContain("db_records");
    expect(DEFAULT_EVIDENCE_PLAN.sources.length).toBeGreaterThan(1);
  });

  it("keeps traces for failures only, since they are large", () => {
    expect(DEFAULT_EVIDENCE_PLAN.trace).toBe("on_failure");
  });
});
