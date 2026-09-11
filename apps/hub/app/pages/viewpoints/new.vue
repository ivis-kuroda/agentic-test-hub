<script setup lang="ts">
import type { ViewpointDraft } from "~/components/ViewpointEditor.vue";

const draft = ref<ViewpointDraft>({
  id: "",
  title: "",
  rationale: "",
  risk: "medium",
  source: [{ kind: "design", ref: "", note: "" }],
  parents: [],
});

const saving = ref(false);
const errorMessage = ref<string>();
const router = useRouter();
const toast = useToast();

async function save(): Promise<void> {
  saving.value = true;
  errorMessage.value = undefined;
  try {
    await $fetch("/api/viewpoints", {
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
      },
    });
    toast.add({ title: "Viewpoint created", color: "success" });
    await router.push(`/viewpoints/${draft.value.id}`);
  } catch (cause) {
    errorMessage.value = extractErrorMessage(cause);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div>
    <h1 class="text-xl font-semibold mb-4">New viewpoint</h1>
    <ViewpointEditor v-model="draft" :id-editable="true" />

    <UAlert
      v-if="errorMessage"
      color="error"
      variant="subtle"
      :title="errorMessage"
      class="max-w-2xl mt-4"
    />

    <div class="mt-6">
      <UButton label="Create" :loading="saving" @click="save" />
    </div>
  </div>
</template>
