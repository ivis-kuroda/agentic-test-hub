import type { EntityKind } from "@agentic-test-hub/store";

/** What loading one entity for editing returns. */
export interface EntityLoad<T> {
  readonly entity: T;
  readonly hash: string;
}

/**
 * Fetches one entity of the given kind, for a page to load into its editor.
 *
 * A thin wrapper over the generic `/api/specs/:kind/:id` route. Kept as a
 * composable rather than inlined per page so the fetch key and error
 * handling are written once for all six entity kinds.
 */
export function useSpecEntity<T>(kind: EntityKind, id: string) {
  return useFetch<EntityLoad<T>>(`/api/specs/${kind}/${id}`);
}

/**
 * Saves one entity of the given kind, creating it if `expectedHash` is
 * omitted and updating it otherwise.
 *
 * @param kind - The entity's kind.
 * @param entity - The entity to write. Validated server-side against its
 *   schema before anything is written.
 * @param expectedHash - The hash last seen for this file. Omit only when
 *   creating; supplying none for an existing file is treated as a conflict,
 *   not as permission to overwrite.
 * @returns Where it was written and the file's new hash.
 * @throws A `$fetch`/`ofetch` error. A `409` carries the file's current
 *   contents in `data.data.current`; see {@link isConflictError}.
 */
export function saveSpecEntity(
  kind: EntityKind,
  entity: unknown,
  expectedHash?: string,
): Promise<{ file: string; hash: string; created: boolean }> {
  // The path is widened to `string` on purpose: left as a template literal,
  // the compiler resolves it against every typed Nitro route, including the
  // suite route whose body is the whole serialised schema, and gives up with
  // "excessive stack depth" once that schema is large enough.
  const path: string = `/api/specs/${kind}`;
  return $fetch<{ file: string; hash: string; created: boolean }>(path, {
    method: "PUT",
    body: { entity, ...(expectedHash === undefined ? {} : { expectedHash }) },
  });
}

/**
 * Removes one entity of the given kind, given the hash last seen for it.
 *
 * @param kind - The entity's kind.
 * @param id - Its identifier.
 * @param expectedHash - The hash last seen for this file.
 */
export function removeSpecEntity(
  kind: EntityKind,
  id: string,
  expectedHash: string,
): Promise<{ file: string }> {
  const path: string = `/api/specs/${kind}/${id}`;
  return $fetch<{ file: string }>(path, {
    method: "DELETE",
    query: { expectedHash },
  });
}
