<script setup lang="ts">
import { buildMatrixView, type MatrixView } from "@agentic-test-hub/core";

const { data } = await useFetch("/api/suite");

const views = computed<MatrixView[]>(() => {
  if (!data.value) return [];
  const suite = data.value.suite;
  return suite.matrices.map((matrix) =>
    buildMatrixView(matrix, {
      factors: suite.factors,
      baselines: suite.baselines,
      cases: suite.cases,
    }),
  );
});

function cellClass(kind: "covered" | "excluded" | "gap"): string {
  return {
    covered: "bg-success/15 text-success",
    excluded: "bg-elevated text-muted",
    gap: "bg-error/15 text-error font-semibold",
  }[kind];
}
</script>

<template>
  <div class="max-w-4xl">
    <h1 class="text-xl font-semibold mb-6">Coverage matrices</h1>

    <div v-for="view in views" :key="view.matrix.id" class="mb-10">
      <h2 class="font-medium mb-2">{{ view.matrix.title }}</h2>
      <table class="border-collapse text-sm">
        <thead>
          <tr>
            <th class="p-2"></th>
            <th
              v-for="level in view.colFactor.levels"
              :key="level.id"
              class="p-2 border border-default bg-elevated"
            >
              {{ level.name }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, rowIndex) in view.cells" :key="view.rowFactor.levels[rowIndex]?.id">
            <th class="p-2 border border-default bg-elevated text-left">
              {{ view.rowFactor.levels[rowIndex]?.name }}
            </th>
            <td
              v-for="(cell, colIndex) in row"
              :key="colIndex"
              class="p-2 border border-default text-center min-w-24"
              :class="cellClass(cell.state.kind)"
              :title="
                cell.state.kind === 'excluded'
                  ? cell.state.reason
                  : cell.state.kind === 'covered'
                    ? cell.state.cases.join(', ')
                    : ''
              "
            >
              {{ cell.state.kind }}
            </td>
          </tr>
        </tbody>
      </table>
      <p class="text-sm text-muted mt-2">
        {{ view.stats.covered }} covered, {{ view.stats.excluded }} excluded,
        {{ view.stats.gap }} gap
      </p>
    </div>

    <p v-if="data && views.length === 0" class="text-muted italic">No matrices yet.</p>
  </div>
</template>
