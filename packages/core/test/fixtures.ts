/**
 * Sample specification data for the core's own tests.
 *
 * The domain is fictional and deliberately unrelated to any real target
 * system. The hub must not acquire knowledge of the application it happens to
 * be pointed at first, and tests written against a real target are the
 * easiest way for that knowledge to creep in.
 *
 * The subject is a notification dispatch service: a request carries
 * credentials and names a delivery channel.
 */
import { Baseline } from "../src/schema/baseline.js";
import { TestCase } from "../src/schema/case.js";
import { Factor } from "../src/schema/factor.js";
import { Matrix } from "../src/schema/matrix.js";
import { Viewpoint } from "../src/schema/viewpoint.js";

/** The standard dispatch request every case in the family varies. */
export const baseline = Baseline.parse({
  id: "BL-DISPATCH-STD",
  title: "standard dispatch request",
  target: { surface: "Dispatch API", action: "send notification" },
  preconditions: ["queue.empty", "recipient.exists"],
  config: { RETRY_ENABLED: true },
  context: {
    headers: { Authorization: "valid-token", "Idempotency-Key": "key-1" },
    body: { channel: "email", priority: "normal" },
  },
  action: { operation: "OP-DISPATCH-SEND", params: {} },
});

/** Whether the request carries usable credentials. */
export const authFactor = Factor.parse({
  id: "F-AUTH",
  name: "credentials",
  path: "context.headers.Authorization",
  levels: [
    { id: "L-VALID", name: "valid", value: "valid-token" },
    { id: "L-EXPIRED", name: "expired", value: "expired-token" },
    { id: "L-ABSENT", name: "not sent", absent: true },
  ],
});

/** Which delivery channel the request asks for. */
export const channelFactor = Factor.parse({
  id: "F-CHANNEL",
  name: "channel",
  path: "context.body.channel",
  levels: [
    { id: "L-EMAIL", name: "email", value: "email" },
    { id: "L-SMS", name: "sms", value: "sms" },
    { id: "L-PUSH", name: "push", value: "push" },
  ],
});

/** Whether the service retries transient delivery failures. */
export const retryFactor = Factor.parse({
  id: "F-RETRY",
  name: "retry",
  path: "config.RETRY_ENABLED",
  levels: [
    { id: "L-ON", name: "enabled", value: true },
    { id: "L-OFF", name: "disabled", value: false },
  ],
});

export const factors = [authFactor, channelFactor, retryFactor];

/** Credentials must be checked before anything is delivered. */
export const authViewpoint = Viewpoint.parse({
  id: "VP-AUTH",
  title: "requests without usable credentials are rejected",
  rationale: "an unauthenticated caller must not be able to send anything",
  source: [{ kind: "design", ref: "dispatch service design, section 2" }],
  risk: "high",
});

/** A claim nothing in the sample suite establishes. */
export const auditViewpoint = Viewpoint.parse({
  id: "VP-AUDIT",
  title: "every dispatch attempt is recorded",
  rationale: "operators need to reconstruct what was sent",
  source: [{ kind: "design", ref: "dispatch service design, section 6" }],
  risk: "medium",
});

export const viewpoints = [authViewpoint, auditViewpoint];

/** Builds a case varying the baseline, with sensible defaults. */
export function makeCase(input: Partial<Record<string, unknown>>): TestCase {
  return TestCase.parse({
    baseline: "BL-DISPATCH-STD",
    expect: [{ kind: "http_status", status: 200 }],
    ...input,
  });
}

/** The baseline itself: valid credentials, email channel, retry on. */
export const caseBaselineEmail = makeCase({
  id: "TC-DISPATCH-001",
  summary: "the standard request is accepted",
  overrides: [],
  viewpoints: ["VP-AUTH"],
});

/** Same request sent over SMS instead. */
export const caseSms = makeCase({
  id: "TC-DISPATCH-002",
  summary: "the request is accepted on the sms channel",
  overrides: [{ path: "context.body.channel", op: "set", value: "sms" }],
});

/** Credentials omitted entirely. */
export const caseNoAuth = makeCase({
  id: "TC-DISPATCH-003",
  summary: "a request without credentials is rejected",
  overrides: [{ path: "context.headers.Authorization", op: "remove" }],
  polarity: "error",
  expect: [{ kind: "http_status", status: 401, viewpoints: ["VP-AUTH"] }],
});

/** Retry disabled, which changes global configuration. */
export const caseRetryOff = makeCase({
  id: "TC-DISPATCH-004",
  summary: "delivery is not retried when retry is disabled",
  overrides: [{ path: "config.RETRY_ENABLED", op: "set", value: false }],
});

export const cases = [caseBaselineEmail, caseSms, caseNoAuth, caseRetryOff];

/** Credentials against channel, with one reasoned exclusion. */
export const matrix = Matrix.parse({
  id: "MX-DISPATCH",
  title: "credentials against delivery channel",
  axes: { rows: "F-AUTH", cols: "F-CHANNEL" },
  strategy: "single_factor",
  exclusions: [
    {
      when: { "F-AUTH": "L-ABSENT", "F-CHANNEL": "L-PUSH" },
      reason: "push delivery is unreachable before credentials are checked",
    },
  ],
});
