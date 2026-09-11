<script setup lang="ts">
/**
 * The viewpoint form's fields, as a plain editable shape.
 *
 * Deliberately not generated from the Zod schema. A viewpoint has five
 * fields and one of them is a list of a different shape; writing the markup
 * by hand is less code than registering a renderer for it would be, and it
 * stays readable to anyone on the team regardless of whether they know the
 * schema-driven-forms idiom.
 */
export type SourceKind = "design" | "code" | "issue" | "standard" | "other";

export interface ViewpointDraft {
  id: string;
  title: string;
  rationale: string;
  risk: "high" | "medium" | "low";
  source: { kind: SourceKind; ref: string; note: string }[];
  parents: string[];
}

const model = defineModel<ViewpointDraft>({ required: true });
const props = defineProps<{ idEditable?: boolean }>();

const sourceKinds: SourceKind[] = ["design", "code", "issue", "standard", "other"];

function addSource(): void {
  model.value.source.push({ kind: "design" as const, ref: "", note: "" });
}
function removeSource(index: number): void {
  model.value.source.splice(index, 1);
}
</script>

<template>
  <div class="space-y-5 max-w-2xl">
    <UFormField
      label="Identifier"
      required
      :description="props.idEditable ? 'VP-EXAMPLE-001 style. Permanent once created.' : undefined"
    >
      <UInput
        v-model="model.id"
        :disabled="!props.idEditable"
        placeholder="VP-EXAMPLE-001"
        class="w-full"
      />
    </UFormField>

    <UFormField
      label="Title"
      required
      description="Short statement of the claim, as a reviewer would phrase it."
    >
      <UInput v-model="model.title" class="w-full" />
    </UFormField>

    <UFormField
      label="Rationale"
      required
      description="Why the claim matters and what goes wrong if it does not hold."
    >
      <UTextarea v-model="model.rationale" :rows="3" class="w-full" />
    </UFormField>

    <UFormField label="Risk">
      <USelect
        v-model="model.risk"
        :items="[
          { label: 'High', value: 'high' },
          { label: 'Medium', value: 'medium' },
          { label: 'Low', value: 'low' },
        ]"
        class="w-48"
      />
    </UFormField>

    <UFormField
      label="Source"
      required
      description="Evidence that this is a real requirement. At least one entry."
    >
      <div class="space-y-2">
        <div v-for="(entry, index) in model.source" :key="index" class="flex gap-2 items-start">
          <USelect v-model="entry.kind" :items="[...sourceKinds]" class="w-32 shrink-0" />
          <UInput v-model="entry.ref" placeholder="reference" class="flex-1" />
          <UInput v-model="entry.note" placeholder="note (optional)" class="flex-1" />
          <UButton
            icon="i-lucide-trash-2"
            color="neutral"
            variant="ghost"
            size="sm"
            @click="removeSource(index)"
          />
        </div>
        <UButton
          icon="i-lucide-plus"
          variant="soft"
          size="sm"
          label="Add source"
          @click="addSource"
        />
      </div>
    </UFormField>
  </div>
</template>
