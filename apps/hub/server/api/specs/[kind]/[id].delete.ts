import { ConflictError } from "@agentic-test-hub/store";

/**
 * Removes one entity of the given kind, given the hash last seen for it.
 *
 * Deletion goes through the same optimistic-lock check as a save: removing a
 * file someone else just changed is exactly the mistake the lock exists to
 * prevent.
 */
export default defineEventHandler(async (event) => {
  const kind = requireEntityKind(getRouterParam(event, "kind"));
  const id = getRouterParam(event, "id");
  if (id === undefined) throw createError({ statusCode: 400, statusMessage: "id is required" });

  const expectedHash = getQuery(event)["expectedHash"];
  if (typeof expectedHash !== "string") {
    throw createError({
      statusCode: 400,
      statusMessage: "expectedHash query parameter is required",
    });
  }

  const store = useStore();
  try {
    return await store.remove(kind, id, expectedHash);
  } catch (cause) {
    if (cause instanceof ConflictError) {
      throw createError({
        statusCode: 409,
        statusMessage: "changed since it was read",
        data: { file: cause.file, actualHash: cause.actualHash, current: cause.current },
      });
    }
    throw createError({
      statusCode: 400,
      statusMessage: cause instanceof Error ? cause.message : String(cause),
    });
  }
});
