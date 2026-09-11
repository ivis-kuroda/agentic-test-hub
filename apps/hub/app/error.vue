<script setup lang="ts">
const props = defineProps<{
  error: { statusCode: number; statusMessage?: string; message?: string };
}>();
</script>

<template>
  <UApp>
    <div class="min-h-screen flex items-center justify-center">
      <div class="text-center">
        <p class="text-4xl font-semibold mb-2">{{ props.error.statusCode }}</p>
        <p class="text-muted">{{ props.error.statusMessage ?? props.error.message }}</p>
        <UButton class="mt-4" label="Back home" @click="clearError({ redirect: '/' })" />
      </div>
    </div>
  </UApp>
</template>
