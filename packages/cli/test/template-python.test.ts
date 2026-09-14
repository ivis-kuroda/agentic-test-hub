import { describe, expect, it } from "vitest";

import { Baseline, TestCase } from "@agentic-test-hub/core";
import { loadManifest, type PluginManifest } from "@agentic-test-hub/plugin";

import { planGeneration } from "../src/plan.ts";
import { renderSpecFilePy } from "../src/template-python.ts";

const manifestSource = `
apiVersion: "1"
name: dispatch-service
extensionModule: "plugin.extensions"

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

  OP-SEED-INDEX:
    executor: extension
    handler: seed_search_index

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

function suiteWithCase(testCase: TestCase) {
  return {
    viewpoints: [],
    factors: [],
    matrices: [],
    baselines: [baseline],
    cases: [testCase],
    scenarios: [],
  };
}

describe("renderSpecFilePy", () => {
  it("renders a pytest test that loads the manifest and calls run_case", () => {
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
    const outcome = planGeneration(suiteWithCase(testCase), manifest, "TC-DISPATCH-002", "python");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const rendered = renderSpecFilePy(outcome.plan, manifest, {
      manifestPath: "/plugin/plugin.yaml",
      pluginRoot: "/plugin",
      outPath: "/plugin/generated/TC-DISPATCH-002.test.py",
    });

    expect(rendered).toContain("from agentic_test_hub_runner import (");
    expect(rendered).toContain("HttpExecutor");
    expect(rendered).not.toContain("ExtensionExecutor");
    expect(rendered).toContain('MANIFEST_PATH = Path(__file__).parent / "../plugin.yaml"');
    expect(rendered).toContain("def test_tc_dispatch_002() -> None:");
    expect(rendered).toContain("run_case(TEST_CASE, RESOLVED, ACTION_PARAMS, registry, context)");
    expect(rendered).toContain('assert result.verdict == "pass", result');
    // json.loads over a JSON-escaped literal, not raw Python data syntax:
    expect(rendered).toContain("RESOLVED = json.loads(");
    expect(rendered).toContain('\\"sms\\"');
  });

  it("imports the extension module and registers ExtensionExecutor when a case needs it", () => {
    const testCase = TestCase.parse({
      id: "TC-EXT",
      summary: "reindexes",
      baseline: "BL-TEST",
      overrides: [],
      expect: [
        {
          kind: "operation_result",
          operation: "OP-SEED-INDEX",
          params: {},
          assert: { kind: "contains", value: "ok" },
          viewpoints: [],
        },
      ],
      polarity: "nominal",
      priority: "P2",
      viewpoints: [],
    });
    const outcome = planGeneration(suiteWithCase(testCase), manifest, "TC-EXT", "python");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const rendered = renderSpecFilePy(
      outcome.plan,
      manifest,
      {
        manifestPath: "/plugin/plugin.yaml",
        pluginRoot: "/plugin",
        outPath: "/plugin/generated/TC-EXT.test.py",
      },
      "plugin.extensions",
    );

    expect(rendered).toContain("import plugin.extensions as EXTENSIONS_MODULE");
    expect(rendered).toContain("ExtensionExecutor(EXTENSIONS_MODULE)");
  });

  it("imports PlaywrightDriver alongside BrowserExecutor when a case needs a browser", () => {
    const testCase = TestCase.parse({
      id: "TC-BROWSE",
      summary: "opens the app",
      baseline: "BL-TEST",
      overrides: [],
      expect: [{ kind: "text", value: "Welcome", viewpoints: [] }],
      polarity: "nominal",
      priority: "P2",
      viewpoints: [],
    });
    const browserBaseline = Baseline.parse({
      id: "BL-BROWSE",
      title: "opening the app",
      preconditions: [],
      config: {},
      context: {},
      action: { operation: "OP-OPEN", params: {} },
    });
    const outcome = planGeneration(
      {
        viewpoints: [],
        factors: [],
        matrices: [],
        baselines: [browserBaseline],
        cases: [{ ...testCase, baseline: "BL-BROWSE" }],
        scenarios: [],
      },
      manifest,
      "TC-BROWSE",
      "python",
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const rendered = renderSpecFilePy(outcome.plan, manifest, {
      manifestPath: "/plugin/plugin.yaml",
      pluginRoot: "/plugin",
      outPath: "/plugin/generated/TC-BROWSE.test.py",
    });

    // A generated file that registers BrowserExecutor(PlaywrightDriver())
    // without importing PlaywrightDriver fails at collection time with
    // NameError — caught only by actually running the file with pytest,
    // not by a check that the string "BrowserExecutor" appears somewhere.
    expect(rendered).toContain("BrowserExecutor");
    expect(rendered).toContain("PlaywrightDriver");
    expect(rendered).toMatch(/from agentic_test_hub_runner import \([^)]*PlaywrightDriver/s);
    expect(rendered).toContain("BrowserExecutor(PlaywrightDriver())");
  });

  it("throws when a plan needs an extension module and none was given", () => {
    const testCase = TestCase.parse({
      id: "TC-EXT",
      summary: "reindexes",
      baseline: "BL-TEST",
      overrides: [],
      expect: [
        {
          kind: "operation_result",
          operation: "OP-SEED-INDEX",
          params: {},
          assert: { kind: "contains", value: "ok" },
          viewpoints: [],
        },
      ],
      polarity: "nominal",
      priority: "P2",
      viewpoints: [],
    });
    const outcome = planGeneration(suiteWithCase(testCase), manifest, "TC-EXT", "python");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    // The manifest itself declares extensionModule, but renderSpecFilePy's
    // own caller (main.ts) is the one that falls back to it — the render
    // function always needs it passed explicitly, so omitting it here (no
    // 4th argument) must still refuse to render rather than emit a test
    // that imports nothing for `EXTENSIONS_MODULE`.
    expect(() =>
      renderSpecFilePy(outcome.plan, manifest, {
        manifestPath: "/plugin/plugin.yaml",
        pluginRoot: "/plugin",
        outPath: "/plugin/generated/TC-EXT.test.py",
      }),
    ).toThrow(/extensionsModule/);
  });
});
