import { describe, expect, it } from "vitest";

import { EMPTY_SUITE, type Suite } from "@agentic-test-hub/core";

import { baseline, caseBaselineEmail, caseSms } from "../../core/test/fixtures.ts";
import { renderDeliveryWorkbook, type DeliveryColumn } from "../src/delivery-excel.ts";

const columns: readonly DeliveryColumn[] = [
  { header: "No", width: 6, value: (_row, index) => index + 1 },
  { header: "Target", width: 20, value: (row) => row.target, collapseWhenRepeated: true },
  { header: "Summary", width: 40, value: (row) => row.summary },
  { header: "Expected", width: 40, value: (row) => row.expected.join("\n") },
];

const suite: Suite = {
  ...EMPTY_SUITE,
  baselines: [baseline],
  cases: [caseBaselineEmail, caseSms],
};

describe("renderDeliveryWorkbook", () => {
  it("writes one header row plus one row per case", () => {
    const workbook = renderDeliveryWorkbook(suite, { sheetName: "Cases", columns });
    const sheet = workbook.getWorksheet("Cases");
    expect(sheet?.rowCount).toBe(3);
  });

  it("writes the declared column headers in order", () => {
    const workbook = renderDeliveryWorkbook(suite, { sheetName: "Cases", columns });
    const sheet = workbook.getWorksheet("Cases")!;
    const headerValues = columns.map((_c, index) => sheet.getRow(1).getCell(index + 1).value);
    expect(headerValues).toEqual(["No", "Target", "Summary", "Expected"]);
  });

  it("writes each row's computed values", () => {
    const workbook = renderDeliveryWorkbook(suite, { sheetName: "Cases", columns });
    const sheet = workbook.getWorksheet("Cases")!;
    expect(sheet.getRow(2).getCell(3).value).toBe(caseBaselineEmail.summary);
    expect(sheet.getRow(3).getCell(3).value).toBe(caseSms.summary);
  });

  it("collapses a repeated target into the same-as-above label", () => {
    const workbook = renderDeliveryWorkbook(suite, {
      sheetName: "Cases",
      columns,
      sameAsAboveLabel: "〃",
    });
    const sheet = workbook.getWorksheet("Cases")!;
    expect(sheet.getRow(2).getCell(2).value).toBe(baseline.target?.surface);
    expect(sheet.getRow(3).getCell(2).value).toBe("〃");
  });

  it("does not collapse a column that was not opted in", () => {
    const workbook = renderDeliveryWorkbook(suite, { sheetName: "Cases", columns });
    const sheet = workbook.getWorksheet("Cases")!;
    // Both summaries differ, but even if they matched, this column has no
    // collapseWhenRepeated flag and must show its own value on every row.
    expect(sheet.getRow(2).getCell(3).value).not.toBe("");
  });

  it("writes meta rows above the table when given", () => {
    const workbook = renderDeliveryWorkbook(suite, {
      sheetName: "Cases",
      columns,
      meta: { Author: "someone", Version: "1.0" },
    });
    const sheet = workbook.getWorksheet("Cases")!;
    expect(sheet.getRow(1).getCell(1).value).toBe("Author");
    expect(sheet.getRow(1).getCell(2).value).toBe("someone");
    expect(sheet.getRow(2).getCell(1).value).toBe("Version");
    // The header row is pushed down past a blank separator row.
    expect(sheet.getRow(4).getCell(1).value).toBe("No");
  });

  it("produces a workbook that can be written to a buffer and read back", async () => {
    const workbook = renderDeliveryWorkbook(suite, { sheetName: "Cases", columns });
    const buffer = await workbook.xlsx.writeBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);
  });

  it("handles an empty suite, writing only the header", () => {
    const workbook = renderDeliveryWorkbook(EMPTY_SUITE, { sheetName: "Cases", columns });
    const sheet = workbook.getWorksheet("Cases")!;
    expect(sheet.rowCount).toBe(1);
  });
});
