import { relative } from "node:path";

import type { PluginManifest } from "@agentic-test-hub/plugin";

import { executorKindsFor, type GenerationPlan } from "./plan.ts";
import type { RenderTarget } from "./template-typescript.ts";

const EXECUTOR_IMPORTS: Readonly<Record<string, string>> = {
  http: "HttpExecutor",
  shell: "ShellExecutor",
  browser: "BrowserExecutor",
  extension: "ExtensionExecutor",
};

/** A relative path from the generated file to `to`, POSIX-style. */
function relativeImportPath(target: RenderTarget, to: string): string {
  const rel = relative(
    target.outPath.slice(0, Math.max(0, target.outPath.lastIndexOf("/"))) || ".",
    to,
  )
    .split("\\")
    .join("/");
  return rel;
}

function registrations(kinds: readonly string[]): string {
  const lines: string[] = [];
  if (kinds.includes("http")) lines.push("    registry.register(HttpExecutor())");
  if (kinds.includes("shell")) lines.push("    registry.register(ShellExecutor())");
  if (kinds.includes("browser")) {
    lines.push("    registry.register(BrowserExecutor(PlaywrightDriver()))");
  }
  if (kinds.includes("extension")) {
    lines.push("    registry.register(ExtensionExecutor(EXTENSIONS_MODULE))");
  }
  return lines.join("\n");
}

/**
 * A valid, readable Python identifier for a case/scenario id like
 * `TC-DISPATCH-002` — `test_tc_dispatch_002`.
 *
 * Used for both the generated test function's name and (by
 * {@link pythonModuleName}) the file it lives in: pytest imports a test file
 * as a module named after its own filename stem, and a stem containing a
 * hyphen (`TC-DISPATCH-002.py`) is not a valid module name and fails to
 * import at all — caught by actually running a generated file with pytest,
 * not by the unit tests alone.
 */
export function testFunctionName(id: string): string {
  const slug = id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `test_${slug}`;
}

/** A valid Python module filename stem for a case/scenario id, e.g. `test_tc_dispatch_002`. */
export function pythonModuleName(id: string): string {
  return testFunctionName(id);
}

/**
 * A JSON value rendered as a Python literal via `json.loads(<string literal>)`.
 *
 * JSON's string-escaping rules (`\"`, `\\`, `\n`, `\uXXXX`, ...) are a subset
 * of Python's, so `JSON.stringify` of the JSON text is *also* a valid Python
 * double-quoted string literal — no separate Python-escaping pass, and no
 * risk of the data containing a delimiter (like `'''`) that breaks a
 * triple-quoted string.
 */
function pythonJsonLiteral(value: unknown): string {
  const jsonText = JSON.stringify(value, null, 2);
  return `json.loads(${JSON.stringify(jsonText)})`;
}

/**
 * Renders a generated pytest test (Python, `playwright.sync_api` where
 * needed) for `plan`, mirroring {@link renderSpecFileTs} exactly: the same
 * inlined, already-resolved data, the same "load manifest, build a registry,
 * call run_case/run_scenario" shape, against `agentic_test_hub_runner`
 * instead of `@agentic-test-hub/runner`.
 *
 * @param extensionsModule - Python import path for the plugin's extension
 *   module (e.g. `plugin.extensions`), required when `plan` touches an
 *   `extension` operation and otherwise unused.
 */
export function renderSpecFilePy(
  plan: GenerationPlan,
  manifest: PluginManifest,
  target: RenderTarget,
  extensionsModule?: string,
): string {
  const kinds = executorKindsFor(plan, manifest);
  if (kinds.includes("extension") && extensionsModule === undefined) {
    throw new Error(
      `${plan.id} touches an extension operation; renderSpecFilePy needs extensionsModule to import its handlers from`,
    );
  }

  const runtimeImports = [
    "ExecutionContext",
    "ExecutorRegistry",
    ...kinds
      .map((kind) => EXECUTOR_IMPORTS[kind])
      .filter((name): name is string => name !== undefined),
    ...(kinds.includes("browser") ? ["PlaywrightDriver"] : []),
    "load_manifest",
    plan.kind === "case" ? "run_case" : "run_scenario",
  ];

  const manifestImportPath = relativeImportPath(target, target.manifestPath);
  const pluginRootImportPath = relativeImportPath(target, target.pluginRoot);
  const entity = plan.kind === "case" ? plan.testCase : plan.scenario;
  const title = plan.kind === "case" ? plan.testCase.summary : plan.scenario.title;
  const functionName = testFunctionName(plan.id);

  // Python's run_case never resolves overrides itself (that logic is
  // TypeScript-only, run once at generation time) — it receives the
  // already-resolved baseline (plan.resolved) and the already-derived
  // action params (plan.params) directly, rather than a raw baseline plus
  // the case's own overrides the way the TypeScript template's runCase call
  // does.
  const dataDecl =
    plan.kind === "case"
      ? `RESOLVED = ${pythonJsonLiteral(plan.resolved)}
ACTION_PARAMS = ${pythonJsonLiteral(plan.params)}
TEST_CASE = ${pythonJsonLiteral(entity)}`
      : `SCENARIO = ${pythonJsonLiteral(entity)}`;

  const call =
    plan.kind === "case"
      ? "run_case(TEST_CASE, RESOLVED, ACTION_PARAMS, registry, context)"
      : "run_scenario(SCENARIO, registry, context)";

  const extensionsImport =
    extensionsModule === undefined ? "" : `\nimport ${extensionsModule} as EXTENSIONS_MODULE`;

  return `"""
Generated by ath-generate-test from ${plan.id}: ${title}

Do not hand-edit the inlined data below; regenerate with --force instead.
Assertions and setup around the generated call are yours to extend.
"""

import json
import os
from pathlib import Path

from agentic_test_hub_runner import (
    ${runtimeImports.join(",\n    ")},
)${extensionsImport}

MANIFEST_PATH = Path(__file__).parent / ${JSON.stringify(manifestImportPath)}
MANIFEST = load_manifest(MANIFEST_PATH.read_text())
# Not MANIFEST_PATH.parent: a manifest's shell/http-bodyFile relative paths
# are resolved against the plugin repository root, which can differ from
# the manifest file's own directory (examples/demo-app/plugin.yaml's own
# operations reach "examples/demo-app/cli.ts", rooted at the repo, not at
# examples/demo-app itself).
PLUGIN_ROOT = (Path(__file__).parent / ${JSON.stringify(pluginRootImportPath)}).resolve()

${dataDecl}


def ${functionName}() -> None:
    registry = ExecutorRegistry()
${registrations(kinds)}
    # A manifest's connections/operations commonly interpolate {{env.X}} (a
    # target URL, a token) — the operator supplies those as real environment
    # variables when running the generated test, so scopes["env"] defaults
    # to os.environ rather than being left empty.
    context = ExecutionContext(
        manifest=MANIFEST, scopes={"env": dict(os.environ)}, root=str(PLUGIN_ROOT)
    )
    result = ${call}
    assert result.verdict == "pass", result
`;
}
