<script setup lang="ts">
/**
 * The baseline form's fields, as a plain editable shape.
 *
 * `config`, `context` and `action.params` are arbitrary JSON objects in the
 * schema (application config, request-shaped data, operation parameters) —
 * edited here as raw JSON text rather than a generic nested key/value tree
 * editor, and parsed on save. This mirrors how a factor level's value is
 * edited as text and parsed (see app/utils/levelValue.ts), one level up: an
 * object instead of a scalar.
 */
export interface BaselineDraft {
  id: string;
  title: string;
  targetSurface: string;
  targetAction: string;
  preconditions: string[];
  configText: string;
  contextText: string;
  actionOperation: string;
  actionParamsText: string;
}

const model = defineModel<BaselineDraft>({ required: true });
const props = defineProps<{ idEditable?: boolean }>();

function addPrecondition(): void {
  model.value.preconditions.push("");
}
function removePrecondition(index: number): void {
  model.value.preconditions.splice(index, 1);
}
</script>

<template>
  <div class="space-y-5 max-w-2xl">
    <UFormField
      label="Identifier"
      required
      :description="props.idEditable ? 'BL-EXAMPLE style. Permanent once created.' : undefined"
    >
      <UInput
        v-model="model.id"
        :disabled="!props.idEditable"
        placeholder="BL-EXAMPLE"
        class="w-full"
      />
    </UFormField>

    <UFormField label="Title" required>
      <UInput v-model="model.title" class="w-full" />
    </UFormField>

    <div class="grid grid-cols-2 gap-4">
      <UFormField label="Target surface" description="What the family acts on.">
        <UInput v-model="model.targetSurface" placeholder="Dispatch API" class="w-full" />
      </UFormField>
      <UFormField label="Target action" description="Narrows the target, if it needs narrowing.">
        <UInput
          v-model="model.targetAction"
          :disabled="model.targetSurface === ''"
          placeholder="send a notification"
          class="w-full"
        />
      </UFormField>
    </div>

    <UFormField
      label="Preconditions"
      description="States that must hold before any case in the family runs, e.g. queue.empty."
    >
      <div class="space-y-2">
        <div v-for="(_, index) in model.preconditions" :key="index" class="flex gap-2 items-start">
          <UInput
            v-model="model.preconditions[index]"
            placeholder="db.items.pristine"
            class="flex-1"
          />
          <UButton
            icon="i-lucide-trash-2"
            color="neutral"
            variant="ghost"
            size="sm"
            @click="removePrecondition(index)"
          />
        </div>
        <UButton
          icon="i-lucide-plus"
          variant="soft"
          size="sm"
          label="Add precondition"
          @click="addPrecondition"
        />
      </div>
    </UFormField>

    <UFormField
      label="Config"
      description="Application or environment configuration the family assumes, as JSON."
    >
      <UTextarea v-model="model.configText" :rows="4" class="w-full font-mono text-sm" />
    </UFormField>

    <UFormField label="Context" description="Request-shaped data the family sends, as JSON.">
      <UTextarea v-model="model.contextText" :rows="6" class="w-full font-mono text-sm" />
    </UFormField>

    <UFormField
      label="Action operation"
      description="The operation every case in the family performs."
    >
      <UInput v-model="model.actionOperation" placeholder="OP-EXAMPLE" class="w-full" />
    </UFormField>

    <UFormField label="Action params" description="Parameters passed to the operation, as JSON.">
      <UTextarea
        v-model="model.actionParamsText"
        :disabled="model.actionOperation === ''"
        :rows="3"
        class="w-full font-mono text-sm"
      />
    </UFormField>
  </div>
</template>
