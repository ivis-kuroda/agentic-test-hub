#!/usr/bin/env node
/**
 * Renders the reviewer view from a specification directory and writes it to
 * a file.
 *
 * Usage: `node scripts/render-reviewer-view.ts <specs-dir> <out-file> [title]`
 */
import { writeFile } from "node:fs/promises";

import { renderReviewerView } from "@agentic-test-hub/export";
import { loadSuite } from "@agentic-test-hub/store";

const [root, out, title] = process.argv.slice(2);
if (root === undefined || out === undefined) {
  process.stderr.write("usage: render-reviewer-view <specs-dir> <out-file> [title]\n");
  process.exit(2);
}

const { suite, problems } = await loadSuite(root);
for (const problem of problems) {
  process.stderr.write(`warning: ${problem.file}: ${problem.message}\n`);
}

const html = renderReviewerView(suite, {
  title: title ?? "Test specification review",
  subtitle: root,
});
await writeFile(out, html, "utf8");
process.stdout.write(`wrote ${out}\n`);
