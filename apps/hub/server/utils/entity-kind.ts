import { LAYOUTS, type EntityKind } from "@agentic-test-hub/store";

const KNOWN_KINDS = new Set<string>(LAYOUTS.map((layout) => layout.kind));

/**
 * Validates a route's `kind` parameter against the store's known entity
 * kinds, rather than trusting it and letting an unknown one surface as a
 * confusing error from deep inside the store.
 *
 * @param raw - The `kind` route parameter, or `undefined` if missing.
 * @returns The validated kind.
 * @throws An H3 error (400) when `raw` is missing or not a known kind.
 */
export function requireEntityKind(raw: string | undefined): EntityKind {
  if (raw === undefined) {
    throw createError({ statusCode: 400, statusMessage: "kind is required" });
  }
  if (!KNOWN_KINDS.has(raw)) {
    throw createError({
      statusCode: 400,
      statusMessage: `unknown entity kind "${raw}"; expected one of ${[...KNOWN_KINDS].join(", ")}`,
    });
  }
  return raw as EntityKind;
}
