import { describe, expect, it } from "vitest";

import { Baseline, TestCase } from "@agentic-test-hub/core";
import { loadManifest, type PluginManifest } from "@agentic-test-hub/plugin";

import { HttpExecutor } from "../src/executor/http.ts";
import { runCase } from "../src/run-case.ts";
import { registryWith } from "./harness.ts";
import type { ExecutionContext } from "../src/executor/types.ts";

/**
 * A fictional dispatch manifest with one precondition, one evidence
 * collector (app_log) and a policy scoped to just that one channel — the
 * same shape as `examples/demo-app/plugin.yaml`'s own fix for Finding B, so
 * these tests exercise the same policy behaviour a generated test will.
 */
const manifestSource = `
apiVersion: "1"
name: dispatch-service

connections:
  api:
    kind: http
    baseUrl: "https://api.invalid/v1"

operations:
  OP-SEND:
    executor: http
    connection: api
    method: POST
    path: /notifications
    params: [channel]
    body:
      channel: "{{param.channel}}"

  OP-READ-LOGS:
    executor: http
    connection: api
    path: /logs

states:
  # Never actually satisfiable, deliberately — only used by the test that
  # exercises the not-ready path, so ensure/verify's own operation does not
  # need to mean anything.
  never.ready:
    ensure: { operation: OP-READ-LOGS }
    verify:
      operation: OP-READ-LOGS
      assert: { kind: contains, value: "this text never appears" }
    cost: low

evidence:
  app_log:
    operation: OP-READ-LOGS

policy:
  id: test-app-log-only
  title: judged on the application log alone
  rules:
    nominal:
      screenshot: informational
      browser_console: informational
      browser_network: informational
      db_records: informational
      app_log: clean
      db_log: informational
    error:
      screenshot: informational
      browser_console: informational
      browser_network: informational
      db_records: informational
      app_log: expected_error
      db_log: informational
`;

const manifest: PluginManifest = loadManifest(manifestSource).manifest;
const context: ExecutionContext = { manifest, scopes: {}, root: "/plugin" };

const baseline = Baseline.parse({
  id: "BL-TEST",
  title: "the standard request",
  preconditions: [],
  config: {},
  context: { body: { channel: "email" } },
  action: { operation: "OP-SEND", params: {} },
});

function caseWith(over: Record<string, unknown>) {
  return TestCase.parse({
    id: "TC-TEST",
    summary: "a test case",
    baseline: "BL-TEST",
    overrides: [],
    expect: [{ kind: "http_status", status: 201, viewpoints: [] }],
    polarity: "nominal",
    priority: "P2",
    ...over,
  });
}

/** Replies with `actionStatus` to the first request, `logsBody` to every one after. */
function sequencedFetch(actionStatus: number, logsBody: string): typeof fetch & { calls: number } {
  let count = 0;
  const fn = (async () => {
    count += 1;
    Object.assign(fn, { calls: count });
    return count === 1
      ? new Response("", { status: actionStatus })
      : new Response(logsBody, { status: 200 });
  }) as typeof fetch;
  return Object.assign(fn, { calls: 0 });
}

describe("runCase", () => {
  it("passes when the action succeeds, every expectation holds and evidence is clean", async () => {
    const registry = registryWith(new HttpExecutor(sequencedFetch(201, "all quiet")));
    const result = await runCase(caseWith({}), baseline, registry, context);

    expect(result.blocked).toBeUndefined();
    expect(result.preparation.ready).toBe(true);
    expect(result.expectations).toHaveLength(1);
    expect(result.expectations[0]?.outcome.verdict).toBe("satisfied");
    expect(result.evidence.verdict).toBe("pass");
    expect(result.verdict).toBe("pass");
  });

  it("fails when an expectation is violated even if evidence is clean", async () => {
    // The action returns 200, not the 201 the case expects.
    const registry = registryWith(new HttpExecutor(sequencedFetch(200, "all quiet")));
    const result = await runCase(caseWith({}), baseline, registry, context);

    expect(result.expectations[0]?.outcome.verdict).toBe("violated");
    expect(result.evidence.verdict).toBe("pass");
    expect(result.verdict).toBe("fail");
  });

  it("fails when evidence is dirty even though every expectation is satisfied", async () => {
    const registry = registryWith(new HttpExecutor(sequencedFetch(201, "error: something broke")));
    const result = await runCase(caseWith({}), baseline, registry, context);

    expect(result.expectations[0]?.outcome.verdict).toBe("satisfied");
    expect(result.evidence.verdict).toBe("fail");
    expect(result.verdict).toBe("fail");
  });

  it("is blocked, and runs nothing, when an override cannot mechanically reach the operation", async () => {
    const fetchFn = sequencedFetch(201, "all quiet");
    const registry = registryWith(new HttpExecutor(fetchFn));
    const result = await runCase(
      caseWith({ overrides: [{ path: "context.headers.Authorization", op: "remove" }] }),
      baseline,
      registry,
      context,
    );

    expect(result.blocked).toBeDefined();
    expect(result.blocked?.paths).toContain("context.headers.Authorization");
    expect(result.action).toBeUndefined();
    expect(result.verdict).toBe("inconclusive");
    expect(fetchFn.calls).toBe(0);
  });

  it("is inconclusive, and runs nothing, when a precondition is not ready", async () => {
    const unreadyBaseline = Baseline.parse({ ...baseline, preconditions: ["never.ready"] });
    const fetchFn = sequencedFetch(201, "all quiet");
    const registry = registryWith(new HttpExecutor(fetchFn));
    const result = await runCase(caseWith({}), unreadyBaseline, registry, context);

    expect(result.preparation.ready).toBe(false);
    expect(result.action).toBeUndefined();
    expect(result.verdict).toBe("inconclusive");
  });
});
