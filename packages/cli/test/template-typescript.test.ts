import { describe, expect, it } from "vitest";

import { Baseline, Scenario, TestCase } from "@agentic-test-hub/core";
import { loadManifest, type PluginManifest } from "@agentic-test-hub/plugin";

import { planGeneration } from "../src/plan.ts";
import { renderSpecFileTs } from "../src/template-typescript.ts";

const manifestSource = `
apiVersion: "1"
name: dispatch-service

connections:
  api:
    kind: http
    baseUrl: "https://api.invalid/v1"
  ui:
    kind: browser
    baseUrl: "{{env.APP_URL}}"

operations:
  OP-SEND:
    executor: http
    connection: api
    method: POST
    path: /notifications
    params: [channel]
    body:
      channel: "{{param.channel}}"

  OP-OPEN:
    executor: browser
    connection: ui
    steps:
      - { action: goto, url: "{{env.APP_URL}}/" }
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

const testCase = TestCase.parse({
  id: "TC-DISPATCH-002",
  summary: "sends over sms",
  baseline: "BL-TEST",
  overrides: [{ path: "context.body.channel", op: "set", value: "sms" }],
  expect: [{ kind: "http_status", status: 201, viewpoints: [] }],
  polarity: "nominal",
  priority: "P2",
  viewpoints: [],
});

const suite = {
  viewpoints: [],
  factors: [],
  matrices: [],
  baselines: [baseline],
  cases: [testCase],
  scenarios: [],
};

describe("renderSpecFileTs", () => {
  it("renders a self-contained Playwright test that loads the manifest and calls runCase", () => {
    const outcome = planGeneration(suite, manifest, "TC-DISPATCH-002", "typescript");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const rendered = renderSpecFileTs(outcome.plan, manifest, {
      manifestPath: "/plugin/plugin.yaml",
      pluginRoot: "/plugin",
      outPath: "/plugin/generated/TC-DISPATCH-002.spec.ts",
    });

    expect(rendered).toContain('import { expect, test } from "@playwright/test";');
    expect(rendered).toContain("HttpExecutor");
    expect(rendered).not.toContain("ShellExecutor");
    expect(rendered).not.toContain("BrowserExecutor");
    expect(rendered).toContain('new URL("../plugin.yaml", import.meta.url)');
    expect(rendered).toContain('"sms"');
    expect(rendered).toContain("TC-DISPATCH-002: sends over sms");
    expect(rendered).toContain("runCase(testCase, baseline, registry, context)");
    expect(rendered).toContain('.toBe("pass")');
  });

  it("only imports the executors a scenario's steps actually touch", () => {
    const scenarioSuite = {
      ...suite,
      cases: [],
      scenarios: [
        Scenario.parse({
          id: "SC-DISPATCH",
          title: "send then check",
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
        }),
      ],
    };
    const outcome = planGeneration(scenarioSuite, manifest, "SC-DISPATCH", "typescript");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const rendered = renderSpecFileTs(outcome.plan, manifest, {
      manifestPath: "/plugin/plugin.yaml",
      pluginRoot: "/plugin",
      outPath: "/plugin/generated/SC-DISPATCH.spec.ts",
    });

    expect(rendered).toContain("runScenario(scenario, registry, context)");
    expect(rendered).toContain("HttpExecutor");
    expect(rendered).not.toContain("BrowserExecutor");
  });

  it("imports PlaywrightDriver alongside BrowserExecutor when a case needs a browser", () => {
    const browserBaseline = Baseline.parse({
      id: "BL-BROWSE",
      title: "opening the app",
      preconditions: [],
      config: {},
      context: {},
      action: { operation: "OP-OPEN", params: {} },
    });
    const browserCase = TestCase.parse({
      id: "TC-BROWSE",
      summary: "opens the app",
      baseline: "BL-BROWSE",
      overrides: [],
      expect: [{ kind: "text", value: "Welcome", viewpoints: [] }],
      polarity: "nominal",
      priority: "P2",
      viewpoints: [],
    });
    const outcome = planGeneration(
      { ...suite, baselines: [baseline, browserBaseline], cases: [browserCase] },
      manifest,
      "TC-BROWSE",
      "typescript",
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const rendered = renderSpecFileTs(outcome.plan, manifest, {
      manifestPath: "/plugin/plugin.yaml",
      pluginRoot: "/plugin",
      outPath: "/plugin/generated/TC-BROWSE.spec.ts",
    });

    // A generated file that registers `new BrowserExecutor(new
    // PlaywrightDriver())` without importing PlaywrightDriver fails at
    // module load with a ReferenceError — the Python counterpart to this
    // template had exactly that gap (caught by actually running the
    // generated file, not by a check that "BrowserExecutor" appears
    // somewhere), so this asserts the import list itself, not just usage.
    expect(rendered).toMatch(
      /import \{[^}]*PlaywrightDriver[^}]*\} from "@agentic-test-hub\/runner"/,
    );
    expect(rendered).toContain("new BrowserExecutor(new PlaywrightDriver())");
  });
});
