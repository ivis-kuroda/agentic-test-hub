<script setup lang="ts">
import type { Scenario } from "@agentic-test-hub/core";

const route = useRoute();
const id = route.params["id"] as string;
const toast = useToast();

const { data } = await useSpecEntity<Scenario>("scenario", id);
if (!data.value) {
  throw createError({ statusCode: 404, statusMessage: `scenario ${id} not found` });
}

const { data: suite } = await useFetch("/api/suite");
const viewpoints = computed(() => suite.value?.suite.viewpoints ?? []);

const { draft, saving, errorMessage, conflict, save } = useEntityEditor(
  "scenario",
  scenarioDraftFromEntity(data.value.entity),
  data.value.hash,
  scenarioDraftToEntity,
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
    <ScenarioEditor v-model="draft" :viewpoints="viewpoints" />

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
