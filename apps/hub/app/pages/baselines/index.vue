<script setup lang="ts">
const { data } = await useFetch("/api/suite");
</script>

<template>
  <div class="max-w-3xl">
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-xl font-semibold">Baselines</h1>
      <UButton to="/baselines/new" label="New baseline" />
    </div>

    <ul class="space-y-2">
      <li v-for="baseline in data?.suite.baselines ?? []" :key="baseline.id">
        <NuxtLink
          :to="`/baselines/${baseline.id}`"
          class="block border border-default rounded-lg p-4 hover:bg-elevated transition"
        >
          <span class="font-medium">{{ baseline.title }}</span>
          <p v-if="baseline.target" class="text-sm text-muted mt-1">
            {{ baseline.target.surface
            }}<template v-if="baseline.target.action"> — {{ baseline.target.action }}</template>
          </p>
        </NuxtLink>
      </li>
    </ul>

    <p v-if="data && data.suite.baselines.length === 0" class="text-muted italic">
      No baselines yet.
    </p>
  </div>
</template>
