import type { FetchError } from "ofetch";

/** The shape of a conflict error's payload, as sent by the save endpoints. */
export interface ConflictPayload {
  readonly data: { readonly file: string; readonly actualHash: string; readonly current: string };
}

/**
 * Narrows a caught `$fetch` error to a 409 conflict, so a page can offer the
 * "overwrite with my changes" flow instead of a generic error message.
 */
export function isConflictError(cause: unknown): cause is FetchError & { data: ConflictPayload } {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "statusCode" in cause &&
    (cause as { statusCode?: number }).statusCode === 409
  );
}

/** Reads a readable message out of whatever `$fetch` threw. */
export function extractErrorMessage(cause: unknown): string {
  if (typeof cause === "object" && cause !== null && "statusMessage" in cause) {
    const message = (cause as { statusMessage?: unknown }).statusMessage;
    if (typeof message === "string" && message !== "") return message;
  }
  return cause instanceof Error ? cause.message : "Something went wrong.";
}
