<script setup lang="ts">
/**
 * The matrix form's fields, as a plain editable shape.
 *
 * An exclusion's `when` is a partial assignment of factor to level (a
 * `Record<FactorId, LevelId>` in the schema); edited here as a list of pairs
 * since a record has no stable iteration order to bind a form to.
 */
export interface MatrixExclusionDraft {
  when: { factorId: string; levelId: string }[];
  reason: string;
}

export interface MatrixDraft {
  id: string;
  title: string;
  axes: { rows: string; cols: string };
  additional: string[];
  strategy: "single_factor" | "pairwise" | "full";
  exclusions: MatrixExclusionDraft[];
  viewpoints: string[];
  note: string;
}

const model = defineModel<MatrixDraft>({ required: true });
const props = defineProps<{
  idEditable?: boolean;
  factors: { id: string; name: string }[];
  viewpoints: { id: string; title: string }[];
}>();

const strategyItems = [
  { label: "Single factor", value: "single_factor" as const },
  { label: "Pairwise", value: "pairwise" as const },
  { label: "Full", value: "full" as const },
];

const factorItems = computed(() =>
  props.factors.map((factor) => ({ label: factor.name, value: factor.id })),
);
const viewpointItems = computed(() =>
  props.viewpoints.map((viewpoint) => ({ label: viewpoint.title, value: viewpoint.id })),
);

function addExclusion(): void {
  model.value.exclusions.push({ when: [{ factorId: "", levelId: "" }], reason: "" });
}
function removeExclusion(index: number): void {
  model.value.exclusions.splice(index, 1);
}
function addExclusionTerm(exclusion: MatrixExclusionDraft): void {
  exclusion.when.push({ factorId: "", levelId: "" });
}
function removeExclusionTerm(exclusion: MatrixExclusionDraft, index: number): void {
  exclusion.when.splice(index, 1);
}
</script>

<template>
  <div class="space-y-5 max-w-2xl">
    <UFormField
      label="Identifier"
      required
      :description="props.idEditable ? 'MX-EXAMPLE style. Permanent once created.' : undefined"
    >
      <UInput
        v-model="model.id"
        :disabled="!props.idEditable"
        placeholder="MX-EXAMPLE"
        class="w-full"
      />
    </UFormField>

    <UFormField label="Title" required>
      <UInput v-model="model.title" class="w-full" />
    </UFormField>

    <div class="grid grid-cols-2 gap-4">
      <UFormField label="Rows" required description="Factor forming the table's rows.">
        <USelect v-model="model.axes.rows" :items="factorItems" class="w-full" />
      </UFormField>
      <UFormField label="Columns" required description="Factor forming the table's columns.">
        <USelect v-model="model.axes.cols" :items="factorItems" class="w-full" />
      </UFormField>
    </div>

    <UFormField
      label="Additional factors"
      description="Held constant or folded into cells. Offered as alternative axes in review."
    >
      <USelectMenu
        v-model="model.additional"
        :items="factorItems"
        value-key="value"
        multiple
        class="w-full"
      />
    </UFormField>

    <UFormField
      label="Strategy"
      description="How much of the condition space this matrix intends to cover."
    >
      <USelect v-model="model.strategy" :items="strategyItems" class="w-48" />
    </UFormField>

    <UFormField label="Viewpoints" description="Viewpoints this matrix contributes evidence for.">
      <USelectMenu
        v-model="model.viewpoints"
        :items="viewpointItems"
        value-key="value"
        multiple
        class="w-full"
      />
    </UFormField>

    <UFormField label="Note">
      <UTextarea v-model="model.note" :rows="2" class="w-full" />
    </UFormField>

    <UFormField
      label="Exclusions"
      description="Combinations deliberately left untested, with the reason why."
    >
      <div class="space-y-3">
        <div
          v-for="(exclusion, exclusionIndex) in model.exclusions"
          :key="exclusionIndex"
          class="border border-default rounded-lg p-3 space-y-2"
        >
          <div
            v-for="(term, termIndex) in exclusion.when"
            :key="termIndex"
            class="flex gap-2 items-start"
          >
            <USelect
              v-model="term.factorId"
              :items="factorItems"
              placeholder="factor"
              class="w-40 shrink-0"
            />
            <UInput v-model="term.levelId" placeholder="L-EXAMPLE" class="flex-1" />
            <UButton
              icon="i-lucide-trash-2"
              color="neutral"
              variant="ghost"
              size="sm"
              @click="removeExclusionTerm(exclusion, termIndex)"
            />
          </div>
          <UButton
            icon="i-lucide-plus"
            variant="soft"
            size="xs"
            label="Add factor"
            @click="addExclusionTerm(exclusion)"
          />
          <UInput v-model="exclusion.reason" placeholder="reason" class="w-full" />
          <UButton
            icon="i-lucide-trash-2"
            color="error"
            variant="soft"
            size="sm"
            label="Remove exclusion"
            @click="removeExclusion(exclusionIndex)"
          />
        </div>
        <UButton
          icon="i-lucide-plus"
          variant="soft"
          size="sm"
          label="Add exclusion"
          @click="addExclusion"
        />
      </div>
    </UFormField>
  </div>
</template>
