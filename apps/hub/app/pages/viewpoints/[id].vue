<script setup lang="ts">
import type { ViewpointDraft } from "~/components/ViewpointEditor.vue";

const route = useRoute();
const id = route.params["id"] as string;
const toast = useToast();

const { data } = await useSpecEntity<ViewpointDraft>("viewpoint", id);
if (!data.value) {
  throw createError({ statusCode: 404, statusMessage: `viewpoint ${id} not found` });
}

const normalised: ViewpointDraft = {
  ...data.value.entity,
  source: data.value.entity.source.map((entry) => ({ ...entry, note: entry.note ?? "" })),
};

const { draft, saving, errorMessage, conflict, save } = useEntityEditor<ViewpointDraft>(
  "viewpoint",
  normalised,
  data.value.hash,
);

async function persist(force = false): Promise<void> {
  try {
    await save({ force });
    toast.add({ title: "Saved", color: "success" });
  } catch {
    // errorMessage / conflict already hold the reason.
  }
}
</script>

<template>
  <div>
    <h1 class="text-xl font-semibold mb-4">{{ id }}</h1>
    <ViewpointEditor v-model="draft" />

    <UAlert
      v-if="errorMessage"
      color="error"
      variant="subtle"
      :title="errorMessage"
      class="max-w-2xl mt-4"
    />
    <ConflictAlert :conflict="conflict" @overwrite="persist(true)" />

    <div class="mt-6">
      <UButton label="Save" :loading="saving" @click="persist(false)" />
    </div>
  </div>
</template>
