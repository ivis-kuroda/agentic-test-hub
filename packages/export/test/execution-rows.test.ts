import { describe, expect, it } from "vitest";

import { EMPTY_SUITE, Scenario, type Suite } from "@agentic-test-hub/core";

import { baseline, caseBaselineEmail, caseNoAuth, caseSms } from "../../core/test/fixtures.ts";
import { buildDeliveryRows, rowForCase } from "../src/execution-rows.ts";

describe("rowForCase", () => {
  it("resolves the target from the baseline when the case does not override it", () => {
    const row = rowForCase(caseBaselineEmail, baseline);
    expect(row.target).toBe(baseline.target?.surface);
    expect(row.action).toBe(baseline.target?.action);
  });

  it("describes the fully-resolved action, with no override left implicit", () => {
    const row = rowForCase(caseSms, baseline);
    expect(row.procedure).toContain("OP-DISPATCH-SEND");
  });

  it("carries every expectation as readable text", () => {
    const row = rowForCase(caseBaselineEmail, baseline);
    expect(row.expected).toHaveLength(caseBaselineEmail.expect.length);
    expect(row.expected[0]).toContain("200");
  });

  it("resolves preconditions from the baseline", () => {
    const row = rowForCase(caseBaselineEmail, baseline);
    expect(row.preconditions).toEqual(baseline.preconditions);
  });

  it("identifies its source as the case", () => {
    const row = rowForCase(caseNoAuth, baseline);
    expect(row.source).toEqual({ caseId: caseNoAuth.id });
  });
});

describe("buildDeliveryRows", () => {
  const suite: Suite = {
    ...EMPTY_SUITE,
    baselines: [baseline],
    cases: [caseBaselineEmail, caseSms],
  };

  it("produces one row per case", () => {
    expect(buildDeliveryRows(suite)).toHaveLength(2);
  });

  it("skips a case whose baseline does not exist, rather than throwing", () => {
    const orphan = { ...caseBaselineEmail, id: "TC-ORPHAN", baseline: "BL-GONE" };
    const rows = buildDeliveryRows({ ...suite, cases: [...suite.cases, orphan] });
    expect(rows).toHaveLength(2);
    expect(rows.some((row) => "caseId" in row.source && row.source.caseId === "TC-ORPHAN")).toBe(
      false,
    );
  });

  it("flattens a scenario's steps, one row each", () => {
    const scenario = Scenario.parse({
      id: "SC-X",
      title: "t",
      viewpoints: [],
      preconditions: ["queue.empty"],
      steps: [
        {
          id: "S-1",
          summary: "first",
          viewpoints: [],
          expect: [{ kind: "http_status" as const, status: 200, viewpoints: [] }],
          dependsOn: [],
          produces: {},
        },
        {
          id: "S-2",
          summary: "second",
          viewpoints: [],
          expect: [{ kind: "http_status" as const, status: 200, viewpoints: [] }],
          dependsOn: ["S-1"],
          produces: {},
        },
      ],
      tags: [],
    });
    const rows = buildDeliveryRows({ ...EMPTY_SUITE, scenarios: [scenario] });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.source).toEqual({ scenarioId: "SC-X", stepId: "S-1" });
  });

  it("shows the scenario's preconditions only on the first step", () => {
    const scenario = Scenario.parse({
      id: "SC-X",
      title: "t",
      viewpoints: [],
      preconditions: ["queue.empty"],
      steps: [
        {
          id: "S-1",
          summary: "first",
          viewpoints: [],
          expect: [{ kind: "http_status" as const, status: 200, viewpoints: [] }],
          dependsOn: [],
          produces: {},
        },
        {
          id: "S-2",
          summary: "second",
          viewpoints: [],
          expect: [{ kind: "http_status" as const, status: 200, viewpoints: [] }],
          dependsOn: ["S-1"],
          produces: {},
        },
      ],
      tags: [],
    });
    const rows = buildDeliveryRows({ ...EMPTY_SUITE, scenarios: [scenario] });
    expect(rows[0]?.preconditions).toEqual(["queue.empty"]);
    expect(rows[1]?.preconditions).toEqual([]);
  });

  it("orders cases before scenarios", () => {
    const scenario = Scenario.parse({
      id: "SC-X",
      title: "t",
      viewpoints: [],
      preconditions: [],
      steps: [
        {
          id: "S-1",
          summary: "s",
          viewpoints: [],
          expect: [{ kind: "http_status" as const, status: 200, viewpoints: [] }],
          dependsOn: [],
          produces: {},
        },
      ],
      tags: [],
    });
    const rows = buildDeliveryRows({ ...suite, scenarios: [scenario] });
    expect(rows).toHaveLength(3);
    expect("caseId" in rows[0]!.source).toBe(true);
    expect("caseId" in rows[1]!.source).toBe(true);
    expect("stepId" in rows[2]!.source).toBe(true);
  });
});
