import type { EntityKind } from "@agentic-test-hub/store";

import { extractErrorMessage, isConflictError } from "./useApiError.ts";
import { saveSpecEntity } from "./useSpecEntity.ts";

/** What the server reported when a save was rejected as a conflict. */
export interface EditorConflict {
  readonly current: string;
  readonly actualHash: string;
}

/**
 * The save/conflict machinery shared by every entity editor page.
 *
 * Six entity kinds have six different shapes and six different hand-written
 * forms, but "hold a draft, save it, and offer to overwrite on a conflict" is
 * identical across all of them. Writing that once here is what keeps adding
 * a seventh kind from meaning a seventh copy of this logic.
 *
 * @param kind - The entity's kind, used to address the generic API route.
 * @param initial - The entity to start editing from.
 * @param initialHash - The hash last seen for it. Omit when creating.
 * @param toEntity - Converts the draft to what actually gets saved, for a
 *   draft shape that is not itself valid against the schema (e.g. a factor
 *   level's value edited as text but saved as its parsed JSON). Defaults to
 *   the draft as-is.
 */
export function useEntityEditor<T>(
  kind: EntityKind,
  initial: T,
  initialHash?: string,
  toEntity: (draft: T) => unknown = (draft) => draft,
) {
  const draft = ref(structuredClone(initial)) as Ref<T>;
  const hash = ref(initialHash);
  const saving = ref(false);
  const errorMessage = ref<string>();
  const conflict = ref<EditorConflict>();

  /**
   * Saves the current draft.
   *
   * @param force - When true, saves against the hash the conflict reported
   *   as current, deliberately overwriting the other change.
   * @returns Where it was written and the file's new hash.
   * @throws Whatever `saveSpecEntity` threw, after recording it in
   *   `conflict` or `errorMessage`. Callers that only need those refs can
   *   ignore the rejection; callers that navigate on success should await it.
   */
  async function save(options: { force?: boolean } = {}): Promise<{
    file: string;
    hash: string;
    created: boolean;
  }> {
    saving.value = true;
    errorMessage.value = undefined;
    try {
      const expectedHash = options.force ? conflict.value?.actualHash : hash.value;
      const result = await saveSpecEntity(kind, toEntity(draft.value), expectedHash);
      hash.value = result.hash;
      conflict.value = undefined;
      return result;
    } catch (cause) {
      if (isConflictError(cause)) {
        conflict.value = {
          current: cause.data.data.current,
          actualHash: cause.data.data.actualHash,
        };
      } else {
        errorMessage.value = extractErrorMessage(cause);
      }
      throw cause;
    } finally {
      saving.value = false;
    }
  }

  return { draft, hash, saving, errorMessage, conflict, save };
}
