import { describe, expect, it } from "vitest";

import { Matrix } from "../src/schema/matrix.ts";
import { Scenario } from "../src/schema/scenario.ts";
import { hasErrors, validateSuite, type Suite } from "../src/suite.ts";
import { EMPTY_SUITE } from "../src/suite.ts";
import {
  authFactor,
  authViewpoint,
  baseline,
  caseBaselineEmail,
  caseNoAuth,
  channelFactor,
  factors,
  makeCase,
  matrix,
  viewpoints,
} from "./fixtures.ts";

/** A suite whose references all resolve. */
const sound: Suite = {
  ...EMPTY_SUITE,
  viewpoints: [authViewpoint],
  factors,
  matrices: [matrix],
  baselines: [baseline],
  cases: [caseBaselineEmail, caseNoAuth],
};

function errorsOf(suite: Suite): string[] {
  return validateSuite(suite)
    .filter((problem) => problem.severity === "error")
    .map((problem) => `${problem.at}: ${problem.message}`);
}

describe("validateSuite", () => {
  it("accepts a suite whose references all resolve", () => {
    expect(errorsOf(sound)).toEqual([]);
  });

  it("reports an empty suite as sound rather than as broken", () => {
    expect(validateSuite(EMPTY_SUITE)).toEqual([]);
  });

  it("catches a case pointing at a baseline that does not exist", () => {
    const suite = {
      ...sound,
      cases: [makeCase({ id: "TC-X-001", summary: "s", baseline: "BL-GONE" })],
    };
    expect(errorsOf(suite)[0]).toMatch(/baseline BL-GONE, which does not exist/);
  });

  it("catches a case naming a viewpoint that does not exist", () => {
    const suite = {
      ...sound,
      cases: [makeCase({ id: "TC-X-001", summary: "s", viewpoints: ["VP-GONE"] })],
    };
    expect(errorsOf(suite)[0]).toMatch(/viewpoint VP-GONE/);
  });

  it("catches a viewpoint named only on an expectation", () => {
    const suite = {
      ...sound,
      cases: [
        makeCase({
          id: "TC-X-001",
          summary: "s",
          expect: [{ kind: "http_status", status: 200, viewpoints: ["VP-GONE"] }],
        }),
      ],
    };
    expect(errorsOf(suite).join()).toMatch(/expect\[0\].*VP-GONE/);
  });

  it("catches a duplicate identifier", () => {
    const suite = { ...sound, cases: [caseBaselineEmail, caseBaselineEmail] };
    expect(errorsOf(suite)[0]).toMatch(/used more than once/);
  });

  it("catches a matrix axis pointing at a factor that does not exist", () => {
    const broken = Matrix.parse({ ...matrix, axes: { rows: "F-GONE", cols: "F-CHANNEL" } });
    expect(errorsOf({ ...sound, matrices: [broken] })[0]).toMatch(/factor F-GONE/);
  });

  it("catches a matrix using one factor for both axes", () => {
    const broken = Matrix.parse({ ...matrix, axes: { rows: "F-AUTH", cols: "F-AUTH" } });
    expect(errorsOf({ ...sound, matrices: [broken] })[0]).toMatch(/same factor for both axes/);
  });

  it("catches an exclusion naming a level its factor does not declare", () => {
    const broken = Matrix.parse({
      ...matrix,
      exclusions: [{ when: { "F-AUTH": "L-NOPE" }, reason: "r" }],
    });
    expect(errorsOf({ ...sound, matrices: [broken] })[0]).toMatch(/level L-NOPE/);
  });

  it("catches a factor declaring the same level twice", () => {
    const broken = { ...authFactor, levels: [...authFactor.levels, authFactor.levels[0]!] };
    expect(errorsOf({ ...sound, factors: [broken, channelFactor] })[0]).toMatch(
      /declared more than once/,
    );
  });

  it("catches a factor with two absent levels, which makes a missing value ambiguous", () => {
    const broken = {
      ...authFactor,
      levels: [
        { id: "L-A", name: "not sent", absent: true, value: undefined },
        { id: "L-B", name: "also not sent", absent: true, value: undefined },
      ],
    };
    expect(errorsOf({ ...sound, factors: [broken] })[0]).toMatch(/more than one level/);
  });

  it("catches a case placed on a level its factor does not declare", () => {
    const suite = {
      ...sound,
      cases: [makeCase({ id: "TC-X-001", summary: "s", at: { "F-AUTH": "L-NOPE" } })],
    };
    expect(errorsOf(suite)[0]).toMatch(/level L-NOPE/);
  });

  it("catches a step depending on one that does not come earlier", () => {
    const scenario = Scenario.parse({
      id: "SC-X",
      title: "t",
      steps: [
        {
          id: "S-1",
          summary: "first",
          expect: [{ kind: "http_status", status: 200 }],
          dependsOn: ["S-2"],
        },
        { id: "S-2", summary: "second", expect: [{ kind: "http_status", status: 200 }] },
      ],
    });
    expect(errorsOf({ ...sound, scenarios: [scenario] })[0]).toMatch(/does not appear earlier/);
  });

  it("catches a step depending on itself", () => {
    const scenario = Scenario.parse({
      id: "SC-X",
      title: "t",
      steps: [
        {
          id: "S-1",
          summary: "first",
          expect: [{ kind: "http_status", status: 200 }],
          dependsOn: ["S-1"],
        },
      ],
    });
    expect(errorsOf({ ...sound, scenarios: [scenario] })[0]).toMatch(/depends on itself/);
  });

  it("accepts a step depending on an earlier one", () => {
    const scenario = Scenario.parse({
      id: "SC-X",
      title: "t",
      viewpoints: ["VP-AUTH"],
      steps: [
        { id: "S-1", summary: "first", expect: [{ kind: "http_status", status: 200 }] },
        {
          id: "S-2",
          summary: "second",
          expect: [{ kind: "http_status", status: 200 }],
          dependsOn: ["S-1"],
        },
      ],
    });
    expect(errorsOf({ ...sound, scenarios: [scenario] })).toEqual([]);
  });

  it("catches a viewpoint listing itself as a parent", () => {
    const broken = { ...authViewpoint, parents: [authViewpoint.id] };
    expect(errorsOf({ ...sound, viewpoints: [broken] })[0]).toMatch(/lists itself/);
  });
});

describe("warnings", () => {
  it("warns about a viewpoint nothing verifies, without blocking", () => {
    const suite = { ...sound, viewpoints };
    const warnings = validateSuite(suite).filter((problem) => problem.severity === "warning");
    expect(warnings.map((problem) => problem.at)).toContain("viewpoint/VP-AUDIT");
    expect(hasErrors(validateSuite(suite))).toBe(false);
  });

  it("warns about a case whose expectations are all unspecified", () => {
    const suite = {
      ...sound,
      cases: [
        makeCase({
          id: "TC-X-001",
          summary: "s",
          expect: [{ kind: "unspecified", text: "an error is returned" }],
        }),
      ],
    };
    const warnings = validateSuite(suite).filter((problem) => problem.severity === "warning");
    expect(warnings.map((problem) => problem.message).join()).toMatch(
      /nothing about it can be checked/,
    );
  });
});

describe("hasErrors", () => {
  it("distinguishes advice from a broken suite", () => {
    expect(hasErrors([{ at: "x", message: "m", severity: "warning" }])).toBe(false);
    expect(hasErrors([{ at: "x", message: "m", severity: "error" }])).toBe(true);
  });
});
