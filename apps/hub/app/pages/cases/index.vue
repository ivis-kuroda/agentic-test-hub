<script setup lang="ts">
const { data } = await useFetch("/api/suite");

const automationColor: Record<string, "neutral" | "warning" | "success"> = {
  manual: "neutral",
  generated: "warning",
  verified: "success",
};
</script>

<template>
  <div class="max-w-4xl">
    <h1 class="text-xl font-semibold mb-4">Cases</h1>

    <UTable
      :data="data?.suite.cases ?? []"
      :columns="[
        { accessorKey: 'id', header: 'ID' },
        { accessorKey: 'summary', header: 'Summary' },
        { accessorKey: 'baseline', header: 'Baseline' },
        { accessorKey: 'polarity', header: 'Polarity' },
        { accessorKey: 'priority', header: 'Priority' },
        { accessorKey: 'automation', header: 'Automation' },
      ]"
    >
      <template #automation-cell="{ row }">
        <UBadge :color="automationColor[row.original.automation.status]" variant="subtle" size="sm">
          {{ row.original.automation.status }}
        </UBadge>
      </template>
    </UTable>

    <p v-if="data && data.suite.cases.length === 0" class="text-muted italic mt-4">No cases yet.</p>
  </div>
</template>
