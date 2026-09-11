<script setup lang="ts">
const { data } = await useFetch("/api/suite");
</script>

<template>
  <div class="max-w-3xl">
    <h1 class="text-xl font-semibold mb-4">Suite overview</h1>
    <div v-if="data" class="grid grid-cols-3 gap-3 mb-6">
      <UCard
        v-for="stat in [
          ['Viewpoints', data.suite.viewpoints.length],
          ['Factors', data.suite.factors.length],
          ['Matrices', data.suite.matrices.length],
          ['Baselines', data.suite.baselines.length],
          ['Cases', data.suite.cases.length],
          ['Scenarios', data.suite.scenarios.length],
        ]"
        :key="stat[0] as string"
      >
        <div class="text-2xl font-semibold">{{ stat[1] }}</div>
        <div class="text-sm text-muted">{{ stat[0] }}</div>
      </UCard>
    </div>

    <UAlert
      v-if="data && data.problems.length > 0"
      color="warning"
      variant="subtle"
      :title="`${data.problems.length} file problem(s)`"
      class="mb-4"
    >
      <template #description>
        <ul class="list-disc pl-5 text-sm">
          <li v-for="problem in data.problems" :key="problem.file">
            {{ problem.file }}: {{ problem.message }}
          </li>
        </ul>
      </template>
    </UAlert>
  </div>
</template>
