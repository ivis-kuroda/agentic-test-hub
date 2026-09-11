<script setup lang="ts">
import type { EditorConflict } from "../composables/useEntityEditor.ts";

defineProps<{ conflict: EditorConflict | undefined }>();
const emit = defineEmits<{ overwrite: [] }>();
</script>

<template>
  <UAlert
    v-if="conflict"
    color="warning"
    variant="subtle"
    title="Someone else changed this file"
    class="max-w-2xl mt-4"
  >
    <template #description>
      <p class="mb-2">It was edited since this page loaded. The file now contains:</p>
      <pre class="text-xs bg-elevated rounded p-3 overflow-auto max-h-64">{{
        conflict.current
      }}</pre>
      <UButton
        class="mt-2"
        color="warning"
        variant="soft"
        label="Overwrite with my changes"
        @click="emit('overwrite')"
      />
    </template>
  </UAlert>
</template>
