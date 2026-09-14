import { describe, expect, it } from "vitest";

import { Baseline, Scenario, TestCase, type Suite } from "@agentic-test-hub/core";
import { loadManifest, type PluginManifest } from "@agentic-test-hub/plugin";

import {
  executorKindsFor,
  operationsTouched,
  planGeneration,
  type PlanOutcome,
} from "../src/plan.ts";

function expectOk(outcome: PlanOutcome): asserts outcome is Extract<PlanOutcome, { ok: true }> {
  expect(outcome.ok).toBe(true);
}

function expectRefused(
  outcome: PlanOutcome,
): asserts outcome is Extract<PlanOutcome, { ok: false }> {
  expect(outcome.ok).toBe(false);
}

const manifestSource = `
apiVersion: "1"
name: dispatch-service
extensionModule: "plugin.extensions"

connections:
  api:
    kind: http
    baseUrl: "https://api.invalid/v1"
  postgres:
    kind: postgres
    url: "postgres://invalid/dispatch"

operations:
  OP-SEND:
    executor: http
    connection: api
    method: POST
    path: /notifications
    params: [channel]
    body:
      channel: "{{param.channel}}"

  OP-SEED-DB:
    executor: sql
    connection: postgres
    query: "insert into notifications (channel) values ({{param.channel}})"

  OP-SEED-INDEX:
    executor: extension
    handler: seed_search_index

  OP-COUNT:
    executor: shell
    run: ["true"]
    timeoutMs: 5000

states:
  queue.empty:
    ensure: { operation: OP-COUNT }
    verify:
      operation: OP-COUNT
      assert: { kind: equals, value: 0 }
    cost: low
`;

const manifest: PluginManifest = loadManifest(manifestSource).manifest;

const baseline = Baseline.parse({
  id: "BL-TEST",
  title: "the standard request",
  preconditions: [],
  config: {},
  context: { body: { channel: "email" } },
  action: { operation: "OP-SEND", params: {} },
});

function suiteWith(over: Partial<Suite>): Suite {
  return {
    viewpoints: [],
    factors: [],
    matrices: [],
    baselines: [baseline],
    cases: [],
    scenarios: [],
    ...over,
  };
}

function caseWith(id: string, over: Record<string, unknown>): TestCase {
  return TestCase.parse({
    id,
    summary: "a test case",
    baseline: "BL-TEST",
    overrides: [],
    expect: [{ kind: "http_status", status: 201, viewpoints: [] }],
    polarity: "nominal",
    priority: "P2",
    viewpoints: [],
    ...over,
  });
}

describe("planGeneration", () => {
  it("refuses an id that is neither a case nor a scenario id", () => {
    const outcome = planGeneration(suiteWith({}), manifest, "XX-NOPE", "typescript");
    expectRefused(outcome);
    expect(outcome.refusal.reason).toContain("neither a case id");
  });

  it("refuses a case id the suite does not have", () => {
    const outcome = planGeneration(suiteWith({}), manifest, "TC-MISSING", "typescript");
    expect(outcome.ok).toBe(false);
  });

  it("generates a plan for a plain http case, in either language", () => {
    const testCase = caseWith("TC-OK", {});
    for (const lang of ["typescript", "python"] as const) {
      const outcome = planGeneration(suiteWith({ cases: [testCase] }), manifest, "TC-OK", lang);
      expectOk(outcome);
      const plan = outcome.plan;
      if (plan.kind !== "case") throw new Error("expected a case plan");
      expect(plan.operationId).toBe("OP-SEND");
      expect(operationsTouched(plan, manifest)).toEqual(["OP-SEND"]);
      expect(executorKindsFor(plan, manifest)).toEqual(["http"]);
    }
  });

  it("refuses a case whose override has no mechanical path to the operation", () => {
    const testCase = caseWith("TC-BLOCKED", {
      overrides: [{ path: "context.headers.Authorization", op: "remove" }],
    });
    const outcome = planGeneration(
      suiteWith({ cases: [testCase] }),
      manifest,
      "TC-BLOCKED",
      "typescript",
    );
    expectRefused(outcome);
    expect(outcome.refusal.paths).toContain("context.headers.Authorization");
  });

  it("refuses a case using the sql executor, in both languages", () => {
    const testCase = caseWith("TC-SQL", {
      expect: [
        {
          kind: "operation_result",
          operation: "OP-SEED-DB",
          params: { channel: "email" },
          assert: { kind: "contains", value: "1" },
          viewpoints: [],
        },
      ],
    });
    for (const lang of ["typescript", "python"] as const) {
      const outcome = planGeneration(suiteWith({ cases: [testCase] }), manifest, "TC-SQL", lang);
      expectRefused(outcome);
      expect(outcome.refusal.reason).toContain("OP-SEED-DB");
    }
  });

  it("refuses a case using the extension executor for typescript, but allows it for python", () => {
    const testCase = caseWith("TC-EXT", {
      expect: [
        {
          kind: "operation_result",
          operation: "OP-SEED-INDEX",
          params: {},
          assert: { kind: "contains", value: "ok" },
          viewpoints: [],
        },
      ],
    });
    const ts = planGeneration(suiteWith({ cases: [testCase] }), manifest, "TC-EXT", "typescript");
    expectRefused(ts);
    expect(ts.refusal.reason).toContain("OP-SEED-INDEX");

    const py = planGeneration(suiteWith({ cases: [testCase] }), manifest, "TC-EXT", "python");
    expectOk(py);
  });

  it("includes a precondition's ensure/verify operations, so their executor is registered too", () => {
    const baselineWithPrecondition = Baseline.parse({
      ...baseline,
      id: "BL-WITH-PRECONDITION",
      preconditions: ["queue.empty"],
    });
    const testCase = caseWith("TC-PRECONDITION", { baseline: "BL-WITH-PRECONDITION" });
    const outcome = planGeneration(
      suiteWith({ baselines: [baseline, baselineWithPrecondition], cases: [testCase] }),
      manifest,
      "TC-PRECONDITION",
      "typescript",
    );
    expectOk(outcome);
    const plan = outcome.plan;
    if (plan.kind !== "case") throw new Error("expected a case plan");
    expect(operationsTouched(plan, manifest)).toEqual(
      expect.arrayContaining(["OP-SEND", "OP-COUNT"]),
    );
    expect(executorKindsFor(plan, manifest)).toEqual(expect.arrayContaining(["http", "shell"]));
  });

  it("generates a plan for a scenario, and refuses one touching sql", () => {
    const scenario = Scenario.parse({
      id: "SC-OK",
      title: "a scenario",
      preconditions: [],
      steps: [
        {
          id: "S-1",
          summary: "send it",
          action: { operation: "OP-SEND", params: { channel: "email" } },
          expect: [{ kind: "http_status", status: 201, viewpoints: [] }],
          polarity: "nominal",
          dependsOn: [],
          produces: {},
          viewpoints: [],
        },
      ],
      viewpoints: [],
    });
    const outcome = planGeneration(
      suiteWith({ scenarios: [scenario] }),
      manifest,
      "SC-OK",
      "typescript",
    );
    expect(outcome.ok).toBe(true);
  });
});
