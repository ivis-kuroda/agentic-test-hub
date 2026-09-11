#!/usr/bin/env node
/**
 * Rewrites specification files in canonical form.
 *
 * The counterpart to the round-trip check: rather than asking an author to
 * reproduce a serialiser's output by hand, the tool that knows the rules
 * applies them.
 *
 * Usage: `node scripts/normalise-specs.ts <specs-dir>...`
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { checkRoundTrip, LAYOUTS } from "@agentic-test-hub/store";

const roots = process.argv.slice(2);
if (roots.length === 0) {
  process.stderr.write("usage: normalise-specs <specs-dir>...\n");
  process.exit(2);
}

let rewritten = 0;

for (const root of roots) {
  for (const layout of LAYOUTS) {
    const directory = join(root, layout.directory);
    let entries: string[];
    try {
      entries = (await readdir(directory)).filter((name) => name.endsWith(".yaml")).sort();
    } catch {
      continue;
    }

    for (const name of entries) {
      const path = join(directory, name);
      const actual = await readFile(path, "utf8");
      const result = checkRoundTrip(actual, layout.schema);
      if (!result.stable) {
        await writeFile(path, result.written, "utf8");
        process.stdout.write(`rewrote ${relative(process.cwd(), path)}\n`);
        rewritten += 1;
      }
    }
  }
}

process.stdout.write(
  rewritten === 0 ? "Everything was already canonical.\n" : `Rewrote ${rewritten} file(s).\n`,
);
