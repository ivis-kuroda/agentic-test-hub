import { parse as parseYaml } from "yaml";

import { PluginManifest } from "./schema/manifest.ts";
import { collectPlaceholders } from "./template.ts";

/** A manifest that parsed but does not hang together. */
export interface IntegrityProblem {
  /** Where in the manifest the problem is, as a dotted path. */
  readonly at: string;
  readonly message: string;
}

/** Connection kinds each executor can run against. */
const EXECUTOR_CONNECTION: Readonly<Record<string, string>> = {
  http: "http",
  sql: "postgres",
  browser: "browser",
};

/**
 * Checks that everything a manifest refers to actually exists.
 *
 * Schema validation establishes that a manifest is well formed; this
 * establishes that it is coherent. The distinction matters because a
 * dangling reference is perfectly well formed and fails only when the
 * operation that needs it runs — typically far from the person who made the
 * mistake, and typically in the middle of a suite.
 *
 * @param manifest - A manifest that has already passed schema validation.
 * @returns Every problem found. An empty array means the manifest is
 *   internally consistent.
 */
export function checkIntegrity(manifest: PluginManifest): IntegrityProblem[] {
  const problems: IntegrityProblem[] = [];
  const operationIds = new Set(Object.keys(manifest.operations));
  const connectionNames = new Set(Object.keys(manifest.connections));

  const requireOperation = (id: string, at: string): void => {
    if (!operationIds.has(id)) {
      problems.push({ at, message: `refers to operation ${id}, which is not declared` });
    }
  };

  for (const [id, operation] of Object.entries(manifest.operations)) {
    const at = `operations.${id}`;

    if ("connection" in operation) {
      const connection = manifest.connections[operation.connection];
      if (!connection) {
        problems.push({
          at,
          message: `refers to connection "${operation.connection}", which is not declared`,
        });
      } else {
        const expected = EXECUTOR_CONNECTION[operation.executor];
        if (expected !== undefined && connection.kind !== expected) {
          problems.push({
            at,
            message:
              `is a ${operation.executor} operation but "${operation.connection}" ` +
              `is a ${connection.kind} connection`,
          });
        }
      }
    }

    if (operation.executor === "http" && operation.body !== undefined && operation.bodyFile) {
      problems.push({ at, message: "declares both body and bodyFile; use one" });
    }

    if (operation.executor === "extension" && !manifest.extensionModule) {
      problems.push({
        at,
        message: "is an extension operation, but the manifest declares no extensionModule",
      });
    }
  }

  for (const [ref, provider] of Object.entries(manifest.states)) {
    requireOperation(provider.ensure.operation, `states.${ref}.ensure`);
    requireOperation(provider.verify.operation, `states.${ref}.verify`);
  }

  for (const [source, call] of Object.entries(manifest.evidence)) {
    if (call) requireOperation(call.operation, `evidence.${source}`);
  }

  for (const name of connectionNames) {
    if (!/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(name)) {
      problems.push({
        at: `connections.${name}`,
        message: "connection names must be lower-case and hyphenated",
      });
    }
  }

  return problems;
}

/** A manifest, validated and checked, together with what it needs to run. */
export interface LoadedPlugin {
  readonly manifest: PluginManifest;
  /**
   * Environment variables the manifest interpolates.
   *
   * Reported so that a missing variable is one sentence at startup rather
   * than an obscure failure part-way through a suite.
   */
  readonly requiredEnv: readonly string[];
}

/** A manifest that could not be loaded. */
export class PluginLoadError extends Error {
  /** Problems found, when the manifest parsed but did not cohere. */
  readonly problems: readonly IntegrityProblem[];

  constructor(message: string, problems: readonly IntegrityProblem[] = []) {
    super(message);
    this.name = "PluginLoadError";
    this.problems = problems;
  }
}

/**
 * Parses and checks a manifest.
 *
 * @param source - Manifest text, in YAML.
 * @returns The validated manifest and the environment it expects.
 * @throws {PluginLoadError} When the manifest is malformed or incoherent.
 */
export function loadManifest(source: string): LoadedPlugin {
  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (cause) {
    throw new PluginLoadError(`plugin manifest is not valid YAML: ${String(cause)}`);
  }

  const parsed = PluginManifest.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => ({
      at: issue.path.join(".") || "(root)",
      message: issue.message,
    }));
    throw new PluginLoadError("plugin manifest does not match the expected shape", problems);
  }

  const problems = checkIntegrity(parsed.data);
  if (problems.length > 0) {
    throw new PluginLoadError("plugin manifest refers to things it does not declare", problems);
  }

  const requiredEnv = collectPlaceholders(parsed.data)
    .filter((placeholder) => placeholder.startsWith("env."))
    .map((placeholder) => placeholder.slice("env.".length))
    .sort();

  return { manifest: parsed.data, requiredEnv };
}
