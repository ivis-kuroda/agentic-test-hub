import { readFile } from "node:fs/promises";

import { hashContents, LAYOUTS, pathFor } from "@agentic-test-hub/store";

/**
 * Returns one entity of the given kind and the hash an editor must send back
 * to save it.
 *
 * One route serves every entity kind: a viewpoint and a scenario differ in
 * shape, but "look it up in the suite, hash the file that holds it" does not
 * differ, so it is written once rather than once per kind.
 */
export default defineEventHandler(async (event) => {
  const kind = requireEntityKind(getRouterParam(event, "kind"));
  const id = getRouterParam(event, "id");
  if (id === undefined) throw createError({ statusCode: 400, statusMessage: "id is required" });

  const store = useStore();
  const { suite } = await store.load();
  const layout = LAYOUTS.find((candidate) => candidate.kind === kind);
  if (!layout) throw createError({ statusCode: 400, statusMessage: `unknown kind "${kind}"` });

  const collection = suite[layout.collection] as readonly { id: string }[];
  const entity = collection.find((candidate) => candidate.id === id);
  if (entity === undefined) {
    throw createError({ statusCode: 404, statusMessage: `${kind} ${id} not found` });
  }

  const config = useRuntimeConfig();
  const path = pathFor(resolveSpecsRoot(config), kind, id);
  const hash = hashContents(await readFile(path, "utf8"));
  return { entity, hash };
});
