import { readFile } from "node:fs/promises";

import { hashContents } from "@agentic-test-hub/store";
import { pathFor } from "@agentic-test-hub/store";

/** Returns one viewpoint and the hash an editor must send back to save it. */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (id === undefined) throw createError({ statusCode: 400, statusMessage: "id is required" });

  const store = useStore();
  const { suite } = await store.load();
  const entity = suite.viewpoints.find((viewpoint) => viewpoint.id === id);
  if (entity === undefined) {
    throw createError({ statusCode: 404, statusMessage: `viewpoint ${id} not found` });
  }

  const config = useRuntimeConfig();
  const path = pathFor(resolveSpecsRoot(config), "viewpoint", id);
  const hash = hashContents(await readFile(path, "utf8"));
  return { entity, hash };
});
