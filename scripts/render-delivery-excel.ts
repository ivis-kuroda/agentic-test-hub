#!/usr/bin/env node
/**
 * Renders the delivery workbook from a specification directory.
 *
 * The column layout here is generic, for demonstrating the engine against
 * the fictional demo service. A real organisation's layout — matching its
 * existing spreadsheet convention — belongs in that organisation's plugin
 * repository, not here.
 *
 * Usage: `node scripts/render-delivery-excel.ts <specs-dir> <out-file>`
 */
import { writeFile } from "node:fs/promises";

import { renderDeliveryWorkbook, type DeliveryColumn } from "@agentic-test-hub/export";
import { loadSuite } from "@agentic-test-hub/store";

const [root, out] = process.argv.slice(2);
if (root === undefined || out === undefined) {
  process.stderr.write("usage: render-delivery-excel <specs-dir> <out-file>\n");
  process.exit(2);
}

const columns: readonly DeliveryColumn[] = [
  { header: "No.", width: 6, value: (_row, index) => index + 1 },
  { header: "Target", width: 22, value: (row) => row.target, collapseWhenRepeated: true },
  { header: "Action", width: 18, value: (row) => row.action, collapseWhenRepeated: true },
  { header: "Summary", width: 40, value: (row) => row.summary },
  { header: "Preconditions", width: 30, value: (row) => row.preconditions.join("\n") },
  { header: "Procedure", width: 30, value: (row) => row.procedure },
  { header: "Expected result", width: 40, value: (row) => row.expected.join("\n") },
  { header: "Result", width: 10, value: () => "" },
  { header: "Bug ref", width: 12, value: () => "" },
];

const { suite, problems } = await loadSuite(root);
for (const problem of problems) {
  process.stderr.write(`warning: ${problem.file}: ${problem.message}\n`);
}

const workbook = renderDeliveryWorkbook(suite, {
  sheetName: "Test spec",
  columns,
  sameAsAboveLabel: "〃",
  meta: { Generated: new Date().toISOString(), Source: root },
});

await writeFile(out, new Uint8Array(await workbook.xlsx.writeBuffer()));
process.stdout.write(`wrote ${out}\n`);
