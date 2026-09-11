<script setup lang="ts">
import type { ExpectationDraft, ExpectationKind } from "~/utils/expectationDraft.ts";

const model = defineModel<ExpectationDraft[]>({ required: true });
const props = defineProps<{ viewpoints: { id: string; title: string }[] }>();

const viewpointItems = computed(() =>
  props.viewpoints.map((viewpoint) => ({ label: viewpoint.title, value: viewpoint.id })),
);

const expectationKindItems: { label: string; value: ExpectationKind }[] = [
  { label: "HTTP status", value: "http_status" },
  { label: "Text present", value: "text" },
  { label: "Error message", value: "error_message" },
  { label: "Stdout contains", value: "stdout_contains" },
  { label: "Operation result", value: "operation_result" },
  { label: "AI judgement", value: "ai_judgement" },
  { label: "Unspecified (migration debt)", value: "unspecified" },
];
const matchItems = [
  { label: "exact", value: "exact" as const },
  { label: "contains", value: "contains" as const },
  { label: "regex", value: "regex" as const },
];
const assertKindItems = [
  { label: "equals", value: "equals" as const },
  { label: "contains", value: "contains" as const },
  { label: "matches", value: "matches" as const },
  { label: "row_count", value: "row_count" as const },
  { label: "natural", value: "natural" as const },
];

function addExpectation(): void {
  model.value.push(newExpectationDraft());
}
function removeExpectation(index: number): void {
  model.value.splice(index, 1);
}
</script>

<template>
  <div class="space-y-4">
    <div
      v-for="(expectation, index) in model"
      :key="index"
      class="border border-default rounded-lg p-3 space-y-2"
    >
      <div class="flex gap-2 items-start">
        <USelect v-model="expectation.kind" :items="expectationKindItems" class="w-56 shrink-0" />
        <div class="flex-1" />
        <UButton
          icon="i-lucide-trash-2"
          color="error"
          variant="soft"
          size="sm"
          label="Remove"
          @click="removeExpectation(index)"
        />
      </div>

      <UInput
        v-if="expectation.kind === 'http_status'"
        v-model="expectation.status"
        placeholder="status, e.g. 201"
        class="w-full"
      />

      <template v-if="expectation.kind === 'text' || expectation.kind === 'error_message'">
        <UInput v-model="expectation.value" placeholder="expected text" class="w-full" />
        <USelect v-model="expectation.match" :items="matchItems" class="w-40" />
        <UInput
          v-if="expectation.kind === 'text'"
          v-model="expectation.scope"
          placeholder="scope (optional)"
          class="w-full"
        />
      </template>

      <template v-if="expectation.kind === 'stdout_contains'">
        <UInput v-model="expectation.value" placeholder="expected text" class="w-full" />
        <USelect
          v-model="expectation.stream"
          :items="[
            { label: '(both)', value: '' },
            { label: 'stdout', value: 'stdout' },
            { label: 'stderr', value: 'stderr' },
          ]"
          class="w-40"
        />
      </template>

      <template v-if="expectation.kind === 'operation_result'">
        <UInput v-model="expectation.operation" placeholder="OP-EXAMPLE" class="w-full" />
        <UTextarea
          v-model="expectation.params"
          :rows="2"
          placeholder="params, as JSON"
          class="w-full font-mono text-sm"
        />
        <USelect v-model="expectation.assertKind" :items="assertKindItems" class="w-40" />
        <UInput
          v-if="expectation.assertKind === 'equals'"
          v-model="expectation.assertValueText"
          placeholder="expected value, as JSON or text"
          class="w-full"
        />
        <UInput
          v-if="expectation.assertKind === 'contains'"
          v-model="expectation.assertContains"
          placeholder="expected substring"
          class="w-full"
        />
        <UInput
          v-if="expectation.assertKind === 'matches'"
          v-model="expectation.assertPattern"
          placeholder="regular expression"
          class="w-full"
        />
        <UInput
          v-if="expectation.assertKind === 'row_count'"
          v-model="expectation.assertCount"
          placeholder="expected row count"
          class="w-full"
        />
        <UTextarea
          v-if="expectation.assertKind === 'natural'"
          v-model="expectation.assertNatural"
          :rows="2"
          placeholder="claim settled by a model"
          class="w-full"
        />
      </template>

      <template v-if="expectation.kind === 'ai_judgement'">
        <USelect
          v-model="expectation.aspect"
          :items="[
            { label: 'visual', value: 'visual' },
            { label: 'semantic', value: 'semantic' },
          ]"
          class="w-40"
        />
        <UTextarea v-model="expectation.value" :rows="2" placeholder="claim" class="w-full" />
      </template>

      <UTextarea
        v-if="expectation.kind === 'unspecified'"
        v-model="expectation.unspecifiedText"
        :rows="2"
        placeholder="claim preserved verbatim from migration"
        class="w-full"
      />

      <UInput
        v-model="expectation.knownDeviation"
        placeholder="known deviation (optional)"
        class="w-full"
      />
      <USelectMenu
        v-model="expectation.viewpoints"
        :items="viewpointItems"
        value-key="value"
        multiple
        placeholder="viewpoints"
        class="w-full"
      />
    </div>
    <UButton
      icon="i-lucide-plus"
      variant="soft"
      size="sm"
      label="Add expectation"
      @click="addExpectation"
    />
  </div>
</template>
