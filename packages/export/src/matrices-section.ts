import { buildMatrixView, type MatrixView, type Suite } from "@agentic-test-hub/core";

import { escapeHtml } from "./escape.ts";

function renderCell(cell: MatrixView["cells"][number][number]): string {
  const { state } = cell;
  if (state.kind === "covered") {
    return `<td class="cell covered" title="${escapeHtml(state.cases.join(", "))}">covered<span class="count">${state.cases.length} case(s)</span></td>`;
  }
  if (state.kind === "excluded") {
    return `<td class="cell excluded" title="${escapeHtml(state.reason)}">excluded</td>`;
  }
  return '<td class="cell gap">gap</td>';
}

/**
 * Renders one matrix as a grid: rows and columns are factor levels, cells are
 * computed, never authored.
 *
 * The computation is the point. A combination nobody wrote a case for shows
 * as a gap whether or not anyone noticed while writing the suite, which is
 * precisely what a hand-maintained matrix cannot guarantee — it shows what
 * its author remembered to fill in.
 */
function renderMatrix(view: MatrixView): string {
  const headerCells = view.colFactor.levels
    .map((level) => `<th>${escapeHtml(level.name)}</th>`)
    .join("");
  const rows = view.rowFactor.levels
    .map((rowLevel, rowIndex) => {
      const cells = (view.cells[rowIndex] ?? []).map((cell) => renderCell(cell)).join("");
      return `<tr><th>${escapeHtml(rowLevel.name)}</th>${cells}</tr>`;
    })
    .join("");

  const notes: string[] = [];
  if (view.unplaced.length > 0) {
    notes.push(
      `${view.unplaced.length} case(s) could not be placed on this matrix: ${view.unplaced
        .map((id) => `<code>${escapeHtml(id)}</code>`)
        .join(", ")}. Their overrides do not match a declared level.`,
    );
  }
  if (view.offAxisExclusions.length > 0) {
    notes.push(
      `${view.offAxisExclusions.length} exclusion(s) constrain a factor not shown on this projection: ${view.offAxisExclusions
        .map((exclusion) => escapeHtml(exclusion.reason))
        .join("; ")}.`,
    );
  }

  return `<figure>
  <table class="matrix">
    <caption>${escapeHtml(view.matrix.title)}
      <span class="badge">${view.matrix.strategy.replace("_", " ")}</span>
    </caption>
    <thead><tr><th class="corner"></th>${headerCells}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="stats">
    <div class="stat"><span class="n">${view.stats.covered}</span><span class="label">covered</span></div>
    <div class="stat"><span class="n">${view.stats.excluded}</span><span class="label">excluded</span></div>
    <div class="stat${view.stats.gap > 0 ? " gap" : ""}"><span class="n">${view.stats.gap}</span><span class="label">gap</span></div>
  </div>
  ${notes.length > 0 ? `<details class="matrix-notes"><summary>${notes.length} note(s)</summary><ul>${notes.map((note) => `<li>${note}</li>`).join("")}</ul></details>` : ""}
</figure>`;
}

/**
 * Renders every matrix in a suite.
 *
 * @param suite - The suite to render.
 * @returns An HTML section.
 */
export function renderMatricesSection(suite: Suite): string {
  if (suite.matrices.length === 0) {
    return '<section id="matrices"><h2>Coverage matrices</h2><p class="empty">No matrices are declared yet.</p></section>';
  }

  const figures = suite.matrices
    .map((matrix) => renderMatrix(buildMatrixView(matrix, suite)))
    .join("\n");

  return `<section id="matrices">
  <h2>Coverage matrices</h2>
  <p class="legend">
    <span><span class="swatch covered"></span>covered</span>
    <span><span class="swatch excluded"></span>excluded, with a stated reason</span>
    <span><span class="swatch gap"></span>gap — nothing tests this combination</span>
  </p>
  ${figures}
</section>`;
}
