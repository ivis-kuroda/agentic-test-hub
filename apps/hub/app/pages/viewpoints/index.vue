<script setup lang="ts">
const { data } = await useFetch("/api/suite");

const riskColor: Record<string, "error" | "warning" | "success"> = {
  high: "error",
  medium: "warning",
  low: "success",
};
</script>

<template>
  <div class="max-w-3xl">
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-xl font-semibold">Viewpoints</h1>
      <UButton to="/viewpoints/new" label="New viewpoint" />
    </div>

    <ul class="space-y-2">
      <li v-for="viewpoint in data?.suite.viewpoints ?? []" :key="viewpoint.id">
        <NuxtLink
          :to="`/viewpoints/${viewpoint.id}`"
          class="block border border-default rounded-lg p-4 hover:bg-elevated transition"
        >
          <div class="flex items-center gap-2">
            <UBadge :color="riskColor[viewpoint.risk]" variant="subtle" size="sm">
              {{ viewpoint.risk }}
            </UBadge>
            <span class="font-medium">{{ viewpoint.title }}</span>
          </div>
          <p class="text-sm text-muted mt-1">{{ viewpoint.rationale }}</p>
        </NuxtLink>
      </li>
    </ul>

    <p v-if="data && data.suite.viewpoints.length === 0" class="text-muted italic">
      No viewpoints yet.
    </p>
  </div>
</template>
