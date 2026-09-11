<script setup lang="ts">
import type { BaselineDraft } from "~/components/BaselineEditor.vue";

const router = useRouter();
const toast = useToast();

function toBaselineEntity(baseline: BaselineDraft): unknown {
  return {
    id: baseline.id,
    title: baseline.title,
    ...(baseline.targetSurface === ""
      ? {}
      : {
          target: {
            surface: baseline.targetSurface,
            ...(baseline.targetAction === "" ? {} : { action: baseline.targetAction }),
          },
        }),
    preconditions: baseline.preconditions,
    config: JSON.parse(baseline.configText),
    context: JSON.parse(baseline.contextText),
    ...(baseline.actionOperation === ""
      ? {}
      : {
          action: {
            operation: baseline.actionOperation,
            params: JSON.parse(baseline.actionParamsText),
          },
        }),
  };
}

const { draft, saving, errorMessage, conflict, save } = useEntityEditor<BaselineDraft>(
  "baseline",
  {
    id: "",
    title: "",
    targetSurface: "",
    targetAction: "",
    preconditions: [],
    configText: "{}",
    contextText: "{}",
    actionOperation: "",
    actionParamsText: "{}",
  },
  undefined,
  toBaselineEntity,
);

async function create(): Promise<void> {
  try {
    await save();
    toast.add({ title: "Baseline created", color: "success" });
    await router.push(`/baselines/${draft.value.id}`);
  } catch {
    // errorMessage / conflict already hold the reason; nothing further to do.
  }
}
</script>

<template>
  <div>
    <h1 class="text-xl font-semibold mb-4">New baseline</h1>
    <BaselineEditor v-model="draft" :id-editable="true" />

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
