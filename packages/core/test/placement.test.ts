import { describe, expect, it } from "vitest";

import { derivePlacement, matchLevel } from "../src/derive/placement.js";
import {
  authFactor,
  baseline,
  caseBaselineEmail,
  caseNoAuth,
  caseRetryOff,
  caseSms,
  factors,
  makeCase,
} from "./fixtures.js";

describe("matchLevel", () => {
  it("matches a present value to the level holding it", () => {
    expect(matchLevel(authFactor, true, "expired-token")?.id).toBe("L-EXPIRED");
  });

  it("matches an absent value to the level marked absent", () => {
    expect(matchLevel(authFactor, false, undefined)?.id).toBe("L-ABSENT");
  });

  it("does not match an absent value to a level whose value is undefined", () => {
    expect(matchLevel(authFactor, true, undefined)).toBeUndefined();
  });

  it("returns undefined when no level describes the value", () => {
    expect(matchLevel(authFactor, true, "some-other-token")).toBeUndefined();
  });
});

describe("derivePlacement", () => {
  it("places a case with no overrides at the baseline levels", () => {
    expect(derivePlacement(caseBaselineEmail, baseline, factors)).toEqual({
      "F-AUTH": "L-VALID",
      "F-CHANNEL": "L-EMAIL",
      "F-RETRY": "L-ON",
    });
  });

  it("moves the case on the axis its override addresses", () => {
    const placement = derivePlacement(caseSms, baseline, factors);
    expect(placement["F-CHANNEL"]).toBe("L-SMS");
    expect(placement["F-AUTH"]).toBe("L-VALID");
  });

  it("places a removed field on the absent level", () => {
    expect(derivePlacement(caseNoAuth, baseline, factors)["F-AUTH"]).toBe("L-ABSENT");
  });

  it("places configuration overrides too", () => {
    expect(derivePlacement(caseRetryOff, baseline, factors)["F-RETRY"]).toBe("L-OFF");
  });

  it("omits a factor whose value matches no declared level", () => {
    const odd = makeCase({
      id: "TC-DISPATCH-020",
      summary: "an undeclared channel",
      overrides: [{ path: "context.body.channel", op: "set", value: "carrier-pigeon" }],
    });
    expect(derivePlacement(odd, baseline, factors)).not.toHaveProperty("F-CHANNEL");
  });

  it("prefers an explicit declaration over the derived value", () => {
    const declared = makeCase({
      id: "TC-DISPATCH-021",
      summary: "placement stated rather than derived",
      overrides: [{ path: "context.body.channel", op: "set", value: "sms" }],
      at: { "F-CHANNEL": "L-PUSH" },
    });
    expect(derivePlacement(declared, baseline, factors)["F-CHANNEL"]).toBe("L-PUSH");
  });

  it("skips factors that name no path", () => {
    const pathless = { ...authFactor, path: undefined };
    expect(derivePlacement(caseBaselineEmail, baseline, [pathless])).toEqual({});
  });
});
