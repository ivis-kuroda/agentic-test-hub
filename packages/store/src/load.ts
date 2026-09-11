import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { EMPTY_SUITE, type Suite } from "@agentic-test-hub/core";

import { LAYOUTS, type EntityKind } from "./layout.ts";
import { fromYaml } from "./serialize.ts";

/** Something wrong with a file on disk. */
export interface StoreProblem {
  /** Path relative to the specification root. */
  readonly file: string;
  /** Location within the file, when known. */
  readonly at?: string;
  readonly message: string;
}

/**
 * A file as it was read, for detecting concurrent changes.
 *
 * The hash is of the bytes rather than of the parsed content, so a change
 * that only reorders keys still counts as a change. Anyone saving over it
 * should be told, even if the data is equivalent — their editor was showing
 * something other than what is on disk.
 */
export interface FileState {
  readonly file: string;
  readonly hash: string;
}

/** Everything a specification directory contained. */
export interface LoadedSuite {
  readonly suite: Suite;
  readonly problems: readonly StoreProblem[];
  /** The state of each file, keyed by `kind/id`. */
  readonly files: ReadonlyMap<string, FileState>;
}

/** Hashes file contents, for optimistic locking. */
export function hashContents(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

async function listYaml(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
      .map((entry) => join(directory, entry.name))
      .sort();
  } catch (cause) {
    // A kind with no directory yet is an empty collection, not an error: a
    // suite that has viewpoints but no scenarios is perfectly normal.
    if ((cause as { code?: string }).code === "ENOENT") return [];
    throw cause;
  }
}

/**
 * Reads every specification under a directory.
 *
 * Problems are collected rather than thrown. A suite with one malformed file
 * should still open in the editor, showing everything that did load and
 * naming what did not — refusing to open at all makes the one bad file
 * impossible to fix through the tool that wrote it.
 *
 * @param root - Specification root directory.
 * @returns The suite, everything wrong with it, and each file's state.
 */
export async function loadSuite(root: string): Promise<LoadedSuite> {
  const problems: StoreProblem[] = [];
  const files = new Map<string, FileState>();
  const collected: Record<string, unknown[]> = {
    viewpoints: [],
    factors: [],
    matrices: [],
    baselines: [],
    cases: [],
    scenarios: [],
  };

  for (const layout of LAYOUTS) {
    for (const path of await listYaml(join(root, layout.directory))) {
      const file = relative(root, path);
      const text = await readFile(path, "utf8");

      let raw: unknown;
      try {
        raw = fromYaml(text);
      } catch (cause) {
        problems.push({ file, message: `not valid YAML: ${String(cause)}` });
        continue;
      }

      const parsed = layout.schema.safeParse(raw);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const at = issue.path.join(".");
          problems.push({ file, message: issue.message, ...(at === "" ? {} : { at }) });
        }
        continue;
      }

      const entity = parsed.data as { id: string };
      const expected = `${entity.id}.yaml`;
      if (!file.endsWith(`/${expected}`)) {
        // The filename is how a person finds an entity and how a reviewer
        // reads a diff. Letting it drift from the identifier makes both
        // useless.
        problems.push({
          file,
          message: `holds ${entity.id}, so it should be named ${expected}`,
        });
      }

      collected[layout.collection]?.push(entity);
      files.set(`${layout.kind}/${entity.id}`, { file, hash: hashContents(text) });
    }
  }

  return {
    suite: { ...EMPTY_SUITE, ...collected } as Suite,
    problems,
    files,
  };
}

/** Reads one entity's file state, for an editor about to offer a save. */
export async function readFileState(
  root: string,
  kind: EntityKind,
  path: string,
): Promise<FileState | undefined> {
  try {
    const text = await readFile(path, "utf8");
    return { file: relative(root, path), hash: hashContents(text) };
  } catch (cause) {
    if ((cause as { code?: string }).code === "ENOENT") return undefined;
    throw cause;
  }
}
