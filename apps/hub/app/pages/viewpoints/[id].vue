<script setup lang="ts">
import type { ViewpointDraft } from "~/components/ViewpointEditor.vue";

const route = useRoute();
const id = route.params["id"] as string;

const { data } = await useFetch(`/api/viewpoints/${id}`);
if (!data.value) {
  throw createError({ statusCode: 404, statusMessage: `viewpoint ${id} not found` });
}

const draft = ref<ViewpointDraft>({
  ...data.value.entity,
  source: data.value.entity.source.map((entry) => ({ ...entry, note: entry.note ?? "" })),
});
const expectedHash = ref(data.value.hash);

const saving = ref(false);
const errorMessage = ref<string>();
const toast = useToast();

/** What the server reports when someone else changed this file first. */
const conflict = ref<{ current: string; actualHash: string }>();

async function save(force = false): Promise<void> {
  saving.value = true;
  errorMessage.value = undefined;
  try {
    const result = await $fetch("/api/viewpoints", {
      method: "PUT",
      body: {
        entity: {
          ...draft.value,
          source: draft.value.source.map((entry) => ({
            kind: entry.kind,
            ref: entry.ref,
            ...(entry.note === "" ? {} : { note: entry.note }),
          })),
        },
        expectedHash: force ? conflict.value?.actualHash : expectedHash.value,
      },
    });
    expectedHash.value = result.hash;
    conflict.value = undefined;
    toast.add({ title: "Saved", color: "success" });
  } catch (cause) {
    if (isConflictError(cause)) {
      conflict.value = { current: cause.data.data.current, actualHash: cause.data.data.actualHash };
    } else {
      errorMessage.value = extractErrorMessage(cause);
    }
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div>
    <h1 class="text-xl font-semibold mb-4">{{ id }}</h1>
    <ViewpointEditor v-model="draft" />

    <UAlert
      v-if="conflict"
      color="warning"
      variant="subtle"
      title="Someone else changed this file"
      description="It was edited since this page loaded. Review what changed before overwriting it."
      class="max-w-2xl mt-4"
    >
      <template #description>
        <p class="mb-2">It was edited since this page loaded. The file now contains:</p>
        <pre class="text-xs bg-elevated rounded p-3 overflow-auto max-h-64">{{
          conflict.current
        }}</pre>
        <UButton
          class="mt-2"
          color="warning"
          variant="soft"
          label="Overwrite with my changes"
          @click="save(true)"
        />
      </template>
    </UAlert>

    <UAlert
      v-if="errorMessage"
      color="error"
      variant="subtle"
      :title="errorMessage"
      class="max-w-2xl mt-4"
    />

    <div class="mt-6">
      <UButton label="Save" :loading="saving" @click="save(false)" />
    </div>
  </div>
</template>
