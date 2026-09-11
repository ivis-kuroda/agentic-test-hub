import { describe, expect, it } from "vitest";

import { collapseRepeats } from "../src/collapse.ts";

describe("collapseRepeats", () => {
  it("collapses an immediate repeat", () => {
    expect(collapseRepeats(["a", "a", "b"], "〃")).toEqual(["a", "〃", "b"]);
  });

  it("does not collapse the first row, which has nothing above it", () => {
    expect(collapseRepeats(["a"], "〃")).toEqual(["a"]);
  });

  it("does not collapse a non-consecutive repeat", () => {
    expect(collapseRepeats(["a", "b", "a"], "〃")).toEqual(["a", "b", "a"]);
  });

  it("collapses a run longer than two", () => {
    expect(collapseRepeats(["a", "a", "a"], "〃")).toEqual(["a", "〃", "〃"]);
  });

  it("does not mutate the source, since the source never abbreviates anything", () => {
    const source = ["a", "a"];
    collapseRepeats(source, "〃");
    expect(source).toEqual(["a", "a"]);
  });
});

describe("collapseRepeats, blank values", () => {
  it("does not collapse consecutive empty values into the marker", () => {
    expect(collapseRepeats(["", ""], "〃")).toEqual(["", ""]);
  });

  it("does not collapse a real value that repeats an empty one before it", () => {
    expect(collapseRepeats(["", "a", "a"], "〃")).toEqual(["", "a", "〃"]);
  });
});
