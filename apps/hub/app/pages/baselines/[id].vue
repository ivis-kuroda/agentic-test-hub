<script setup lang="ts">
import type { Baseline } from "@agentic-test-hub/core";

import type { BaselineDraft } from "~/components/BaselineEditor.vue";

const route = useRoute();
const id = route.params["id"] as string;
const toast = useToast();

const { data } = await useSpecEntity<Baseline>("baseline", id);
if (!data.value) {
  throw createError({ statusCode: 404, statusMessage: `baseline ${id} not found` });
}

const normalised: BaselineDraft = {
  id: data.value.entity.id,
  title: data.value.entity.title,
  targetSurface: data.value.entity.target?.surface ?? "",
  targetAction: data.value.entity.target?.action ?? "",
  preconditions: [...data.value.entity.preconditions],
  configText: JSON.stringify(data.value.entity.config, null, 2),
  contextText: JSON.stringify(data.value.entity.context, null, 2),
  actionOperation: data.value.entity.action?.operation ?? "",
  actionParamsText: JSON.stringify(data.value.entity.action?.params ?? {}, null, 2),
};

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
  normalised,
  data.value.hash,
  toBaselineEntity,
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
    <BaselineEditor v-model="draft" />

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
