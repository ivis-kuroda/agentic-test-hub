<script setup lang="ts">
/**
 * The factor form's fields, as a plain editable shape.
 *
 * `levels[].value` is kept as a string in the draft and parsed on save
 * (see parseLevelValue): a factor's actual values are typically scalars —
 * a string, a number, a boolean — and asking someone to type `"email"` with
 * quotes just to get a string is worse than parsing `true`/`123` as JSON and
 * falling back to the raw text otherwise.
 */
export interface FactorDraft {
  id: string;
  name: string;
  description: string;
  path: string;
  levels: { id: string; name: string; value: string; absent: boolean }[];
}

const model = defineModel<FactorDraft>({ required: true });
const props = defineProps<{ idEditable?: boolean }>();

function addLevel(): void {
  model.value.levels.push({ id: "", name: "", value: "", absent: false });
}
function removeLevel(index: number): void {
  model.value.levels.splice(index, 1);
}
</script>

<template>
  <div class="space-y-5 max-w-2xl">
    <UFormField
      label="Identifier"
      required
      :description="props.idEditable ? 'F-EXAMPLE style. Permanent once created.' : undefined"
    >
      <UInput
        v-model="model.id"
        :disabled="!props.idEditable"
        placeholder="F-EXAMPLE"
        class="w-full"
      />
    </UFormField>

    <UFormField label="Name" required description="Human-readable axis label.">
      <UInput v-model="model.name" class="w-full" />
    </UFormField>

    <UFormField
      label="Description"
      description="What this factor varies, and why it is worth varying."
    >
      <UTextarea v-model="model.description" :rows="2" class="w-full" />
    </UFormField>

    <UFormField
      label="Path"
      description="Dotted path into a baseline that overrides for this factor address, e.g. context.headers.Authorization. Leave blank if this factor is not a single override — placement then has to be declared on each case."
    >
      <UInput v-model="model.path" placeholder="context.headers.Authorization" class="w-full" />
    </UFormField>

    <UFormField label="Levels" required description="Values this factor can take. At least two.">
      <div class="space-y-2">
        <div v-for="(level, index) in model.levels" :key="index" class="flex gap-2 items-start">
          <UInput v-model="level.id" placeholder="L-EXAMPLE" class="w-36 shrink-0" />
          <UInput v-model="level.name" placeholder="display name" class="flex-1" />
          <UInput
            v-model="level.value"
            :disabled="level.absent"
            placeholder='value, e.g. "email" or true'
            class="flex-1"
          />
          <UCheckbox v-model="level.absent" label="absent" class="mt-2 shrink-0" />
          <UButton
            icon="i-lucide-trash-2"
            color="neutral"
            variant="ghost"
            size="sm"
            @click="removeLevel(index)"
          />
        </div>
        <UButton
          icon="i-lucide-plus"
          variant="soft"
          size="sm"
          label="Add level"
          @click="addLevel"
        />
      </div>
    </UFormField>
  </div>
</template>
