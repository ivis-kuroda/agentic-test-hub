import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { Baseline, Scenario, TestCase } from "@agentic-test-hub/core";
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

  OP-UPLOAD:
    executor: http
    connection: api
    method: POST
    path: /files
    params: [title]
    optionalParams: [token]
    headers:
      Authorization: "Bearer {{param.token}}"
    multipart:
      - { name: file, file: fixtures/a.txt, filename: "" }
      - { name: title, value: "{{param.title}}" }

  OP-DELETE:
    executor: http
    connection: api
    method: DELETE
    path: "/files/{{step.recid}}"

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

  describe("generated output using the extended features", () => {
    const uploadBaseline = Baseline.parse({
      id: "BL-UPLOAD",
      title: "upload",
      preconditions: [],
      config: {},
      context: {},
      action: { operation: "OP-UPLOAD", params: { title: "t", token: "s" } },
    });
    const uploadCase = TestCase.parse({
      id: "TC-UPLOAD",
      summary: "uploads without a token",
      baseline: "BL-UPLOAD",
      overrides: [{ path: "action.params.token", op: "remove" }],
      expect: [
        { kind: "http_status", status: 401, alsoAccepts: [403], viewpoints: [] },
        { kind: "result", assert: { kind: "keys", at: "body", value: ["error"] }, viewpoints: [] },
        {
          kind: "result",
          assert: { kind: "compare", at: "durationMs", op: "lt", value: 5000 },
          viewpoints: [],
        },
      ],
      polarity: "error",
      priority: "P2",
      viewpoints: [],
    });
    const uploadScenario = Scenario.parse({
      id: "SC-UPLOAD",
      title: "upload, read the location, clean up",
      steps: [
        {
          id: "S-1",
          summary: "upload",
          action: { operation: "OP-UPLOAD", params: { title: "t", token: "s" } },
          expect: [{ kind: "http_status", status: 201 }],
          produces: { recid: { from: "headers.location", pattern: "/files/(\\d+)$" } },
        },
      ],
      cleanup: [{ id: "S-DEL", summary: "delete", action: { operation: "OP-DELETE" } }],
    });
    const suite = {
      viewpoints: [],
      factors: [],
      matrices: [],
      baselines: [uploadBaseline],
      cases: [uploadCase],
      scenarios: [uploadScenario],
    };
    const target = (id: string) => ({
      manifestPath: "/plugin/plugin.yaml",
      pluginRoot: "/plugin",
      outPath: `/plugin/generated/${id}.py`,
    });

    function render(id: string): string {
      const outcome = planGeneration(suite, manifest, id, "python");
      if (!outcome.ok) throw new Error(outcome.refusal.reason);
      return renderSpecFilePy(outcome.plan, manifest, target(id));
    }

    /** Names the generated file imports from the runtime package. */
    function importedNames(source: string): string[] {
      const block = /from agentic_test_hub_runner import \(([^)]*)\)/s.exec(source);
      if (block?.[1] === undefined) throw new Error("no runtime import block");
      return block[1]
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);
    }

    const runtimeExports = (() => {
      const init = readFileSync(
        new URL(
          "../../../python/agentic-test-hub-runner/src/agentic_test_hub_runner/__init__.py",
          import.meta.url,
        ),
        "utf8",
      );
      const all = /__all__ = \[([^\]]*)\]/s.exec(init)?.[1] ?? "";
      return new Set([...all.matchAll(/"([^"]+)"/g)].map((match) => match[1]));
    })();

    it.each(["TC-UPLOAD", "SC-UPLOAD"])(
      "%s imports only names the Python runtime package exports",
      (id) => {
        const rendered = render(id);
        const names = importedNames(rendered);
        expect(names).toContain("HttpExecutor");
        expect(names.filter((name) => !runtimeExports.has(name))).toEqual([]);
      },
    );

    it("inlines the derived params (optional token removed) and the new expectation fields", () => {
      const rendered = render("TC-UPLOAD");
      expect(rendered).toContain("ACTION_PARAMS = json.loads(");
      expect(rendered).not.toContain('\\"token\\"');
      expect(rendered).toContain("alsoAccepts");
      expect(rendered).toContain('\\"kind\\": \\"keys\\"');
    });

    it("inlines a scenario's cleanup and pattern produces", () => {
      const rendered = render("SC-UPLOAD");
      expect(rendered).toContain("S-DEL");
      expect(rendered).toContain("headers.location");
      expect(rendered).toContain("run_scenario(SCENARIO, registry, context)");
    });

    const python = spawnSync("python3", ["--version"]);
    it.skipIf(python.error !== undefined)("renders syntactically valid Python", () => {
      for (const id of ["TC-UPLOAD", "SC-UPLOAD"]) {
        const checked = spawnSync(
          "python3",
          ["-c", "import ast, sys; ast.parse(sys.stdin.read())"],
          {
            input: render(id),
            encoding: "utf8",
          },
        );
        expect(checked.stderr).toBe("");
        expect(checked.status).toBe(0);
      }
    });
  });
});
