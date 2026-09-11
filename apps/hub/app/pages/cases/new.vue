<script setup lang="ts">
import type { CaseDraft } from "~/components/CaseEditor.vue";

const router = useRouter();
const toast = useToast();

const { data: suite } = await useFetch("/api/suite");
const baselines = computed(() => suite.value?.suite.baselines ?? []);
const factors = computed(() => suite.value?.suite.factors ?? []);
const viewpoints = computed(() => suite.value?.suite.viewpoints ?? []);

const { draft, saving, errorMessage, conflict, save } = useEntityEditor<CaseDraft>(
  "case",
  emptyCaseDraft(),
  undefined,
  caseDraftToEntity,
);

async function create(): Promise<void> {
  try {
    await save();
    toast.add({ title: "Case created", color: "success" });
    await router.push(`/cases/${draft.value.id}`);
  } catch {
    // errorMessage / conflict already hold the reason; nothing further to do.
  }
}
</script>

<template>
  <div>
    <h1 class="text-xl font-semibold mb-4">New case</h1>
    <CaseEditor
      v-model="draft"
      :id-editable="true"
      :baselines="baselines"
      :factors="factors"
      :viewpoints="viewpoints"
    />

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
