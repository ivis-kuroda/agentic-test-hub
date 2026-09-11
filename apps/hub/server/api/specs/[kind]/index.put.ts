import { z } from "zod";

import { ConflictError } from "@agentic-test-hub/store";

const Body = z.object({
  entity: z.unknown(),
  /** The hash the editor last saw. Absent when creating. */
  expectedHash: z.string().optional(),
});

/**
 * Creates or updates one entity of the given kind.
 *
 * A conflict is reported as `409` with the file's current contents, rather
 * than as a generic `500`: the caller needs to show the difference to the
 * person editing, not just tell them something went wrong. Validation
 * failure (a malformed entity) is reported as `400` and is never mistaken
 * for a conflict, since the store checks shape before it checks the hash.
 */
export default defineEventHandler(async (event) => {
  const kind = requireEntityKind(getRouterParam(event, "kind"));
  const body = Body.parse(await readBody(event));
  const store = useStore();

  try {
    return await store.save({
      kind,
      entity: body.entity,
      ...(body.expectedHash === undefined ? {} : { expectedHash: body.expectedHash }),
    });
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
