import ExcelJS from "exceljs";

import type { Suite } from "@agentic-test-hub/core";

import { collapseRepeats } from "./collapse.ts";
import { buildDeliveryRows, type DeliveryRow } from "./execution-rows.ts";

/** One column of a delivery workbook. */
export interface DeliveryColumn {
  header: string;
  width?: number;
  /** Reads this column's value out of a row. */
  value(row: DeliveryRow, index: number): string | number;
  /**
   * Collapse an immediate repeat into `sameAsAboveLabel`.
   *
   * Meant for columns like the target surface, which genuinely repeats when
   * consecutive rows act on the same screen. Left off by default, because
   * collapsing an expected result or a summary would hide the one thing the
   * document exists to show.
   */
  collapseWhenRepeated?: boolean;
}

/** Settings for a delivery workbook. */
export interface DeliveryWorkbookOptions {
  readonly sheetName: string;
  readonly columns: readonly DeliveryColumn[];
  /** Key/value pairs shown above the table — author, date, target version. */
  readonly meta?: Readonly<Record<string, string>>;
  /** Text substituted for a collapsed repeat. */
  readonly sameAsAboveLabel?: string;
}

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFE8E8E8" },
};

/**
 * Renders a suite as a delivery workbook: the organisation's spreadsheet
 * layout, one row per step, generated from the same source as every other
 * view.
 *
 * The layout is not fixed by this function. It is the whole point that it
 * is not: a hand-written specification's columns are an organisational
 * convention, not something the hub should assume, so a caller supplies
 * {@link DeliveryWorkbookOptions.columns} — commonly a layout kept in a
 * plugin, matching what that organisation already delivers.
 *
 * @param suite - The suite to render.
 * @param options - Column layout and page metadata.
 * @returns A workbook ready to be written to a file.
 */
export function renderDeliveryWorkbook(
  suite: Suite,
  options: DeliveryWorkbookOptions,
): ExcelJS.Workbook {
  const rows = buildDeliveryRows(suite);
  const marker = options.sameAsAboveLabel ?? "";

  const columnValues = options.columns.map((column) =>
    rows.map((row, index) => String(column.value(row, index))),
  );
  const rendered = options.columns.map((column, columnIndex) =>
    column.collapseWhenRepeated === true
      ? collapseRepeats(columnValues[columnIndex] ?? [], marker)
      : (columnValues[columnIndex] ?? []),
  );

  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(options.sheetName);

  let cursor = 1;
  if (options.meta !== undefined) {
    for (const [key, value] of Object.entries(options.meta)) {
      sheet.getCell(cursor, 1).value = key;
      sheet.getCell(cursor, 1).font = { bold: true };
      sheet.getCell(cursor, 2).value = value;
      cursor += 1;
    }
    cursor += 1;
  }

  const headerRow = sheet.getRow(cursor);
  options.columns.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = column.header;
    cell.fill = HEADER_FILL;
    cell.font = { bold: true };
    if (column.width !== undefined) sheet.getColumn(index + 1).width = column.width;
  });
  headerRow.commit();
  const firstDataRow = cursor + 1;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const sheetRow = sheet.getRow(firstDataRow + rowIndex);
    options.columns.forEach((_column, columnIndex) => {
      const cell = sheetRow.getCell(columnIndex + 1);
      cell.value = rendered[columnIndex]?.[rowIndex] ?? "";
      cell.alignment = { vertical: "top", wrapText: true };
    });
    sheetRow.commit();
  }

  return workbook;
}
