import { describe, expect, it } from "vitest";

import { Scenario, TestCase } from "@agentic-test-hub/core";
import { loadManifest } from "@agentic-test-hub/plugin";

import { HttpExecutor } from "../src/executor/http.ts";
import { ExecutorError } from "../src/executor/types.ts";
import { runCase } from "../src/run-case.ts";
import { runScenario } from "../src/run-scenario.ts";
import { withRunScope } from "../src/run-scope.ts";
import { registryWith } from "./harness.ts";
import type { ExecutionContext } from "../src/executor/types.ts";

const { manifest } = loadManifest(`
apiVersion: "1"
name: items
connections:
  api: { kind: http, baseUrl: "https://api.invalid" }
operations:
  OP-CREATE: { executor: http, connection: api, method: POST, path: /items }
  OP-DELETE: { executor: http, connection: api, method: DELETE, path: "/items/{{step.itemId}}" }
  OP-PURGE: { executor: http, connection: api, method: POST, path: /purge }
  OP-LOGS:
    executor: http
    connection: api
    path: "/logs?since={{param.since}}"
    params: [since]
evidence:
  app_log:
    operation: OP-LOGS
    params: { since: "{{run.startedAt}}" }
policy:
  id: p
  title: log only
  rules:
    nominal: { screenshot: informational, browser_console: informational, browser_network: informational, db_records: informational, app_log: clean, db_log: informational }
    error: { screenshot: informational, browser_console: informational, browser_network: informational, db_records: informational, app_log: clean, db_log: informational }
`);
const context: ExecutionContext = { manifest, scopes: {}, root: "/plugin" };

/** Records "METHOD url" per request and answers by `answers` (default 200 "all quiet"). */
function client(answers: Record<string, () => Response> = {}) {
  const calls: string[] = [];
  const fetchFn = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    const key = `${init.method ?? "GET"} ${href.replace("https://api.invalid", "").split("?")[0]}`;
    calls.push(`${init.method ?? "GET"} ${href}`);
    const answer = answers[key];
    if (answer !== undefined) return answer();
    if (key === "POST /items") return new Response(JSON.stringify({ id: 7 }), { status: 201 });
    return new Response("all quiet", { status: 200 });
  }) as typeof fetch;
  return { fetchFn, calls };
}

const scenario = (over: Record<string, unknown> = {}) =>
  Scenario.parse({
    id: "SC-CLEAN",
    title: "create then clean up",
    steps: [
      {
        id: "S-1",
        summary: "create",
        action: { operation: "OP-CREATE", params: {} },
        expect: [{ kind: "http_status", status: 201 }],
        produces: { itemId: "body.id" },
      },
    ],
    cleanup: [{ id: "S-CLEAN", summary: "delete it", action: { operation: "OP-DELETE" } }],
    evidence: { sources: ["app_log"], timing: "after" },
    ...over,
  });

describe("scenario cleanup", () => {
  it("accepts a cleanup step with no expectations, though a step still needs one", () => {
    expect(scenario().cleanup).toHaveLength(1);
    expect(() =>
      Scenario.parse({
        id: "SC-X",
        title: "x",
        steps: [{ id: "S-1", summary: "s", expect: [] }],
      }),
    ).toThrow();
  });

  it("runs after evidence collection and sees produced values", async () => {
    const { fetchFn, calls } = client();
    const result = await runScenario(scenario(), registryWith(new HttpExecutor(fetchFn)), context);
    expect(calls.map((call) => call.split(" ")[0])).toEqual(["POST", "GET", "DELETE"]);
    expect(calls.at(-1)).toBe("DELETE https://api.invalid/items/7");
    expect(result.cleanup.map((step) => step.stepId)).toEqual(["S-CLEAN"]);
    expect(result.verdict).toBe("pass");
  });

  it("runs when a step failed, and the verdict stays fail", async () => {
    const { fetchFn, calls } = client({
      "POST /items": () => new Response("boom", { status: 500 }),
    });
    const result = await runScenario(
      scenario({
        cleanup: [{ id: "S-PURGE", summary: "purge", action: { operation: "OP-PURGE" } }],
      }),
      registryWith(new HttpExecutor(fetchFn)),
      context,
    );
    expect(calls).toContain("POST https://api.invalid/purge");
    expect(result.verdict).toBe("fail");
  });

  it("runs when a step throws, then lets the error propagate", async () => {
    const { fetchFn, calls } = client();
    const throwing = scenario({
      steps: [
        {
          id: "S-1",
          summary: "x",
          action: { operation: "OP-NOPE" },
          expect: [{ kind: "http_status", status: 200 }],
        },
      ],
      cleanup: [{ id: "S-PURGE", summary: "purge", action: { operation: "OP-PURGE" } }],
    });
    await expect(
      runScenario(throwing, registryWith(new HttpExecutor(fetchFn)), context),
    ).rejects.toThrow(ExecutorError);
    expect(calls).toContain("POST https://api.invalid/purge");
  });

  it("downgrades to inconclusive, never fail, when a cleanup expectation is violated", async () => {
    const { fetchFn } = client();
    const withExpectation = scenario();
    const cleanup = withExpectation.cleanup[0]!;
    const result = await runScenario(
      {
        ...withExpectation,
        cleanup: [{ ...cleanup, expect: [{ kind: "http_status", status: 204, viewpoints: [] }] }],
      },
      registryWith(new HttpExecutor(fetchFn)),
      context,
    );
    expect(result.cleanup[0]?.verdict).toBe("fail");
    expect(result.verdict).toBe("inconclusive");
  });

  it("downgrades to inconclusive when a cleanup request does not complete", async () => {
    const { fetchFn } = client({
      "DELETE /items/7": () => {
        throw new Error("connection refused");
      },
    });
    const result = await runScenario(scenario(), registryWith(new HttpExecutor(fetchFn)), context);
    expect(result.cleanup[0]?.action?.ok).toBe(false);
    expect(result.verdict).toBe("inconclusive");
  });

  it("records a cleanup step that throws and still runs the next one", async () => {
    const { fetchFn } = client();
    const result = await runScenario(
      scenario({
        cleanup: [
          { id: "S-BAD", summary: "no such op", action: { operation: "OP-NOPE" } },
          { id: "S-PURGE", summary: "purge", action: { operation: "OP-PURGE" } },
        ],
      }),
      registryWith(new HttpExecutor(fetchFn)),
      context,
    );
    expect(result.cleanup[0]?.error).toContain("OP-NOPE");
    expect(result.cleanup[1]?.verdict).toBe("pass");
    expect(result.verdict).toBe("inconclusive");
  });
});

describe("the run scope", () => {
  it("adds startedAt (UTC, seconds) and a short id unless the caller gave one", () => {
    const run = withRunScope(context).scopes.run as { startedAt: string; id: string };
    expect(run.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(run.id).toHaveLength(8);
    const given = { ...context, scopes: { run: { startedAt: "x", id: "y" } } };
    expect(withRunScope(given)).toBe(given);
  });

  it("renders evidence collector params with it, for scenarios and cases", async () => {
    const scenarioClient = client();
    await runScenario(
      scenario({ cleanup: [] }),
      registryWith(new HttpExecutor(scenarioClient.fetchFn)),
      context,
    );
    expect(scenarioClient.calls.find((call) => call.includes("/logs"))).toMatch(
      /since=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
    );

    const caseClient = client();
    await runCase(
      TestCase.parse({
        id: "TC-RUN",
        summary: "x",
        baseline: "BL-X",
        expect: [{ kind: "http_status", status: 201 }],
        polarity: "nominal",
        priority: "P2",
        evidence: { sources: ["app_log"], timing: "after" },
      }),
      {
        id: "BL-X",
        title: "x",
        preconditions: [],
        config: {},
        context: {},
        action: { operation: "OP-CREATE", params: {} },
        viewpoints: [],
      } as never,
      registryWith(new HttpExecutor(caseClient.fetchFn)),
      context,
    );
    expect(caseClient.calls.some((call) => /since=\d{4}-/.test(call))).toBe(true);
  });
});
