import { describe, expect, it } from "vitest";

import { Scenario } from "@agentic-test-hub/core";
import { loadManifest, type PluginManifest } from "@agentic-test-hub/plugin";

import { HttpExecutor } from "../src/executor/http.ts";
import { runScenario, runStep } from "../src/run-scenario.ts";
import { registryWith } from "./harness.ts";
import type { ExecutionContext } from "../src/executor/types.ts";

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

/** Replies with a JSON body carrying `id` to the first request, then quiet logs after. */
function sequencedFetch(): typeof fetch {
  let calls = 0;
  return (async () => {
    calls += 1;
    return calls === 1
      ? new Response(JSON.stringify({ id: "n-1" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        })
      : new Response("all quiet", { status: 200 });
  }) as typeof fetch;
}

function scenarioWith(over: Record<string, unknown>) {
  return Scenario.parse({
    id: "SC-TEST",
    title: "a test scenario",
    preconditions: [],
    steps: [
      {
        id: "S-1",
        summary: "send it",
        action: { operation: "OP-SEND", params: { channel: "email" } },
        expect: [{ kind: "http_status", status: 201, viewpoints: [] }],
        polarity: "nominal",
        dependsOn: [],
        produces: { sentId: "body.id" },
        viewpoints: [],
      },
      {
        id: "S-2",
        summary: "read it back",
        expect: [
          {
            kind: "operation_result",
            operation: "OP-READ-LOGS",
            params: {},
            assert: { kind: "contains", value: "all quiet" },
            viewpoints: [],
          },
        ],
        polarity: "nominal",
        dependsOn: ["S-1"],
        produces: {},
        viewpoints: [],
      },
    ],
    ...over,
  });
}

describe("runStep", () => {
  it("checks an operation_result expectation against its own operation, not the step's action", async () => {
    // S-2 has no action of its own; run in isolation (no S-1 before it), so
    // the very first fetch here is its operation_result's own OP-READ-LOGS
    // call, which should see quiet logs.
    const quietLogs = (async () => new Response("all quiet", { status: 200 })) as typeof fetch;
    const registry = registryWith(new HttpExecutor(quietLogs));
    const step = scenarioWith({}).steps[1]!; // S-2: no action, one operation_result expectation
    const result = await runStep(step, registry, context);
    expect(result.expectations[0]?.outcome.verdict).toBe("satisfied");
    expect(result.verdict).toBe("pass");
  });

  it("extracts a produced value via a dotted path into the action's own result", async () => {
    const registry = registryWith(new HttpExecutor(sequencedFetch()));
    const step = scenarioWith({}).steps[0]!; // S-1: produces sentId from body.id
    const result = await runStep(step, registry, context);
    expect(result.produced["sentId"]).toBe("n-1");
  });
});

describe("runScenario", () => {
  it("threads a produced value from one step into a later step's scope", async () => {
    const registry = registryWith(new HttpExecutor(sequencedFetch()));
    const result = await runScenario(scenarioWith({}), registry, context);

    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]?.verdict).toBe("pass");
    expect(result.steps[1]?.verdict).toBe("pass");
    expect(result.steps[0]?.produced["sentId"]).toBe("n-1");
    expect(result.verdict).toBe("pass");
  });

  it("skips a step whose dependency did not pass, rather than running it", async () => {
    const failingFetch = (async () => new Response("", { status: 500 })) as typeof fetch;
    const registry = registryWith(new HttpExecutor(failingFetch));
    const result = await runScenario(scenarioWith({}), registry, context);

    expect(result.steps[0]?.verdict).toBe("fail"); // expects 201, action returns 500
    expect(result.steps[1]?.skipped).toBeDefined();
    expect(result.steps[1]?.skipped?.reason).toContain("S-1");
  });

  it("is inconclusive when preconditions are not ready, without running any step", async () => {
    const manifestWithState: PluginManifest = loadManifest(`
${manifestSource}
states:
  never.ready:
    ensure: { operation: OP-READ-LOGS }
    verify:
      operation: OP-READ-LOGS
      assert: { kind: contains, value: "this text never appears" }
    cost: low
`).manifest;
    const contextWithState: ExecutionContext = {
      manifest: manifestWithState,
      scopes: {},
      root: "/plugin",
    };
    const registry = registryWith(new HttpExecutor(sequencedFetch()));
    const result = await runScenario(
      scenarioWith({ preconditions: ["never.ready"] }),
      registry,
      contextWithState,
    );

    expect(result.preparation.ready).toBe(false);
    expect(result.steps).toEqual([]);
    expect(result.verdict).toBe("inconclusive");
  });
});
