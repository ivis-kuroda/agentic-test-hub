import type { TestCase } from "@agentic-test-hub/core";

import type { CaseDraft, ExpectationDraft } from "~/components/CaseEditor.vue";

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

/** A blank case draft, for the "new case" page. */
export function emptyCaseDraft(): CaseDraft {
  return {
    id: "",
    summary: "",
    baseline: "",
    overrides: [],
    targetSurface: "",
    targetAction: "",
    expect: [newExpectationDraft()],
    polarity: "nominal",
    evidenceEnabled: false,
    evidenceSources: [],
    evidenceTiming: "after",
    evidenceTrace: "on_failure",
    evidenceIgnore: [],
    evidenceWaivers: [],
    at: [],
    isolation: "",
    priority: "P2",
    tags: [],
    appliesToCommit: "",
    appliesToBranch: "",
    appliesToRelease: "",
    automationStatus: "manual",
    automationImpl: "",
    viewpoints: [],
    note: "",
  };
}

function expectationDraftFromEntity(expectation: TestCase["expect"][number]): ExpectationDraft {
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

/** Converts a loaded test case into its editable draft form. */
export function caseDraftFromEntity(entity: TestCase): CaseDraft {
  return {
    id: entity.id,
    summary: entity.summary,
    baseline: entity.baseline,
    overrides: entity.overrides.map((override) => ({
      path: override.path,
      op: override.op,
      value: override.op === "remove" ? "" : stringifyLevelValue(override.value),
    })),
    targetSurface: entity.target?.surface ?? "",
    targetAction: entity.target?.action ?? "",
    expect: entity.expect.map(expectationDraftFromEntity),
    polarity: entity.polarity,
    evidenceEnabled: entity.evidence !== undefined,
    evidenceSources: entity.evidence?.sources ?? [],
    evidenceTiming: entity.evidence?.timing ?? "after",
    evidenceTrace: entity.evidence?.trace ?? "on_failure",
    evidenceIgnore: entity.evidence?.ignore ?? [],
    evidenceWaivers: entity.evidenceWaivers.map((waiver) => ({ ...waiver })),
    at: Object.entries(entity.at ?? {}).map(([factorId, levelId]) => ({ factorId, levelId })),
    isolation: entity.isolation ?? "",
    priority: entity.priority,
    tags: [...entity.tags],
    appliesToCommit: entity.appliesTo?.commit ?? "",
    appliesToBranch: entity.appliesTo?.branch ?? "",
    appliesToRelease: entity.appliesTo?.release ?? "",
    automationStatus: entity.automation.status,
    automationImpl: entity.automation.impl ?? "",
    viewpoints: [...entity.viewpoints],
    note: entity.note ?? "",
  };
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

function expectationToEntity(expectation: ExpectationDraft): unknown {
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

/** Converts a case draft back into the shape the schema expects. */
export function caseDraftToEntity(draft: CaseDraft): unknown {
  return {
    id: draft.id,
    summary: draft.summary,
    baseline: draft.baseline,
    overrides: draft.overrides.map((override) => ({
      path: override.path,
      op: override.op,
      ...(override.op === "remove" ? {} : { value: parseLevelValue(override.value) }),
    })),
    ...(draft.targetSurface === ""
      ? {}
      : {
          target: {
            surface: draft.targetSurface,
            ...(draft.targetAction === "" ? {} : { action: draft.targetAction }),
          },
        }),
    expect: draft.expect.map(expectationToEntity),
    polarity: draft.polarity,
    ...(draft.evidenceEnabled
      ? {
          evidence: {
            sources: draft.evidenceSources,
            timing: draft.evidenceTiming,
            trace: draft.evidenceTrace,
            ignore: draft.evidenceIgnore,
          },
        }
      : {}),
    evidenceWaivers: draft.evidenceWaivers,
    ...(draft.at.length === 0
      ? {}
      : { at: Object.fromEntries(draft.at.map((term) => [term.factorId, term.levelId])) }),
    ...(draft.isolation === "" ? {} : { isolation: draft.isolation }),
    priority: draft.priority,
    tags: draft.tags,
    ...(draft.appliesToCommit === "" &&
    draft.appliesToBranch === "" &&
    draft.appliesToRelease === ""
      ? {}
      : {
          appliesTo: {
            ...(draft.appliesToCommit === "" ? {} : { commit: draft.appliesToCommit }),
            ...(draft.appliesToBranch === "" ? {} : { branch: draft.appliesToBranch }),
            ...(draft.appliesToRelease === "" ? {} : { release: draft.appliesToRelease }),
          },
        }),
    automation: {
      status: draft.automationStatus,
      ...(draft.automationImpl === "" ? {} : { impl: draft.automationImpl }),
    },
    viewpoints: draft.viewpoints,
    ...(draft.note === "" ? {} : { note: draft.note }),
  };
}
