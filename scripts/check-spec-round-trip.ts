#!/usr/bin/env node
/**
 * Fails when any specification file is not in canonical form.
 *
 * This is the only thing that actually keeps the determinism guarantee. A
 * serialisation change that reorders keys or reflows text passes every other
 * test, and its consequence — the next save producing a diff that touches
 * every file — appears weeks later, in someone else's review.
 *
 * Usage: `node scripts/check-spec-round-trip.ts <specs-dir>...`
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { checkRoundTrip, LAYOUTS } from "@agentic-test-hub/store";

const roots = process.argv.slice(2);
if (roots.length === 0) {
  process.stderr.write("usage: check-spec-round-trip <specs-dir>...\n");
  process.exit(2);
}

interface Finding {
  readonly file: string;
  readonly written: string;
  readonly actual: string;
}

const findings: Finding[] = [];
let checked = 0;

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
      checked += 1;
      const result = checkRoundTrip(actual, layout.schema);
      if (!result.stable) {
        findings.push({ file: relative(process.cwd(), path), written: result.written, actual });
      }
    }
  }
}

if (findings.length > 0) {
  process.stderr.write("These specification files are not in canonical form:\n\n");
  for (const finding of findings) {
    process.stderr.write(`  ${finding.file}\n`);
  }
  process.stderr.write("\nRun `pnpm specs:normalise` to rewrite them.\n");
  process.exit(1);
}

process.stdout.write(`All ${checked} specification file(s) are canonical.\n`);
