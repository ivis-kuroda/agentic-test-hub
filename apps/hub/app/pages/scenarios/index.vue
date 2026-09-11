<script setup lang="ts">
const { data } = await useFetch("/api/suite");
</script>

<template>
  <div class="max-w-3xl">
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-xl font-semibold">Scenarios</h1>
      <UButton to="/scenarios/new" label="New scenario" />
    </div>

    <ul class="space-y-2">
      <li v-for="scenario in data?.suite.scenarios ?? []" :key="scenario.id">
        <NuxtLink
          :to="`/scenarios/${scenario.id}`"
          class="block border border-default rounded-lg p-4 hover:bg-elevated transition"
        >
          <div class="flex items-center gap-2">
            <span class="font-medium">{{ scenario.title }}</span>
            <UBadge color="neutral" variant="subtle" size="sm">
              {{ scenario.steps.length }} steps
            </UBadge>
          </div>
        </NuxtLink>
      </li>
    </ul>

    <p v-if="data && data.suite.scenarios.length === 0" class="text-muted italic">
      No scenarios yet.
    </p>
  </div>
</template>
