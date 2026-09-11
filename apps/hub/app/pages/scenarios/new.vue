<script setup lang="ts">
import type { ScenarioDraft } from "~/components/ScenarioEditor.vue";

const router = useRouter();
const toast = useToast();

const { data: suite } = await useFetch("/api/suite");
const viewpoints = computed(() => suite.value?.suite.viewpoints ?? []);

const { draft, saving, errorMessage, conflict, save } = useEntityEditor<ScenarioDraft>(
  "scenario",
  emptyScenarioDraft(),
  undefined,
  scenarioDraftToEntity,
);

async function create(): Promise<void> {
  try {
    await save();
    toast.add({ title: "Scenario created", color: "success" });
    await router.push(`/scenarios/${draft.value.id}`);
  } catch {
    // errorMessage / conflict already hold the reason; nothing further to do.
  }
}
</script>

<template>
  <div>
    <h1 class="text-xl font-semibold mb-4">New scenario</h1>
    <ScenarioEditor v-model="draft" :id-editable="true" :viewpoints="viewpoints" />

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
