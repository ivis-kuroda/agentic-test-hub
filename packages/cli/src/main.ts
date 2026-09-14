import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve as resolvePath } from "node:path";

import { loadManifest } from "@agentic-test-hub/plugin";
import { SpecStore } from "@agentic-test-hub/store";

import { planGeneration, type GenerationLanguage } from "./plan.ts";
import { pythonModuleName, renderSpecFilePy } from "./template-python.ts";
import { renderSpecFileTs } from "./template-typescript.ts";
import { writeGeneratedCase } from "./write-back.ts";

const USAGE =
  "usage: ath-generate-test <TC-id|SC-id> --specs <dir> --plugin <plugin.yaml> " +
  "--plugin-root <target-repo> [--lang typescript|python] [--out <path>] " +
  "[--python-extensions-module <path>] [--force]\n";

/** Where output goes, so tests can capture it instead of touching real streams. */
export interface CliIO {
  readonly stdout: { write(chunk: string): void };
  readonly stderr: { write(chunk: string): void };
}

interface ParsedArgs {
  readonly id: string;
  readonly specs: string;
  readonly plugin: string;
  readonly pluginRoot: string;
  readonly lang: GenerationLanguage;
  readonly out?: string;
  readonly pythonExtensionsModule?: string;
  readonly force: boolean;
}

function requireValue(rest: string[], flag: string): string {
  const value = rest.shift();
  if (value === undefined) throw new Error(`${flag} needs a value`);
  return value;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let id: string | undefined;
  let specs: string | undefined;
  let plugin: string | undefined;
  let pluginRoot: string | undefined;
  let lang: GenerationLanguage = "typescript";
  let out: string | undefined;
  let pythonExtensionsModule: string | undefined;
  let force = false;

  const rest = [...argv];
  while (rest.length > 0) {
    const arg = rest.shift() as string;
    switch (arg) {
      case "--specs":
        specs = requireValue(rest, arg);
        break;
      case "--plugin":
        plugin = requireValue(rest, arg);
        break;
      case "--plugin-root":
        pluginRoot = requireValue(rest, arg);
        break;
      case "--lang": {
        const value = requireValue(rest, arg);
        if (value !== "typescript" && value !== "python") {
          throw new Error(`--lang must be "typescript" or "python", got "${value}"`);
        }
        lang = value;
        break;
      }
      case "--out":
        out = requireValue(rest, arg);
        break;
      case "--python-extensions-module":
        pythonExtensionsModule = requireValue(rest, arg);
        break;
      case "--force":
        force = true;
        break;
      default:
        if (arg.startsWith("--")) throw new Error(`unknown option: ${arg}`);
        if (id !== undefined) throw new Error(`unexpected extra argument: ${arg}`);
        id = arg;
    }
  }

  if (id === undefined) throw new Error("missing <TC-id|SC-id>");
  if (specs === undefined) throw new Error("missing --specs");
  if (plugin === undefined) throw new Error("missing --plugin");
  if (pluginRoot === undefined) throw new Error("missing --plugin-root");

  return {
    id,
    specs,
    plugin,
    pluginRoot,
    lang,
    force,
    ...(out === undefined ? {} : { out }),
    ...(pythonExtensionsModule === undefined ? {} : { pythonExtensionsModule }),
  };
}

/**
 * Generates a Playwright test for one case or scenario.
 *
 * Every decision about *whether* generation can proceed already happened in
 * {@link planGeneration}; this function's own job is arg parsing, rendering
 * with whichever template `--lang` selects, writing the file, and — for a
 * case — writing `automation: {status: "generated", impl}` back through the
 * same `SpecStore` the hub itself uses, so a regenerate-without-`--force`
 * check and a hub editor never disagree about a case's state.
 *
 * @returns The process exit code: 0 on success, 1 when generation was
 *   refused or the case is already generated, 2 on a usage error.
 */
export async function main(argv: readonly string[], io: CliIO): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    io.stderr.write(USAGE);
    return 2;
  }

  const pluginPath = resolvePath(args.plugin);
  const manifestSource = await readFile(pluginPath, "utf8");
  const manifest = loadManifest(manifestSource).manifest;

  const store = new SpecStore(args.specs);
  const { suite, files } = await store.load();

  const outcome = planGeneration(suite, manifest, args.id, args.lang);
  if (!outcome.ok) {
    io.stderr.write(`refused to generate ${args.id}: ${outcome.refusal.reason}\n`);
    for (const path of outcome.refusal.paths) io.stderr.write(`  - ${path}\n`);
    return 1;
  }
  const plan = outcome.plan;

  if (plan.kind === "case" && plan.testCase.automation.status !== "manual" && !args.force) {
    io.stderr.write(
      `${plan.id} is already ${plan.testCase.automation.status} ` +
        `(impl: ${plan.testCase.automation.impl ?? "(none recorded)"}); pass --force to regenerate\n`,
    );
    return 1;
  }

  // A Python file's name becomes the module pytest imports it as, so it
  // must be a valid identifier — args.id (TC-DISPATCH-002) is not, having
  // hyphens, so the Python default uses the same slug as the generated
  // test function's own name rather than the case/scenario id verbatim.
  const defaultName =
    args.lang === "typescript" ? `${args.id}.spec.ts` : `${pythonModuleName(args.id)}.py`;
  const outPath = args.out ?? resolvePath(args.pluginRoot, "generated", defaultName);
  const target = {
    manifestPath: pluginPath,
    pluginRoot: resolvePath(args.pluginRoot),
    outPath,
  };

  const rendered =
    args.lang === "typescript"
      ? renderSpecFileTs(plan, manifest, target)
      : renderSpecFilePy(
          plan,
          manifest,
          target,
          args.pythonExtensionsModule ?? manifest.extensionModule,
        );

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, rendered, "utf8");

  if (plan.kind === "case") {
    const implPath = relative(args.pluginRoot, outPath);
    const expectedHash = files.get(`case/${plan.id}`)?.hash;
    if (expectedHash === undefined) {
      throw new Error(`internal error: SpecStore recorded no hash for case ${plan.id}`);
    }
    await writeGeneratedCase(store, plan.testCase, expectedHash, implPath);
  }

  io.stdout.write(`generated ${outPath}\n`);
  return 0;
}
