/**
 * The hub's browser stack, end to end: a real browser, a real application,
 * and a real plugin manifest.
 *
 * Nothing here reaches into the application directly. Everything the hub does
 * to it goes through `examples/demo-app/plugin.yaml`, which is what makes
 * these tests evidence that the hub needs no built-in knowledge of whatever
 * it is pointed at.
 */
import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { DEFAULT_VERDICT_POLICY, evaluateVerdict } from "@agentic-test-hub/core";
import { startDemoApp, type RunningDemo } from "@agentic-test-hub/demo-app";
import { loadManifest, type PluginManifest } from "@agentic-test-hub/plugin";
import {
  BrowserExecutor,
  ExecutorRegistry,
  HttpExecutor,
  observeBrowser,
  PlaywrightDriver,
  type BrowserSession,
  type ExecutionContext,
} from "@agentic-test-hub/runner";

const ROOT = new URL("..", import.meta.url).pathname;
const TOKEN = "e2e-token";

let demo: RunningDemo;
let manifest: PluginManifest;
let driver: PlaywrightDriver;

test.beforeEach(async () => {
  demo = await startDemoApp({ token: TOKEN });
  manifest = loadManifest(await readFile(`${ROOT}/examples/demo-app/plugin.yaml`, "utf8")).manifest;
  // A preinstalled browser may not match the version this Playwright expects.
  // Where the environment provides one, it is used as-is; in CI the browser is
  // installed to match and the variable is unset.
  const executablePath = process.env["HUB_BROWSER_EXECUTABLE"];
  driver = new PlaywrightDriver(executablePath === undefined ? {} : { executablePath });
});

test.afterEach(async () => {
  await demo.stop();
});

function contextFor(): ExecutionContext {
  return {
    manifest,
    root: ROOT,
    scopes: { env: { DEMO_URL: demo.url, DEMO_TOKEN: TOKEN } },
  };
}

test("drives the application through operations declared in the manifest", async () => {
  const registry = new ExecutorRegistry().register(new BrowserExecutor(driver));
  const result = await registry.run("OP-OPEN-DASHBOARD", {}, contextFor());

  expect(result.ok).toBe(true);
  expect(result.stdout).toContain("Dispatch");
});

test("a form submission reaches the service and changes its state", async () => {
  const registry = new ExecutorRegistry().register(new BrowserExecutor(driver));
  const result = await registry.run(
    "OP-COMPOSE",
    { recipient: "someone@example.invalid", channel: "sms" },
    contextFor(),
  );

  expect(result.ok).toBe(true);
  expect(demo.state.notifications).toHaveLength(1);
  expect(demo.state.notifications[0]).toMatchObject({
    recipient: "someone@example.invalid",
    channel: "sms",
  });
});

test("a session is reused across operations rather than signed into twice", async () => {
  const session: BrowserSession = await driver.open(demo.url);
  try {
    const registry = new ExecutorRegistry().register(new BrowserExecutor(driver, session));
    await registry.run("OP-OPEN-DASHBOARD", {}, contextFor());
    await registry.run(
      "OP-COMPOSE",
      { recipient: "a@example.invalid", channel: "push" },
      contextFor(),
    );
    expect(demo.state.notifications).toHaveLength(1);
    // The console accumulated across both operations, which only happens if
    // the same page was used for each.
    expect(session.networkExchanges().length).toBeGreaterThan(1);
  } finally {
    await session.close();
  }
});

test("collects the channels that exist only while a page is open", async () => {
  const session = await driver.open(demo.url);
  try {
    const registry = new ExecutorRegistry().register(new BrowserExecutor(driver, session));
    await registry.run(
      "OP-COMPOSE",
      { recipient: "a@example.invalid", channel: "email" },
      contextFor(),
    );

    const observations = observeBrowser(session);
    const network = observations.find((observation) => observation.source === "browser_network");

    expect(observations.map((observation) => observation.source)).toEqual([
      "browser_console",
      "browser_network",
    ]);
    expect(network?.status).toBeGreaterThanOrEqual(200);
    expect(network?.errors).toEqual([]);
  } finally {
    await session.close();
  }
});

test("a page that looks correct but is broken does not pass", async () => {
  const session = await driver.open(demo.url);
  try {
    await session.goto(`${demo.url}/?broken=1`);
    await session.waitFor("[data-testid=heading]", 5000);

    // Everything a screenshot could show is correct: the heading, the form
    // and the list are all present and right.
    expect(await session.textOf("[data-testid=heading]")).toBe("Dispatch");
    const image = await session.screenshot();
    await test
      .info()
      .attach("dashboard.png", { body: Buffer.from(image), contentType: "image/png" });

    // Wait for the page's own failures to surface.
    await new Promise((settle) => setTimeout(settle, 500));

    const verdict = evaluateVerdict(DEFAULT_VERDICT_POLICY, "nominal", [
      // A judge looking only at the image would report exactly this.
      { source: "screenshot", collected: true, matchedExpectation: true },
      ...observeBrowser(session),
      { source: "db_records", collected: true, intendedChanges: 1, residualChanges: 0 },
      { source: "app_log", collected: true, errors: [] },
      { source: "db_log", collected: true, errors: [] },
    ]);

    expect(verdict.verdict).toBe("fail");
    expect(verdict.failures.map((failure) => failure.source)).toContain("browser_console");
  } finally {
    await session.close();
  }
});

test("the same page without the fault does pass", async () => {
  const session = await driver.open(demo.url);
  try {
    await session.goto(`${demo.url}/`);
    await session.waitFor("[data-testid=heading]", 5000);
    await new Promise((settle) => setTimeout(settle, 500));

    const verdict = evaluateVerdict(DEFAULT_VERDICT_POLICY, "nominal", [
      { source: "screenshot", collected: true, matchedExpectation: true },
      ...observeBrowser(session).map((observation) =>
        // Opening a page makes no write, so there is no mutation for the
        // network channel to report a status from.
        observation.source === "browser_network" ? { ...observation, status: 200 } : observation,
      ),
      { source: "db_records", collected: true, intendedChanges: 1, residualChanges: 0 },
      { source: "app_log", collected: true, errors: [] },
      { source: "db_log", collected: true, errors: [] },
    ]);

    // Asserted on the failures rather than the verdict, so a regression
    // names the channel that objected instead of only saying "fail".
    expect(verdict.failures).toEqual([]);
    expect(verdict.verdict).toBe("pass");
  } finally {
    await session.close();
  }
});

test("a rejected request is reported as a completed operation", async () => {
  const registry = new ExecutorRegistry().register(new HttpExecutor());
  const result = await registry.run(
    "OP-SEND-UNAUTHENTICATED",
    { recipient: "a@example.invalid", channel: "email" },
    contextFor(),
  );

  expect(result.ok).toBe(true);
  expect(result.status).toBe(401);
  expect(demo.state.notifications).toHaveLength(0);
});

test("known console noise can be filtered without hiding a real failure", async () => {
  const session = await driver.open(demo.url);
  try {
    // This page asks for something absent and also throws. The browser
    // reports both on the console, and only one of them is this change's
    // fault.
    await session.goto(`${demo.url}/?broken=1`);
    await session.waitFor("[data-testid=heading]", 5000);
    await new Promise((settle) => setTimeout(settle, 500));

    const unfiltered = observeBrowser(session).find(
      (observation) => observation.source === "browser_console",
    );
    const filtered = observeBrowser(session, { ignore: ["does-not-exist"] }).find(
      (observation) => observation.source === "browser_console",
    );

    expect(unfiltered?.errors ?? []).not.toHaveLength((filtered?.errors ?? []).length);
    expect(filtered?.suppressed).toBeGreaterThan(0);
    // The uncaught exception survives the filter, which is the whole point:
    // an allowance for known noise must not become an allowance for defects.
    expect((filtered?.errors ?? []).join("\n")).toContain("failed to initialise");
  } finally {
    await session.close();
  }
});

test("a page that is only noisy passes once the noise is declared", async () => {
  const session = await driver.open(demo.url);
  try {
    await session.goto(`${demo.url}/?noisy=1`);
    await session.waitFor("[data-testid=heading]", 5000);
    await new Promise((settle) => setTimeout(settle, 500));

    const noisy = observeBrowser(session).find(
      (observation) => observation.source === "browser_console",
    );
    expect((noisy?.errors ?? []).length).toBeGreaterThan(0);

    const declared = observeBrowser(session, { ignore: ["optional-widget"] });
    const verdict = evaluateVerdict(DEFAULT_VERDICT_POLICY, "nominal", [
      { source: "screenshot", collected: true, matchedExpectation: true },
      ...declared.map((observation) =>
        observation.source === "browser_network" ? { ...observation, status: 200 } : observation,
      ),
      { source: "db_records", collected: true, intendedChanges: 1, residualChanges: 0 },
      { source: "app_log", collected: true, errors: [] },
      { source: "db_log", collected: true, errors: [] },
    ]);

    expect(verdict.failures).toEqual([]);
    expect(verdict.verdict).toBe("pass");
  } finally {
    await session.close();
  }
});
