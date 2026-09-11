import type { Expectation } from "@agentic-test-hub/core";

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
  | "ai_judgement"
  | "unspecified";

export interface ExpectationDraft {
  kind: ExpectationKind;
  viewpoints: string[];
  knownDeviation: string;
  status: string;
  value: string;
  match: "exact" | "contains" | "regex";
  scope: string;
  stream: "" | "stdout" | "stderr";
  operation: string;
  params: string;
  assertKind: "equals" | "contains" | "matches" | "row_count" | "natural";
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
    value: "",
    match: "contains",
    scope: "",
    stream: "",
    operation: "",
    params: "{}",
    assertKind: "contains",
    assertValueText: "",
    assertContains: "",
    assertPattern: "",
    assertCount: "0",
    assertNatural: "",
    aspect: "visual",
    unspecifiedText: "",
  };
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
      draft.stream = expectation.stream ?? "";
      break;
    case "operation_result":
      draft.operation = expectation.operation;
      draft.params = JSON.stringify(expectation.params, null, 2);
      draft.assertKind = expectation.assert.kind;
      switch (expectation.assert.kind) {
        case "equals":
          draft.assertValueText = stringifyLevelValue(expectation.assert.value);
          break;
        case "contains":
          draft.assertContains = expectation.assert.value;
          break;
        case "matches":
          draft.assertPattern = expectation.assert.pattern;
          break;
        case "row_count":
          draft.assertCount = String(expectation.assert.count);
          break;
        case "natural":
          draft.assertNatural = expectation.assert.text;
          break;
      }
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
  switch (expectation.assertKind) {
    case "equals":
      return { kind: "equals", value: parseLevelValue(expectation.assertValueText) };
    case "contains":
      return { kind: "contains", value: expectation.assertContains };
    case "matches":
      return { kind: "matches", pattern: expectation.assertPattern };
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
      return { kind: "http_status", status: Number(expectation.status), ...shared };
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
        ...(expectation.stream === "" ? {} : { stream: expectation.stream }),
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
