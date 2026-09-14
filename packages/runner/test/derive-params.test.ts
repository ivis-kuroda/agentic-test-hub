import { describe, expect, it } from "vitest";

import type { Override, ResolvedBaseline } from "@agentic-test-hub/core";

import { deriveActionParams } from "../src/derive-params.ts";
import { manifest } from "./harness.ts";

const opSend = manifest.operations["OP-SEND"]!; // http, params: [channel]

const resolved = (over: Partial<ResolvedBaseline> = {}): ResolvedBaseline => ({
  target: undefined,
  preconditions: [],
  config: {},
  context: {},
  action: { operation: "OP-SEND", params: {} },
  ...over,
});

describe("deriveActionParams", () => {
  it("derives a param from context.body when its name matches a declared param", () => {
    const override: Override = { path: "context.body.channel", op: "set", value: "sms" };
    const derivation = deriveActionParams(
      [override],
      resolved({ context: { body: { channel: "sms" } } }),
      "OP-SEND",
      opSend,
    );
    expect(derivation.ok).toBe(true);
    expect(derivation.params["channel"]).toBe("sms");
    expect(derivation.unexpressible).toEqual([]);
  });

  it("derives a param from context directly, not only from context.body", () => {
    const override: Override = { path: "context.channel", op: "set", value: "sms" };
    const derivation = deriveActionParams(
      [override],
      resolved({ context: { channel: "sms" } }),
      "OP-SEND",
      opSend,
    );
    expect(derivation.ok).toBe(true);
    expect(derivation.params["channel"]).toBe("sms");
  });

  it("refuses an override that touches a path no declared param names", () => {
    const override: Override = {
      path: "context.headers.Authorization",
      op: "remove",
    };
    const derivation = deriveActionParams(
      [override],
      resolved({ context: { headers: {} } }),
      "OP-SEND",
      opSend,
    );
    expect(derivation.ok).toBe(false);
    expect(derivation.unexpressible).toHaveLength(1);
    expect(derivation.unexpressible[0]?.path).toBe("context.headers.Authorization");
    expect(derivation.unexpressible[0]?.why).toContain("Authorization");
    expect(derivation.unexpressible[0]?.why).toContain("OP-SEND");
  });

  it("always covers an override under action.params", () => {
    const override: Override = { path: "action.params.channel", op: "set", value: "sms" };
    const derivation = deriveActionParams(
      [override],
      resolved({ action: { operation: "OP-SEND", params: { channel: "sms" } } }),
      "OP-SEND",
      opSend,
    );
    expect(derivation.ok).toBe(true);
    expect(derivation.params["channel"]).toBe("sms");
  });

  it("never covers an override under config", () => {
    const override: Override = { path: "config.DIGEST_VERIFICATION", op: "set", value: false };
    const derivation = deriveActionParams(
      [override],
      resolved({ config: { DIGEST_VERIFICATION: false } }),
      "OP-SEND",
      opSend,
    );
    expect(derivation.ok).toBe(false);
    expect(derivation.unexpressible[0]?.why).toContain("config is never read");
  });

  it("refuses an ambiguous param present at both locations with different values", () => {
    const override: Override = { path: "context.body.channel", op: "set", value: "sms" };
    const derivation = deriveActionParams(
      [override],
      resolved({ context: { channel: "email", body: { channel: "sms" } } }),
      "OP-SEND",
      opSend,
    );
    expect(derivation.ok).toBe(false);
    expect(derivation.unexpressible[0]?.why).toMatch(/different values/);
    expect(derivation.params["channel"]).toBeUndefined();
  });

  it("is ok with no overrides at all, deriving params purely from the baseline", () => {
    const derivation = deriveActionParams(
      [],
      resolved({ context: { body: { channel: "email" } } }),
      "OP-SEND",
      opSend,
    );
    expect(derivation.ok).toBe(true);
    expect(derivation.params["channel"]).toBe("email");
  });
});
