/**
 * Integration tests: the real executors, against a real running service,
 * driven entirely by a real plugin manifest.
 *
 * Nothing here is stubbed. The service is started in-process, the requests go
 * over a socket, and the shell operation runs an actual command in an actual
 * child process. What is being tested is the chain — manifest, registry,
 * executors, state preparation, assertions — rather than any one link.
 *
 * The service is fictional and the manifest is the one shipped with it, which
 * is the point: the hub is driven by configuration alone, with no knowledge of
 * what it is pointed at.
 */
import { readFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { startDemoApp, type RunningDemo } from "@agentic-test-hub/demo-app";
import { loadManifest, type PluginManifest } from "@agentic-test-hub/plugin";

import { checkAssertion } from "../src/assert.ts";
import { HttpExecutor } from "../src/executor/http.ts";
import { ExecutorRegistry } from "../src/executor/registry.ts";
import { nodeSpawn, ShellExecutor } from "../src/executor/shell.ts";
import { prepareStates } from "../src/state.ts";
import type { ExecutionContext } from "../src/executor/types.ts";

const ROOT = new URL("../../..", import.meta.url).pathname;
const TOKEN = "integration-token";

let demo: RunningDemo;
let manifest: PluginManifest;
let registry: ExecutorRegistry;
let context: ExecutionContext;

beforeEach(async () => {
  demo = await startDemoApp({ token: TOKEN });
  manifest = loadManifest(await readFile(`${ROOT}/examples/demo-app/plugin.yaml`, "utf8")).manifest;
  registry = new ExecutorRegistry()
    .register(new HttpExecutor())
    .register(new ShellExecutor(nodeSpawn));
  context = {
    manifest,
    root: ROOT,
    scopes: { env: { DEMO_URL: demo.url, DEMO_TOKEN: TOKEN } },
  };
});

afterEach(async () => {
  await demo.stop();
});

describe("the manifest shipped with the demo service", () => {
  it("loads and coheres", () => {
    expect(manifest.name).toBe("demo-service");
  });

  it("declares the environment it needs", async () => {
    const loaded = loadManifest(await readFile(`${ROOT}/examples/demo-app/plugin.yaml`, "utf8"));
    expect(loaded.requiredEnv).toEqual(["DEMO_TOKEN", "DEMO_URL"]);
  });
});

describe("http operations against a running service", () => {
  it("accepts a well-formed request", async () => {
    const result = await registry.run(
      "OP-SEND",
      { recipient: "someone@example.invalid", channel: "email" },
      context,
    );
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ notification: { channel: "email" } });
  });

  it("actually changed the service's state, not just its answer", async () => {
    await registry.run(
      "OP-SEND",
      { recipient: "someone@example.invalid", channel: "sms" },
      context,
    );
    expect(demo.state.notifications).toHaveLength(1);
    expect(demo.state.notifications[0]?.channel).toBe("sms");
  });

  it("reports a rejection as a completed operation", async () => {
    const result = await registry.run(
      "OP-SEND-UNAUTHENTICATED",
      { recipient: "someone@example.invalid", channel: "email" },
      context,
    );
    expect(result.ok).toBe(true);
    expect(result.status).toBe(401);
  });

  it("leaves nothing behind when it rejects", async () => {
    await registry.run(
      "OP-SEND-UNAUTHENTICATED",
      { recipient: "someone@example.invalid", channel: "email" },
      context,
    );
    expect(demo.state.notifications).toHaveLength(0);
  });

  it("rejects an unsupported channel with a reason a case can assert on", async () => {
    const result = await registry.run(
      "OP-SEND",
      { recipient: "someone@example.invalid", channel: "carrier-pigeon" },
      context,
    );
    expect(result.status).toBe(400);
    expect(checkAssertion({ kind: "contains", value: "carrier-pigeon" }, result).verdict).toBe(
      "satisfied",
    );
  });

  it("collects the service's own log as evidence", async () => {
    await registry.run("OP-SEND-UNAUTHENTICATED", { recipient: "x", channel: "email" }, context);
    const collector = manifest.evidence["app_log"];
    expect(collector).toBeDefined();
    const result = await registry.run(collector!.operation, collector!.params, context);
    expect(
      checkAssertion({ kind: "contains", value: "no usable credentials" }, result).verdict,
    ).toBe("satisfied");
  });
});

describe("shell operations in a real child process", () => {
  it("runs the command and reads its output", async () => {
    const result = await registry.run("OP-COUNT", {}, context);
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout?.trim()).toBe("0");
  });

  it("sees state a previous http operation created", async () => {
    await registry.run("OP-SEND", { recipient: "a@example.invalid", channel: "push" }, context);
    const result = await registry.run("OP-COUNT", {}, context);
    expect(result.stdout?.trim()).toBe("1");
  });

  it("satisfies a count assertion written as a number against text output", async () => {
    const result = await registry.run("OP-COUNT", {}, context);
    expect(checkAssertion({ kind: "equals", value: 0 }, result).verdict).toBe("satisfied");
  });
});

describe("state preparation against a running service", () => {
  it("skips setup when the state already holds", async () => {
    const report = await prepareStates(["queue.empty"], registry, context);
    expect(report.ready).toBe(true);
    expect(report.outcomes[0]).toMatchObject({
      state: "queue.empty",
      status: "already_satisfied",
      ensured: false,
    });
  });

  it("runs setup and confirms it when the state does not hold", async () => {
    await registry.run("OP-SEND", { recipient: "a@example.invalid", channel: "email" }, context);
    const report = await prepareStates(["queue.empty"], registry, context);
    expect(report.outcomes[0]).toMatchObject({ status: "established", ensured: true });
    expect(demo.state.notifications).toHaveLength(0);
  });

  it("prepares several states, cheapest first", async () => {
    const report = await prepareStates(["service.reachable", "queue.empty"], registry, context);
    expect(report.ready).toBe(true);
    expect(report.outcomes).toHaveLength(2);
  });

  it("reports an unreachable state rather than letting the case run", async () => {
    await demo.stop();
    const report = await prepareStates(["service.reachable"], registry, context);
    expect(report.ready).toBe(false);
    expect(report.outcomes[0]?.status).toBe("unsatisfied");
  });
});
