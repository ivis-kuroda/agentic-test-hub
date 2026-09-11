import { describe, expect, it } from "vitest";

import { deriveIsolation, groupForExecution } from "../src/derive/isolation.ts";
import { cases, caseNoAuth, caseRetryOff, caseSms, makeCase } from "./fixtures.ts";

describe("deriveIsolation", () => {
  it("treats a request-shaped override as shareable", () => {
    expect(deriveIsolation(caseSms)).toBe("shared");
  });

  it("treats removing a request field as shareable", () => {
    expect(deriveIsolation(caseNoAuth)).toBe("shared");
  });

  it("treats a configuration override as needing a private environment", () => {
    expect(deriveIsolation(caseRetryOff)).toBe("exclusive");
  });

  it("lets an explicit declaration override the inference", () => {
    const forced = makeCase({
      id: "TC-DISPATCH-010",
      summary: "a request-shaped change that happens to be global",
      overrides: [{ path: "context.body.channel", op: "set", value: "sms" }],
      isolation: "exclusive",
    });
    expect(deriveIsolation(forced)).toBe("exclusive");
  });

  it("treats a case with no overrides as shareable", () => {
    expect(deriveIsolation(makeCase({ id: "TC-DISPATCH-011", summary: "baseline" }))).toBe(
      "shared",
    );
  });
});

describe("groupForExecution", () => {
  it("collects shareable cases into one group per baseline", () => {
    const groups = groupForExecution(cases);
    const shared = groups.filter((group) => group.isolation === "shared");
    expect(shared).toHaveLength(1);
    expect(shared[0]?.cases.map((testCase) => testCase.id)).toEqual([
      "TC-DISPATCH-001",
      "TC-DISPATCH-002",
      "TC-DISPATCH-003",
    ]);
  });

  it("gives every exclusive case a group of its own", () => {
    const groups = groupForExecution(cases);
    const exclusive = groups.filter((group) => group.isolation === "exclusive");
    expect(exclusive).toHaveLength(1);
    expect(exclusive[0]?.cases.map((testCase) => testCase.id)).toEqual(["TC-DISPATCH-004"]);
  });

  it("places every case in exactly one group", () => {
    const groups = groupForExecution(cases);
    const placed = groups.flatMap((group) => group.cases.map((testCase) => testCase.id));
    expect(placed.sort()).toEqual(cases.map((testCase) => testCase.id).sort());
  });
});
