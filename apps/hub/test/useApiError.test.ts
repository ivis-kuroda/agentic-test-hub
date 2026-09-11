import { describe, expect, it } from "vitest";

import { extractErrorMessage, isConflictError } from "../app/composables/useApiError.ts";

describe("isConflictError", () => {
  it("recognises a 409 as a conflict", () => {
    expect(isConflictError({ statusCode: 409 })).toBe(true);
  });

  it("does not treat another status as a conflict", () => {
    expect(isConflictError({ statusCode: 400 })).toBe(false);
    expect(isConflictError({ statusCode: 500 })).toBe(false);
  });

  it("does not treat an unrelated value as a conflict", () => {
    expect(isConflictError(new Error("boom"))).toBe(false);
    expect(isConflictError(null)).toBe(false);
    expect(isConflictError(undefined)).toBe(false);
    expect(isConflictError("409")).toBe(false);
  });
});

describe("extractErrorMessage", () => {
  it("prefers a fetch error's statusMessage", () => {
    expect(extractErrorMessage({ statusMessage: "changed since it was read" })).toBe(
      "changed since it was read",
    );
  });

  it("falls back to a plain Error's message", () => {
    expect(extractErrorMessage(new Error("network down"))).toBe("network down");
  });

  it("falls back to a generic message for anything else", () => {
    expect(extractErrorMessage("a plain string")).toBe("Something went wrong.");
    expect(extractErrorMessage(undefined)).toBe("Something went wrong.");
  });

  it("ignores an empty statusMessage rather than surfacing nothing", () => {
    expect(extractErrorMessage({ statusMessage: "" })).toBe("Something went wrong.");
  });
});
