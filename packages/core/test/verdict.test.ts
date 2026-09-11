import { describe, expect, it } from "vitest";

import { evaluateVerdict, validateWaivers, type Observation } from "../src/derive/verdict.ts";
import { DEFAULT_VERDICT_POLICY, VerdictPolicy } from "../src/schema/policy.ts";

const clean = (source: Observation["source"], extra: Partial<Observation> = {}): Observation => ({
  source,
  collected: true,
  errors: [],
  ...extra,
});

/** Every channel reporting what a successful dispatch should look like. */
const nominalPass: Observation[] = [
  clean("screenshot", { matchedExpectation: true }),
  clean("browser_console"),
  clean("browser_network", { status: 200 }),
  clean("db_records", { intendedChanges: 1, residualChanges: 0 }),
  clean("app_log"),
  clean("db_log"),
];

/** Every channel reporting what a correctly rejected request should look like. */
const errorPass: Observation[] = [
  clean("screenshot", { matchedExpectation: true, errors: ["not authorised"] }),
  clean("browser_console"),
  clean("browser_network", { status: 401 }),
  clean("db_records", { intendedChanges: 0, residualChanges: 0 }),
  clean("app_log", { errors: ["rejected: missing credentials"], matchedExpectation: true }),
  clean("db_log"),
];

describe("evaluateVerdict, success cases", () => {
  it("passes when every channel agrees", () => {
    const result = evaluateVerdict(DEFAULT_VERDICT_POLICY, "nominal", nominalPass);
    expect(result.verdict).toBe("pass");
    expect(result.failures).toEqual([]);
  });

  it("fails when the service logged an exception behind a correct-looking page", () => {
    const observations = nominalPass.map((observation) =>
      observation.source === "app_log"
        ? { ...observation, errors: ["NullPointer in dispatch worker"] }
        : observation,
    );
    const result = evaluateVerdict(DEFAULT_VERDICT_POLICY, "nominal", observations);
    expect(result.verdict).toBe("fail");
    expect(result.failures.map((failure) => failure.source)).toEqual(["app_log"]);
  });

  it("fails when the page looks right but nothing was written", () => {
    const observations = nominalPass.map((observation) =>
      observation.source === "db_records" ? { ...observation, intendedChanges: 0 } : observation,
    );
    const result = evaluateVerdict(DEFAULT_VERDICT_POLICY, "nominal", observations);
    expect(result.verdict).toBe("fail");
    expect(result.failures[0]?.why).toMatch(/intended data change/);
  });

  it("fails when the API did not return a success status", () => {
    const observations = nominalPass.map((observation) =>
      observation.source === "browser_network" ? { ...observation, status: 500 } : observation,
    );
    expect(evaluateVerdict(DEFAULT_VERDICT_POLICY, "nominal", observations).verdict).toBe("fail");
  });
});

describe("evaluateVerdict, rejection cases", () => {
  it("passes when the expected rejection is visible on every channel", () => {
    expect(evaluateVerdict(DEFAULT_VERDICT_POLICY, "error", errorPass).verdict).toBe("pass");
  });

  it("fails when the request was accepted instead of rejected", () => {
    const observations = errorPass.map((observation) =>
      observation.source === "browser_network" ? { ...observation, status: 200 } : observation,
    );
    expect(evaluateVerdict(DEFAULT_VERDICT_POLICY, "error", observations).verdict).toBe("fail");
  });

  it("fails when rows were left behind by a failed rollback", () => {
    const observations = errorPass.map((observation) =>
      observation.source === "db_records" ? { ...observation, residualChanges: 2 } : observation,
    );
    const result = evaluateVerdict(DEFAULT_VERDICT_POLICY, "error", observations);
    expect(result.verdict).toBe("fail");
    expect(result.failures[0]?.why).toMatch(/unintended change/);
  });

  it("fails when an error occurred but not the expected one", () => {
    const observations = errorPass.map((observation) =>
      observation.source === "app_log"
        ? { ...observation, errors: ["disk full"], matchedExpectation: false }
        : observation,
    );
    const result = evaluateVerdict(DEFAULT_VERDICT_POLICY, "error", observations);
    expect(result.verdict).toBe("fail");
    expect(result.failures[0]?.why).toMatch(/not the expected one/);
  });

  it("fails when the system stayed silent instead of rejecting", () => {
    const observations = errorPass.map((observation) =>
      observation.source === "app_log" ? { ...observation, errors: [] } : observation,
    );
    const result = evaluateVerdict(DEFAULT_VERDICT_POLICY, "error", observations);
    expect(result.verdict).toBe("fail");
    expect(result.failures[0]?.why).toMatch(/no error was reported/);
  });
});

describe("VerdictPolicy", () => {
  it("requires every channel to be given a meaning, so none is ignored by accident", () => {
    expect(() =>
      VerdictPolicy.parse({
        id: "partial",
        title: "omits a channel",
        rules: { nominal: { screenshot: "matches_expectation" }, error: {} },
      }),
    ).toThrow();
  });
});

describe("evaluateVerdict, insufficient evidence", () => {
  it("never passes a run whose only evidence is a screenshot", () => {
    const result = evaluateVerdict(DEFAULT_VERDICT_POLICY, "nominal", [
      clean("screenshot", { matchedExpectation: true }),
    ]);
    expect(result.verdict).toBe("inconclusive");
    expect(result.missing).toContain("app_log");
  });

  it("reports a channel that could not be read as missing, not as clean", () => {
    const observations = nominalPass.map((observation) =>
      observation.source === "db_log" ? { ...observation, collected: false } : observation,
    );
    const result = evaluateVerdict(DEFAULT_VERDICT_POLICY, "nominal", observations);
    expect(result.verdict).toBe("inconclusive");
    expect(result.missing).toEqual(["db_log"]);
  });

  it("prefers a failure over an inconclusive when both apply", () => {
    const observations = nominalPass
      .map((observation) =>
        observation.source === "app_log" ? { ...observation, errors: ["boom"] } : observation,
      )
      .filter((observation) => observation.source !== "db_log");
    const result = evaluateVerdict(DEFAULT_VERDICT_POLICY, "nominal", observations);
    expect(result.verdict).toBe("fail");
  });

  it("stays inconclusive when a weakened policy leaves only a screenshot deciding", () => {
    const weak = VerdictPolicy.parse({
      id: "weak",
      title: "screenshot only",
      rules: {
        nominal: {
          screenshot: "matches_expectation",
          browser_console: "informational",
          browser_network: "informational",
          db_records: "informational",
          app_log: "informational",
          db_log: "informational",
        },
        error: {
          screenshot: "expected_error",
          browser_console: "informational",
          browser_network: "informational",
          db_records: "informational",
          app_log: "informational",
          db_log: "informational",
        },
      },
    });
    const result = evaluateVerdict(weak, "nominal", [
      clean("screenshot", { matchedExpectation: true }),
    ]);
    expect(result.verdict).toBe("inconclusive");
    expect(result.decidedBy).toEqual(["screenshot"]);
  });

  it("names the channels that carried the decision", () => {
    const result = evaluateVerdict(DEFAULT_VERDICT_POLICY, "nominal", nominalPass);
    expect(result.decidedBy).toEqual([
      "screenshot",
      "browser_console",
      "browser_network",
      "db_records",
      "app_log",
      "db_log",
    ]);
  });
});

describe("evidence waivers", () => {
  it("judges a case without a channel it was excused from", () => {
    const withoutDbLog = nominalPass.filter((observation) => observation.source !== "db_log");
    const result = evaluateVerdict(DEFAULT_VERDICT_POLICY, "nominal", withoutDbLog, [
      { source: "db_log", reason: "this deployment does not expose the database log" },
    ]);
    expect(result.verdict).toBe("pass");
    expect(result.waived.map((waiver) => waiver.source)).toEqual(["db_log"]);
  });

  it("refuses to excuse a case from client-side errors", () => {
    const result = evaluateVerdict(DEFAULT_VERDICT_POLICY, "nominal", nominalPass, [
      { source: "browser_console", reason: "the console is noisy" },
    ]);
    expect(result.verdict).toBe("fail");
    expect(result.failures[0]?.why).toMatch(/cannot be waived/);
  });

  it("refuses to excuse a case from server-side errors", () => {
    const result = evaluateVerdict(DEFAULT_VERDICT_POLICY, "nominal", nominalPass, [
      { source: "app_log", reason: "the log is hard to read" },
    ]);
    expect(result.verdict).toBe("fail");
  });

  it("refuses to excuse a case from data integrity", () => {
    const result = evaluateVerdict(DEFAULT_VERDICT_POLICY, "nominal", nominalPass, [
      { source: "db_records", reason: "checking rows is slow" },
    ]);
    expect(result.verdict).toBe("fail");
  });

  it("still refuses to pass on a screenshot once everything waivable is waived", () => {
    const result = evaluateVerdict(
      DEFAULT_VERDICT_POLICY,
      "nominal",
      [clean("screenshot", { matchedExpectation: true })],
      [
        { source: "browser_network", reason: "no network activity in this case" },
        { source: "db_log", reason: "unavailable" },
      ],
    );
    expect(result.verdict).not.toBe("pass");
  });

  it("reports impermissible waivers before a run, not during one", () => {
    const problems = validateWaivers(DEFAULT_VERDICT_POLICY, [
      { source: "db_log", reason: "unavailable" },
      { source: "app_log", reason: "noisy" },
    ]);
    expect(problems.map((problem) => problem.source)).toEqual(["app_log"]);
  });

  it("accepts a set of waivers the policy permits", () => {
    expect(
      validateWaivers(DEFAULT_VERDICT_POLICY, [{ source: "db_log", reason: "unavailable" }]),
    ).toEqual([]);
  });
});
