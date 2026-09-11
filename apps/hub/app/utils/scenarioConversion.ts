import type { Scenario, Step } from "@agentic-test-hub/core";

import type { ScenarioDraft, StepDraft } from "~/components/ScenarioEditor.vue";

/** A blank step draft, defaulting to an observing step (no action). */
export function newStepDraft(): StepDraft {
  return {
    id: "",
    summary: "",
    targetSurface: "",
    targetAction: "",
    actionOperation: "",
    actionParams: "{}",
    expect: [newExpectationDraft()],
    polarity: "nominal",
    dependsOn: [],
    produces: [],
    viewpoints: [],
    note: "",
  };
}

/** A blank scenario draft, for the "new scenario" page. */
export function emptyScenarioDraft(): ScenarioDraft {
  return {
    id: "",
    title: "",
    preconditions: [],
    steps: [newStepDraft()],
    evidenceEnabled: false,
    evidenceSources: [],
    evidenceTiming: "after",
    evidenceTrace: "on_failure",
    evidenceIgnore: [],
    evidenceWaivers: [],
    tags: [],
    appliesToCommit: "",
    appliesToBranch: "",
    appliesToRelease: "",
    viewpoints: [],
    note: "",
  };
}

function stepDraftFromEntity(step: Step): StepDraft {
  return {
    id: step.id,
    summary: step.summary,
    targetSurface: step.target?.surface ?? "",
    targetAction: step.target?.action ?? "",
    actionOperation: step.action?.operation ?? "",
    actionParams: JSON.stringify(step.action?.params ?? {}, null, 2),
    expect: step.expect.map(expectationDraftFromEntity),
    polarity: step.polarity,
    dependsOn: [...step.dependsOn],
    produces: Object.entries(step.produces).map(([name, expression]) => ({ name, expression })),
    viewpoints: [...step.viewpoints],
    note: step.note ?? "",
  };
}

/** Converts a loaded scenario into its editable draft form. */
export function scenarioDraftFromEntity(entity: Scenario): ScenarioDraft {
  return {
    id: entity.id,
    title: entity.title,
    preconditions: [...entity.preconditions],
    steps: entity.steps.map(stepDraftFromEntity),
    evidenceEnabled: entity.evidence !== undefined,
    evidenceSources: entity.evidence?.sources ?? [],
    evidenceTiming: entity.evidence?.timing ?? "after",
    evidenceTrace: entity.evidence?.trace ?? "on_failure",
    evidenceIgnore: entity.evidence?.ignore ?? [],
    evidenceWaivers: entity.evidenceWaivers.map((waiver) => ({ ...waiver })),
    tags: [...entity.tags],
    appliesToCommit: entity.appliesTo?.commit ?? "",
    appliesToBranch: entity.appliesTo?.branch ?? "",
    appliesToRelease: entity.appliesTo?.release ?? "",
    viewpoints: [...entity.viewpoints],
    note: entity.note ?? "",
  };
}

function stepDraftToEntity(step: StepDraft): unknown {
  return {
    id: step.id,
    summary: step.summary,
    ...(step.targetSurface === ""
      ? {}
      : {
          target: {
            surface: step.targetSurface,
            ...(step.targetAction === "" ? {} : { action: step.targetAction }),
          },
        }),
    ...(step.actionOperation === ""
      ? {}
      : { action: { operation: step.actionOperation, params: JSON.parse(step.actionParams) } }),
    expect: step.expect.map(expectationToEntity),
    polarity: step.polarity,
    dependsOn: step.dependsOn,
    produces: Object.fromEntries(step.produces.map((entry) => [entry.name, entry.expression])),
    viewpoints: step.viewpoints,
    ...(step.note === "" ? {} : { note: step.note }),
  };
}

/** Converts a scenario draft back into the shape the schema expects. */
export function scenarioDraftToEntity(draft: ScenarioDraft): unknown {
  return {
    id: draft.id,
    title: draft.title,
    preconditions: draft.preconditions,
    steps: draft.steps.map(stepDraftToEntity),
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
    viewpoints: draft.viewpoints,
    ...(draft.note === "" ? {} : { note: draft.note }),
  };
}
