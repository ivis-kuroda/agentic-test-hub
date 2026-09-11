<script setup lang="ts">
const { data } = await useFetch("/api/suite");
</script>

<template>
  <div class="max-w-3xl">
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-xl font-semibold">Factors</h1>
      <UButton to="/factors/new" label="New factor" />
    </div>

    <ul class="space-y-2">
      <li v-for="factor in data?.suite.factors ?? []" :key="factor.id">
        <NuxtLink
          :to="`/factors/${factor.id}`"
          class="block border border-default rounded-lg p-4 hover:bg-elevated transition"
        >
          <div class="flex items-center gap-2">
            <span class="font-medium">{{ factor.name }}</span>
            <UBadge color="neutral" variant="subtle" size="sm">
              {{ factor.levels.length }} levels
            </UBadge>
          </div>
          <p v-if="factor.description" class="text-sm text-muted mt-1">
            {{ factor.description }}
          </p>
        </NuxtLink>
      </li>
    </ul>

    <p v-if="data && data.suite.factors.length === 0" class="text-muted italic">No factors yet.</p>
  </div>
</template>
