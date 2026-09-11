<script setup lang="ts">
import type { MatrixDraft } from "~/components/MatrixEditor.vue";

const router = useRouter();
const toast = useToast();

const { data: suite } = await useFetch("/api/suite");
const factors = computed(() => suite.value?.suite.factors ?? []);
const viewpoints = computed(() => suite.value?.suite.viewpoints ?? []);

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
  {
    id: "",
    title: "",
    axes: { rows: "", cols: "" },
    additional: [],
    strategy: "single_factor",
    exclusions: [],
    viewpoints: [],
    note: "",
  },
  undefined,
  toMatrixEntity,
);

async function create(): Promise<void> {
  try {
    await save();
    toast.add({ title: "Matrix created", color: "success" });
    await router.push(`/matrices/${draft.value.id}`);
  } catch {
    // errorMessage / conflict already hold the reason; nothing further to do.
  }
}
</script>

<template>
  <div>
    <h1 class="text-xl font-semibold mb-4">New matrix</h1>
    <MatrixEditor v-model="draft" :id-editable="true" :factors="factors" :viewpoints="viewpoints" />

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
