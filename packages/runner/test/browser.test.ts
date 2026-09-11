import { describe, expect, it } from "vitest";

import { DEFAULT_VERDICT_POLICY, EvidencePlan, evaluateVerdict } from "@agentic-test-hub/core";

import { lastMutation, observeBrowser, unsuppliedChannels } from "../src/evidence.ts";
import { BrowserExecutor } from "../src/executor/browser.ts";
import { ExecutorError } from "../src/executor/types.ts";
import { browserManifest, contextFor, FakeDriver, FakeSession, registryWith } from "./harness.ts";

const uiContext = () =>
  contextFor({ manifest: browserManifest, scopes: { env: { UI_URL: "https://ui.invalid" } } });

describe("BrowserExecutor", () => {
  it("carries out each declared step in order", async () => {
    const driver = new FakeDriver();
    const registry = registryWith(new BrowserExecutor(driver));
    await registry.run("OP-OPEN", {}, uiContext());
    expect(driver.session.actions).toEqual([
      "goto https://ui.invalid/",
      "waitFor [data-testid=heading]",
    ]);
  });

  it("interpolates arguments into steps", async () => {
    const driver = new FakeDriver();
    const registry = registryWith(new BrowserExecutor(driver));
    await registry.run(
      "OP-COMPOSE",
      { recipient: "a@example.invalid", channel: "sms" },
      uiContext(),
    );
    expect(driver.session.actions).toContain("fill [data-testid=recipient] a@example.invalid");
    expect(driver.session.actions).toContain("select [data-testid=channel] sms");
  });

  it("closes a session it opened", async () => {
    const driver = new FakeDriver();
    const registry = registryWith(new BrowserExecutor(driver));
    await registry.run("OP-OPEN", {}, uiContext());
    expect(driver.session.closed).toBe(true);
  });

  it("leaves a borrowed session open, since its owner may still need it", async () => {
    const session = new FakeSession();
    const driver = new FakeDriver(session);
    const registry = registryWith(new BrowserExecutor(driver, session));
    await registry.run("OP-OPEN", {}, uiContext());
    expect(session.closed).toBe(false);
    expect(driver.opens).toBe(0);
  });

  it("reuses a borrowed session across operations, rather than signing in again", async () => {
    const session = new FakeSession();
    const driver = new FakeDriver(session);
    const registry = registryWith(new BrowserExecutor(driver, session));
    await registry.run("OP-OPEN", {}, uiContext());
    await registry.run("OP-COMPOSE", { recipient: "a", channel: "email" }, uiContext());
    expect(driver.opens).toBe(0);
  });

  it("treats a step that could not be carried out as a failure, not a result", async () => {
    const session = new FakeSession();
    session.missing = ["[data-testid=heading]"];
    const registry = registryWith(new BrowserExecutor(new FakeDriver(session)));
    const result = await registry.run("OP-OPEN", {}, uiContext());
    expect(result.ok).toBe(false);
    expect(result.failure).toMatch(/no element matched/);
  });

  it("closes the session even when a step failed", async () => {
    const session = new FakeSession();
    session.missing = ["[data-testid=heading]"];
    const registry = registryWith(new BrowserExecutor(new FakeDriver(session)));
    await registry.run("OP-OPEN", {}, uiContext());
    expect(session.closed).toBe(true);
  });

  it("refuses a connection of the wrong kind", async () => {
    const registry = registryWith(new BrowserExecutor(new FakeDriver()));
    await expect(registry.run("OP-OPEN", {}, contextFor())).rejects.toThrow(ExecutorError);
  });
});

describe("observeBrowser", () => {
  it("reports console errors and uncaught exceptions", () => {
    const session = new FakeSession();
    session.console.push(
      { level: "error", text: "uncaught: x is not a function" },
      { level: "log", text: "ready" },
    );
    const [consoleObservation] = observeBrowser(session);
    expect(consoleObservation?.errors).toEqual(["error: uncaught: x is not a function"]);
  });

  it("counts warnings, since a change that adds one is worth seeing", () => {
    const session = new FakeSession();
    session.console.push({ level: "warn", text: "deprecated call" });
    const [consoleObservation] = observeBrowser(session);
    expect(consoleObservation?.errors).toHaveLength(1);
  });

  it("filters known pre-existing noise and says how much it filtered", () => {
    const session = new FakeSession();
    session.console.push(
      { level: "warn", text: "DeprecationWarning: old api" },
      { level: "error", text: "genuine failure" },
    );
    const [consoleObservation] = observeBrowser(session, { ignore: ["^DeprecationWarning"] });
    expect(consoleObservation?.errors).toEqual(["error: genuine failure"]);
    expect(consoleObservation?.suppressed).toBe(1);
  });

  it("matches a pattern against the location, where browsers name the resource", () => {
    // A browser reporting a failed subresource writes only "Failed to load
    // resource: ...", naming the resource in the location. Filtering on text
    // alone cannot tell an absent optional asset from a real fault.
    const session = new FakeSession();
    session.console.push({
      level: "error",
      text: "Failed to load resource: the server responded with a status of 404",
      location: "https://ui.invalid/legacy/optional-widget.json:0",
    });
    const [consoleObservation] = observeBrowser(session, { ignore: ["optional-widget"] });
    expect(consoleObservation?.errors).toEqual([]);
    expect(consoleObservation?.suppressed).toBe(1);
  });

  it("keeps a real fault that happens to sit alongside filtered noise", () => {
    const session = new FakeSession();
    session.console.push(
      {
        level: "error",
        text: "Failed to load resource: the server responded with a status of 404",
        location: "https://ui.invalid/legacy/optional-widget.json:0",
      },
      { level: "error", text: "uncaught: widget failed to initialise" },
    );
    const [consoleObservation] = observeBrowser(session, { ignore: ["optional-widget"] });
    expect(consoleObservation?.errors).toEqual(["error: uncaught: widget failed to initialise"]);
    expect(consoleObservation?.suppressed).toBe(1);
  });

  it("ignores a malformed pattern rather than refusing to run", () => {
    const session = new FakeSession();
    session.console.push({ level: "error", text: "boom" });
    const [consoleObservation] = observeBrowser(session, { ignore: ["(["] });
    expect(consoleObservation?.errors).toEqual(["error: boom"]);
  });

  it("takes the status from the request the action triggered", () => {
    const session = new FakeSession();
    session.network.push(
      { method: "GET", url: "https://ui.invalid/", status: 200 },
      { method: "POST", url: "https://ui.invalid/notifications", status: 201 },
      { method: "GET", url: "https://ui.invalid/favicon.ico", status: 404 },
    );
    const [, networkObservation] = observeBrowser(session);
    expect(networkObservation?.status).toBe(201);
  });

  it("lets the caller override which request matters", () => {
    const session = new FakeSession();
    session.network.push(
      { method: "GET", url: "https://ui.invalid/report", status: 200 },
      { method: "POST", url: "https://ui.invalid/telemetry", status: 500 },
    );
    const [, networkObservation] = observeBrowser(session, {
      primary: (exchange) => exchange.url.endsWith("/report"),
    });
    expect(networkObservation?.status).toBe(200);
  });

  it("reports a server error as a problem on the network channel", () => {
    const session = new FakeSession();
    session.network.push({ method: "GET", url: "https://ui.invalid/x", status: 503 });
    const [, networkObservation] = observeBrowser(session);
    expect(networkObservation?.errors).toEqual(["GET https://ui.invalid/x -> 503"]);
  });

  it("reports a request that never completed", () => {
    const session = new FakeSession();
    session.network.push({ method: "GET", url: "https://ui.invalid/x", status: 0, failed: true });
    const [, networkObservation] = observeBrowser(session);
    expect(networkObservation?.errors).toHaveLength(1);
  });

  it("does not judge the screenshot, which cannot be settled by comparison", () => {
    const sources = observeBrowser(new FakeSession()).map((observation) => observation.source);
    expect(sources).toEqual(["browser_console", "browser_network"]);
  });

  it("feeds a verdict directly, so a broken page cannot pass on appearance", () => {
    const session = new FakeSession();
    session.console.push({ level: "error", text: "uncaught: boom" });
    session.network.push({ method: "POST", url: "https://ui.invalid/x", status: 201 });
    const verdict = evaluateVerdict(DEFAULT_VERDICT_POLICY, "nominal", [
      { source: "screenshot", collected: true, matchedExpectation: true },
      ...observeBrowser(session),
      { source: "db_records", collected: true, intendedChanges: 1 },
      { source: "app_log", collected: true, errors: [] },
      { source: "db_log", collected: true, errors: [] },
    ]);
    expect(verdict.verdict).toBe("fail");
    expect(verdict.failures.map((failure) => failure.source)).toEqual(["browser_console"]);
  });
});

describe("unsuppliedChannels", () => {
  // The real defaults, rather than a hand-written copy that could drift from
  // them.
  const plan = EvidencePlan.parse({});

  it("reports session channels as unsupplied when no browser is involved", () => {
    expect(unsuppliedChannels(plan, ["app_log"], false)).toEqual([
      "screenshot",
      "browser_console",
      "browser_network",
      "db_records",
      "db_log",
    ]);
  });

  it("counts session channels as supplied once a browser is involved", () => {
    expect(unsuppliedChannels(plan, ["app_log", "db_log", "db_records"], true)).toEqual([]);
  });

  it("names exactly what a plugin is missing", () => {
    expect(unsuppliedChannels(plan, ["app_log"], true)).toEqual(["db_records", "db_log"]);
  });
});

describe("lastMutation", () => {
  it("ignores reads", () => {
    expect(lastMutation({ method: "GET", url: "u", status: 200 })).toBe(false);
    expect(lastMutation({ method: "HEAD", url: "u", status: 200 })).toBe(false);
  });

  it("selects writes", () => {
    expect(lastMutation({ method: "POST", url: "u", status: 201 })).toBe(true);
    expect(lastMutation({ method: "DELETE", url: "u", status: 204 })).toBe(true);
  });
});
