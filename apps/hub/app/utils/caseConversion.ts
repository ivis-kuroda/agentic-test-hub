import type { TestCase } from "@agentic-test-hub/core";

import type { CaseDraft } from "~/components/CaseEditor.vue";

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
