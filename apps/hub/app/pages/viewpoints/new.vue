<script setup lang="ts">
import type { ViewpointDraft } from "~/components/ViewpointEditor.vue";

const router = useRouter();
const toast = useToast();

const { draft, saving, errorMessage, conflict, save } = useEntityEditor<ViewpointDraft>(
  "viewpoint",
  {
    id: "",
    title: "",
    rationale: "",
    risk: "medium",
    source: [{ kind: "design", ref: "", note: "" }],
    parents: [],
  },
);

async function create(): Promise<void> {
  try {
    await save();
    toast.add({ title: "Viewpoint created", color: "success" });
    await router.push(`/viewpoints/${draft.value.id}`);
  } catch {
    // errorMessage / conflict already hold the reason; nothing further to do.
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
    <ConflictAlert :conflict="conflict" @overwrite="create" />

    <div class="mt-6">
      <UButton label="Create" :loading="saving" @click="create" />
    </div>
  </div>
</template>
