<script setup lang="ts">
import type { Factor } from "@agentic-test-hub/core";

import type { FactorDraft } from "~/components/FactorEditor.vue";

const route = useRoute();
const id = route.params["id"] as string;
const toast = useToast();

const { data } = await useSpecEntity<Factor>("factor", id);
if (!data.value) {
  throw createError({ statusCode: 404, statusMessage: `factor ${id} not found` });
}

const normalised: FactorDraft = {
  id: data.value.entity.id,
  name: data.value.entity.name,
  description: data.value.entity.description ?? "",
  path: data.value.entity.path ?? "",
  levels: data.value.entity.levels.map((level) => ({
    id: level.id,
    name: level.name,
    value: stringifyLevelValue(level.value),
    absent: level.absent,
  })),
};

function toFactorEntity(factor: FactorDraft): unknown {
  return {
    id: factor.id,
    name: factor.name,
    ...(factor.description === "" ? {} : { description: factor.description }),
    ...(factor.path === "" ? {} : { path: factor.path }),
    levels: factor.levels.map((level) => ({
      id: level.id,
      name: level.name,
      absent: level.absent,
      ...(level.absent ? {} : { value: parseLevelValue(level.value) }),
    })),
  };
}

const { draft, saving, errorMessage, conflict, save } = useEntityEditor<FactorDraft>(
  "factor",
  normalised,
  data.value.hash,
  toFactorEntity,
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
    <FactorEditor v-model="draft" />

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
