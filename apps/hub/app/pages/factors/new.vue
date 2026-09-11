<script setup lang="ts">
import type { FactorDraft } from "~/components/FactorEditor.vue";

const router = useRouter();
const toast = useToast();

function toFactorEntity(factor: FactorDraft): unknown {
  return {
    id: factor.id,
    name: factor.name,
    ...(factor.description === "" ? {} : { description: factor.description }),
    ...(factor.path === "" ? {} : { path: factor.path }),
    levels: factor.levels.map((level) => ({
      id: level.id,
      name: level.name,
      absent: level.absent,
      ...(level.absent ? {} : { value: parseLevelValue(level.value) }),
    })),
  };
}

const { draft, saving, errorMessage, conflict, save } = useEntityEditor<FactorDraft>(
  "factor",
  {
    id: "",
    name: "",
    description: "",
    path: "",
    levels: [
      { id: "", name: "", value: "", absent: false },
      { id: "", name: "", value: "", absent: false },
    ],
  },
  undefined,
  toFactorEntity,
);

async function create(): Promise<void> {
  try {
    await save();
    toast.add({ title: "Factor created", color: "success" });
    await router.push(`/factors/${draft.value.id}`);
  } catch {
    // errorMessage / conflict already hold the reason; nothing further to do.
  }
}
</script>

<template>
  <div>
    <h1 class="text-xl font-semibold mb-4">New factor</h1>
    <FactorEditor v-model="draft" :id-editable="true" />

    <UAlert
      v-if="errorMessage"
      color="error"
      variant="subtle"
      :title="errorMessage"
      class="max-w-2xl mt-4"
    />
    <ConflictAlert :conflict="conflict" @overwrite="create" />

    <div class="mt-6">
      <UButton label="Create" :loading="saving" @click="create" />
    </div>
  </div>
</template>
