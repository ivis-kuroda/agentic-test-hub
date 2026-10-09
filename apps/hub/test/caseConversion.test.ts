import { beforeAll, describe, expect, it, vi } from "vitest";

import type { TestCase } from "@agentic-test-hub/core";

import {
  caseDraftFromEntity,
  caseDraftToEntity,
  emptyCaseDraft,
} from "../app/utils/caseConversion.ts";

// Nuxt auto-imports the expectation helpers into app code; outside Nuxt the
// converter finds them as globals.
beforeAll(async () => {
  const drafts = await import("../app/utils/expectationDraft.ts");
  vi.stubGlobal("newExpectationDraft", drafts.newExpectationDraft);
  vi.stubGlobal("expectationDraftFromEntity", drafts.expectationDraftFromEntity);
  vi.stubGlobal("expectationToEntity", drafts.expectationToEntity);
});

describe("case automation conversion", () => {
  it("round-trips not_runnable with its reason and check details", () => {
    const draft = { ...emptyCaseDraft(), id: "TC-X-001", summary: "s", baseline: "BL-X" };
    draft.automationStatus = "not_runnable";
    draft.automationReason = "needs a source change";
    draft.automationCheckedAt = "2026-10-09";
    draft.automationCheckedBy = "code path review";

    const entity = caseDraftToEntity(draft) as { automation: unknown };
    expect(entity.automation).toEqual({
      status: "not_runnable",
      reason: "needs a source change",
      checkedAt: "2026-10-09",
      checkedBy: "code path review",
    });

    const back = caseDraftFromEntity({
      ...(entity as object),
      tags: [],
      expect: [],
    } as unknown as TestCase);
    expect(back.automationReason).toBe("needs a source change");
    expect(back.automationStatus).toBe("not_runnable");
  });

  it("omits the optional automation fields when blank", () => {
    const entity = caseDraftToEntity(emptyCaseDraft()) as { automation: unknown };
    expect(entity.automation).toEqual({ status: "manual" });
  });
});
