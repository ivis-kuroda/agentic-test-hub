import type { Assertion, Expectation } from "@agentic-test-hub/core";

/**
 * The expectation form's fields, as a plain editable shape.
 *
 * `Expectation` is a discriminated union in the schema (seven kinds, each
 * with its own fields); every draft entry carries every kind's fields and
 * only the ones the chosen `kind` needs are shown or converted. Shared by
 * the case and scenario editors, since a step's `expect` and a case's
 * `expect` are the same schema type.
 */
export type ExpectationKind =
  | "http_status"
  | "text"
  | "error_message"
  | "stdout_contains"
  | "operation_result"
  | "result"
  | "ai_judgement"
  | "unspecified";

export interface ExpectationDraft {
  kind: ExpectationKind;
  viewpoints: string[];
  knownDeviation: string;
  status: string;
  /** Comma-separated extra statuses that also satisfy an `http_status`. */
  alsoAccepts: string;
  value: string;
  match: "exact" | "contains" | "regex";
  scope: string;
  stream: "both" | "stdout" | "stderr";
  operation: string;
  params: string;
  assertKind:
    | "equals"
    | "contains"
    | "matches"
    | "keys"
    | "one_of"
    | "compare"
    | "row_count"
    | "natural";
  /** Dotted path into the result an assertion judges; blank judges the default subject. */
  assertAt: string;
  assertOp: "lt" | "lte" | "gt" | "gte";
  /** JSON array text, for the `keys` and `one_of` assertions. */
  assertList: string;
  assertValueText: string;
  assertContains: string;
  assertPattern: string;
  assertCount: string;
  assertNatural: string;
  aspect: "visual" | "semantic";
  unspecifiedText: string;
}

/** A blank expectation draft, defaulting to an http_status check. */
export function newExpectationDraft(): ExpectationDraft {
  return {
    kind: "http_status",
    viewpoints: [],
    knownDeviation: "",
    status: "200",
    alsoAccepts: "",
    value: "",
    match: "contains",
    scope: "",
    stream: "both",
    operation: "",
    params: "{}",
    assertKind: "contains",
    assertAt: "",
    assertOp: "lte",
    assertList: "[]",
    assertValueText: "",
    assertContains: "",
    assertPattern: "",
    assertCount: "0",
    assertNatural: "",
    aspect: "visual",
    unspecifiedText: "",
  };
}

function applyAssertionToDraft(draft: ExpectationDraft, assertion: Assertion): void {
  draft.assertKind = assertion.kind;
  if ("at" in assertion) draft.assertAt = assertion.at ?? "";
  switch (assertion.kind) {
    case "equals":
      draft.assertValueText = stringifyLevelValue(assertion.value);
      break;
    case "contains":
      draft.assertContains = assertion.value;
      break;
    case "matches":
      draft.assertPattern = assertion.pattern;
      break;
    case "keys":
      draft.assertList = JSON.stringify(assertion.value);
      break;
    case "one_of":
      draft.assertList = JSON.stringify(assertion.values);
      break;
    case "compare":
      draft.assertOp = assertion.op;
      draft.assertValueText = String(assertion.value);
      break;
    case "row_count":
      draft.assertCount = String(assertion.count);
      break;
    case "natural":
      draft.assertNatural = assertion.text;
      break;
  }
}

/** Converts a loaded expectation into its editable draft form. */
export function expectationDraftFromEntity(expectation: Expectation): ExpectationDraft {
  const draft = newExpectationDraft();
  draft.kind = expectation.kind;
  draft.viewpoints = [...expectation.viewpoints];
  draft.knownDeviation = expectation.knownDeviation ?? "";

  switch (expectation.kind) {
    case "http_status":
      draft.status = String(expectation.status);
      draft.alsoAccepts = (expectation.alsoAccepts ?? []).join(", ");
      break;
    case "text":
      draft.value = expectation.value;
      draft.match = expectation.match;
      draft.scope = expectation.scope ?? "";
      break;
    case "error_message":
      draft.value = expectation.value;
      draft.match = expectation.match;
      break;
    case "stdout_contains":
      draft.value = expectation.value;
      draft.stream = expectation.stream ?? "both";
      break;
    case "operation_result":
      draft.operation = expectation.operation;
      draft.params = JSON.stringify(expectation.params, null, 2);
      applyAssertionToDraft(draft, expectation.assert);
      break;
    case "result":
      applyAssertionToDraft(draft, expectation.assert);
      break;
    case "ai_judgement":
      draft.aspect = expectation.aspect;
      draft.value = expectation.value;
      break;
    case "unspecified":
      draft.unspecifiedText = expectation.text;
      break;
  }
  return draft;
}

function assertionToEntity(expectation: ExpectationDraft): unknown {
  const at = expectation.assertAt === "" ? {} : { at: expectation.assertAt };
  switch (expectation.assertKind) {
    case "equals":
      return { kind: "equals", value: parseLevelValue(expectation.assertValueText), ...at };
    case "contains":
      return { kind: "contains", value: expectation.assertContains, ...at };
    case "matches":
      return { kind: "matches", pattern: expectation.assertPattern, ...at };
    case "keys":
      return { kind: "keys", value: JSON.parse(expectation.assertList), ...at };
    case "one_of":
      return { kind: "one_of", values: JSON.parse(expectation.assertList), ...at };
    case "compare":
      return {
        kind: "compare",
        op: expectation.assertOp,
        value: Number(expectation.assertValueText),
        ...at,
      };
    case "row_count":
      return { kind: "row_count", count: Number(expectation.assertCount) };
    case "natural":
      return { kind: "natural", text: expectation.assertNatural };
  }
}

/** Converts an expectation draft back into the shape the schema expects. */
export function expectationToEntity(expectation: ExpectationDraft): unknown {
  const shared = {
    viewpoints: expectation.viewpoints,
    ...(expectation.knownDeviation === "" ? {} : { knownDeviation: expectation.knownDeviation }),
  };
  switch (expectation.kind) {
    case "http_status":
      return {
        kind: "http_status",
        status: Number(expectation.status),
        ...(expectation.alsoAccepts.trim() === ""
          ? {}
          : { alsoAccepts: expectation.alsoAccepts.split(",").map((part) => Number(part.trim())) }),
        ...shared,
      };
    case "text":
      return {
        kind: "text",
        value: expectation.value,
        match: expectation.match,
        ...(expectation.scope === "" ? {} : { scope: expectation.scope }),
        ...shared,
      };
    case "error_message":
      return {
        kind: "error_message",
        value: expectation.value,
        match: expectation.match,
        ...shared,
      };
    case "stdout_contains":
      return {
        kind: "stdout_contains",
        value: expectation.value,
        ...(expectation.stream === "both" ? {} : { stream: expectation.stream }),
        ...shared,
      };
    case "operation_result":
      return {
        kind: "operation_result",
        operation: expectation.operation,
        params: JSON.parse(expectation.params),
        assert: assertionToEntity(expectation),
        ...shared,
      };
    case "result":
      return { kind: "result", assert: assertionToEntity(expectation), ...shared };
    case "ai_judgement":
      return {
        kind: "ai_judgement",
        aspect: expectation.aspect,
        value: expectation.value,
        ...shared,
      };
    case "unspecified":
      return { kind: "unspecified", text: expectation.unspecifiedText, ...shared };
  }
}
