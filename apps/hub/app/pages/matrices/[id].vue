<script setup lang="ts">
import type { Matrix } from "@agentic-test-hub/core";

import type { MatrixDraft } from "~/components/MatrixEditor.vue";

const route = useRoute();
const id = route.params["id"] as string;
const toast = useToast();

const { data } = await useSpecEntity<Matrix>("matrix", id);
if (!data.value) {
  throw createError({ statusCode: 404, statusMessage: `matrix ${id} not found` });
}

const { data: suite } = await useFetch("/api/suite");
const factors = computed(() => suite.value?.suite.factors ?? []);
const viewpoints = computed(() => suite.value?.suite.viewpoints ?? []);

const normalised: MatrixDraft = {
  id: data.value.entity.id,
  title: data.value.entity.title,
  axes: { rows: data.value.entity.axes.rows, cols: data.value.entity.axes.cols },
  additional: [...data.value.entity.additional],
  strategy: data.value.entity.strategy,
  exclusions: data.value.entity.exclusions.map((exclusion) => ({
    when: Object.entries(exclusion.when).map(([factorId, levelId]) => ({ factorId, levelId })),
    reason: exclusion.reason,
  })),
  viewpoints: [...data.value.entity.viewpoints],
  note: data.value.entity.note ?? "",
};

function toMatrixEntity(matrix: MatrixDraft): unknown {
  return {
    id: matrix.id,
    title: matrix.title,
    axes: { rows: matrix.axes.rows, cols: matrix.axes.cols },
    additional: matrix.additional,
    strategy: matrix.strategy,
    exclusions: matrix.exclusions.map((exclusion) => ({
      when: Object.fromEntries(exclusion.when.map((term) => [term.factorId, term.levelId])),
      reason: exclusion.reason,
    })),
    viewpoints: matrix.viewpoints,
    ...(matrix.note === "" ? {} : { note: matrix.note }),
  };
}

const { draft, saving, errorMessage, conflict, save } = useEntityEditor<MatrixDraft>(
  "matrix",
  normalised,
  data.value.hash,
  toMatrixEntity,
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
    <MatrixEditor v-model="draft" :factors="factors" :viewpoints="viewpoints" />

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
