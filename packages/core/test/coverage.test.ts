import { describe, expect, it } from "vitest";

import { buildMatrixView, buildViewpointCoverage } from "../src/derive/coverage.js";
import { Matrix } from "../src/schema/matrix.js";
import { baseline, cases, factors, matrix, viewpoints } from "./fixtures.js";

const suite = { factors, baselines: [baseline], cases };

function cellAt(rowId: string, colId: string) {
  const view = buildMatrixView(matrix, suite);
  for (const row of view.cells) {
    for (const cell of row) {
      if (cell.row.id === rowId && cell.col.id === colId) return cell;
    }
  }
  throw new Error(`no cell at ${rowId}/${colId}`);
}

describe("buildMatrixView", () => {
  it("renders a grid the size of its two axes", () => {
    const view = buildMatrixView(matrix, suite);
    expect(view.cells).toHaveLength(3);
    expect(view.cells[0]).toHaveLength(3);
    expect(view.stats.total).toBe(9);
  });

  it("marks a combination a case exercises as covered", () => {
    const cell = cellAt("L-VALID", "L-EMAIL");
    expect(cell.state).toEqual({ kind: "covered", cases: ["TC-DISPATCH-001", "TC-DISPATCH-004"] });
  });

  it("marks a combination nobody wrote a case for as a gap", () => {
    expect(cellAt("L-EXPIRED", "L-SMS").state).toEqual({ kind: "gap" });
  });

  it("marks a deliberately untested combination as excluded, with its reason", () => {
    const state = cellAt("L-ABSENT", "L-PUSH").state;
    expect(state.kind).toBe("excluded");
    expect(state).toHaveProperty("reason", expect.stringContaining("unreachable"));
  });

  it("counts covered, excluded and gap cells to the size of the grid", () => {
    const { stats } = buildMatrixView(matrix, suite);
    expect(stats.covered + stats.excluded + stats.gap).toBe(stats.total);
    expect(stats.covered).toBe(3);
    expect(stats.excluded).toBe(1);
    expect(stats.gap).toBe(5);
  });

  it("reports a case whose baseline is unknown rather than dropping it", () => {
    const orphan = { ...cases[0]!, id: "TC-DISPATCH-099", baseline: "BL-MISSING" };
    const view = buildMatrixView(matrix, { ...suite, cases: [...cases, orphan] });
    expect(view.unplaced).toContain("TC-DISPATCH-099");
  });

  it("reports exclusions that constrain a factor off both axes", () => {
    const offAxis = Matrix.parse({
      ...matrix,
      exclusions: [
        ...matrix.exclusions,
        { when: { "F-RETRY": "L-OFF" }, reason: "retry is out of scope for this release" },
      ],
    });
    const view = buildMatrixView(offAxis, suite);
    expect(view.offAxisExclusions).toHaveLength(1);
    expect(view.offAxisExclusions[0]?.reason).toContain("out of scope");
  });

  it("does not let an off-axis exclusion silently grey out a cell", () => {
    const offAxis = Matrix.parse({
      ...matrix,
      exclusions: [{ when: { "F-RETRY": "L-OFF" }, reason: "out of scope" }],
    });
    const view = buildMatrixView(offAxis, suite);
    expect(view.stats.excluded).toBe(0);
  });

  it("rejects a matrix naming a factor that does not exist", () => {
    const broken = Matrix.parse({ ...matrix, axes: { rows: "F-NOPE", cols: "F-CHANNEL" } });
    expect(() => buildMatrixView(broken, suite)).toThrow(/unknown factor/);
  });
});

describe("buildViewpointCoverage", () => {
  it("finds cases that name a viewpoint directly", () => {
    const [auth] = buildViewpointCoverage(viewpoints, cases, []);
    expect(auth?.cases).toContain("TC-DISPATCH-001");
  });

  it("finds cases that name a viewpoint only on an expectation", () => {
    const [auth] = buildViewpointCoverage(viewpoints, cases, []);
    expect(auth?.cases).toContain("TC-DISPATCH-003");
  });

  it("flags a viewpoint nothing references", () => {
    const coverage = buildViewpointCoverage(viewpoints, cases, []);
    const audit = coverage.find((entry) => entry.viewpoint.id === "VP-AUDIT");
    expect(audit?.uncovered).toBe(true);
  });

  it("reports one entry per viewpoint, in the order given", () => {
    const coverage = buildViewpointCoverage(viewpoints, cases, []);
    expect(coverage.map((entry) => entry.viewpoint.id)).toEqual(["VP-AUTH", "VP-AUDIT"]);
  });
});
