<script setup lang="ts">
import type { ExpectationDraft } from "~/utils/expectationDraft.ts";

/**
 * The test case form's fields, as a plain editable shape.
 *
 * `expect` uses {@link ExpectationDraft} (see app/utils/expectationDraft.ts),
 * shared with the scenario editor since a step's `expect` is the same
 * schema type as a case's.
 */
export interface OverrideDraft {
  path: string;
  op: "set" | "remove" | "append";
  value: string;
}

export interface CaseDraft {
  id: string;
  summary: string;
  baseline: string;
  overrides: OverrideDraft[];
  targetSurface: string;
  targetAction: string;
  expect: ExpectationDraft[];
  polarity: "nominal" | "error";
  evidenceEnabled: boolean;
  evidenceSources: string[];
  evidenceTiming: "before" | "after" | "each_step" | "on_failure";
  evidenceTrace: "always" | "on_failure" | "never";
  evidenceIgnore: string[];
  evidenceWaivers: { source: string; reason: string }[];
  at: { factorId: string; levelId: string }[];
  isolation: "auto" | "shared" | "exclusive";
  priority: "P1" | "P2" | "P3";
  tags: string[];
  appliesToCommit: string;
  appliesToBranch: string;
  appliesToRelease: string;
  automationStatus: "manual" | "generated" | "verified";
  automationImpl: string;
  viewpoints: string[];
  note: string;
}

const model = defineModel<CaseDraft>({ required: true });
const props = defineProps<{
  idEditable?: boolean;
  baselines: { id: string; title: string }[];
  factors: { id: string; name: string }[];
  viewpoints: { id: string; title: string }[];
}>();

const baselineItems = computed(() =>
  props.baselines.map((baseline) => ({ label: baseline.title, value: baseline.id })),
);
const factorItems = computed(() =>
  props.factors.map((factor) => ({ label: factor.name, value: factor.id })),
);
const viewpointItems = computed(() =>
  props.viewpoints.map((viewpoint) => ({ label: viewpoint.title, value: viewpoint.id })),
);

const opItems = [
  { label: "set", value: "set" as const },
  { label: "remove", value: "remove" as const },
  { label: "append", value: "append" as const },
];
const evidenceSourceItems = [
  { label: "screenshot", value: "screenshot" },
  { label: "browser console", value: "browser_console" },
  { label: "browser network", value: "browser_network" },
  { label: "db records", value: "db_records" },
  { label: "app log", value: "app_log" },
  { label: "db log", value: "db_log" },
];
const timingItems = [
  { label: "before", value: "before" as const },
  { label: "after", value: "after" as const },
  { label: "each step", value: "each_step" as const },
  { label: "on failure", value: "on_failure" as const },
];
const traceItems = [
  { label: "always", value: "always" as const },
  { label: "on failure", value: "on_failure" as const },
  { label: "never", value: "never" as const },
];

function addOverride(): void {
  model.value.overrides.push({ path: "", op: "set", value: "" });
}
function removeOverride(index: number): void {
  model.value.overrides.splice(index, 1);
}

function addAtTerm(): void {
  model.value.at.push({ factorId: "", levelId: "" });
}
function removeAtTerm(index: number): void {
  model.value.at.splice(index, 1);
}

function addEvidenceIgnore(): void {
  model.value.evidenceIgnore.push("");
}
function removeEvidenceIgnore(index: number): void {
  model.value.evidenceIgnore.splice(index, 1);
}

function addWaiver(): void {
  model.value.evidenceWaivers.push({ source: "screenshot", reason: "" });
}
function removeWaiver(index: number): void {
  model.value.evidenceWaivers.splice(index, 1);
}

function addTag(): void {
  model.value.tags.push("");
}
function removeTag(index: number): void {
  model.value.tags.splice(index, 1);
}
</script>

<template>
  <div class="space-y-5 max-w-2xl">
    <UFormField
      label="Identifier"
      required
      :description="props.idEditable ? 'TC-EXAMPLE-001 style. Permanent once created.' : undefined"
    >
      <UInput
        v-model="model.id"
        :disabled="!props.idEditable"
        placeholder="TC-EXAMPLE-001"
        class="w-full"
      />
    </UFormField>

    <UFormField
      label="Summary"
      required
      description="The condition under test, e.g. 'the request carries no filename'."
    >
      <UTextarea v-model="model.summary" :rows="2" class="w-full" />
    </UFormField>

    <UFormField label="Baseline" required>
      <USelect v-model="model.baseline" :items="baselineItems" class="w-full" />
    </UFormField>

    <UFormField label="Overrides" description="Differences applied to the baseline, in order.">
      <div class="space-y-2">
        <div
          v-for="(override, index) in model.overrides"
          :key="index"
          class="flex gap-2 items-start"
        >
          <UInput v-model="override.path" placeholder="context.body.channel" class="flex-1" />
          <USelect v-model="override.op" :items="opItems" class="w-28 shrink-0" />
          <UInput
            v-model="override.value"
            :disabled="override.op === 'remove'"
            placeholder='value, e.g. "sms" or 3'
            class="flex-1"
          />
          <UButton
            icon="i-lucide-trash-2"
            color="neutral"
            variant="ghost"
            size="sm"
            @click="removeOverride(index)"
          />
        </div>
        <UButton
          icon="i-lucide-plus"
          variant="soft"
          size="sm"
          label="Add override"
          @click="addOverride"
        />
      </div>
    </UFormField>

    <div class="grid grid-cols-2 gap-4">
      <UFormField
        label="Target surface"
        description="Narrows the inherited target, if it acts elsewhere."
      >
        <UInput v-model="model.targetSurface" class="w-full" />
      </UFormField>
      <UFormField label="Target action">
        <UInput
          v-model="model.targetAction"
          :disabled="model.targetSurface === ''"
          class="w-full"
        />
      </UFormField>
    </div>

    <UFormField
      label="Placement"
      description="Explicit factor/level placement, for a factor not expressed as a single override."
    >
      <div class="space-y-2">
        <div v-for="(term, index) in model.at" :key="index" class="flex gap-2 items-start">
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
            @click="removeAtTerm(index)"
          />
        </div>
        <UButton
          icon="i-lucide-plus"
          variant="soft"
          size="sm"
          label="Add placement"
          @click="addAtTerm"
        />
      </div>
    </UFormField>

    <div class="grid grid-cols-3 gap-4">
      <UFormField label="Polarity">
        <USelect
          v-model="model.polarity"
          :items="[
            { label: 'nominal', value: 'nominal' },
            { label: 'error', value: 'error' },
          ]"
          class="w-full"
        />
      </UFormField>
      <UFormField label="Priority">
        <USelect
          v-model="model.priority"
          :items="[
            { label: 'P1', value: 'P1' },
            { label: 'P2', value: 'P2' },
            { label: 'P3', value: 'P3' },
          ]"
          class="w-full"
        />
      </UFormField>
      <UFormField label="Isolation" description="Leave unset to derive it from the overrides.">
        <USelect
          v-model="model.isolation"
          :items="[
            { label: '(derive)', value: 'auto' },
            { label: 'shared', value: 'shared' },
            { label: 'exclusive', value: 'exclusive' },
          ]"
          class="w-full"
        />
      </UFormField>
    </div>

    <UFormField label="Tags">
      <div class="space-y-2">
        <div v-for="(_, index) in model.tags" :key="index" class="flex gap-2 items-start">
          <UInput v-model="model.tags[index]" placeholder="smoke" class="flex-1" />
          <UButton
            icon="i-lucide-trash-2"
            color="neutral"
            variant="ghost"
            size="sm"
            @click="removeTag(index)"
          />
        </div>
        <UButton icon="i-lucide-plus" variant="soft" size="sm" label="Add tag" @click="addTag" />
      </div>
    </UFormField>

    <UFormField label="Viewpoints" description="Viewpoints this case contributes evidence for.">
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

    <div class="grid grid-cols-2 gap-4">
      <UFormField label="Automation status">
        <USelect
          v-model="model.automationStatus"
          :items="[
            { label: 'manual', value: 'manual' },
            { label: 'generated', value: 'generated' },
            { label: 'verified', value: 'verified' },
          ]"
          class="w-full"
        />
      </UFormField>
      <UFormField label="Automation impl" description="Path to the generated test.">
        <UInput v-model="model.automationImpl" class="w-full" />
      </UFormField>
    </div>

    <UFormField
      label="Applies to"
      description="Version of the target this specification was written against."
    >
      <div class="grid grid-cols-3 gap-2">
        <UInput v-model="model.appliesToCommit" placeholder="commit" />
        <UInput v-model="model.appliesToBranch" placeholder="branch" />
        <UInput v-model="model.appliesToRelease" placeholder="release" />
      </div>
    </UFormField>

    <UFormField
      label="Evidence plan"
      description="Override the suite's default evidence collection for this case."
    >
      <div class="space-y-3">
        <UCheckbox v-model="model.evidenceEnabled" label="Override for this case" />
        <template v-if="model.evidenceEnabled">
          <USelectMenu
            v-model="model.evidenceSources"
            :items="evidenceSourceItems"
            value-key="value"
            multiple
            placeholder="sources"
            class="w-full"
          />
          <div class="grid grid-cols-2 gap-4">
            <USelect v-model="model.evidenceTiming" :items="timingItems" class="w-full" />
            <USelect v-model="model.evidenceTrace" :items="traceItems" class="w-full" />
          </div>
          <div class="space-y-2">
            <div
              v-for="(_, index) in model.evidenceIgnore"
              :key="index"
              class="flex gap-2 items-start"
            >
              <UInput
                v-model="model.evidenceIgnore[index]"
                placeholder="known-noise regex"
                class="flex-1"
              />
              <UButton
                icon="i-lucide-trash-2"
                color="neutral"
                variant="ghost"
                size="sm"
                @click="removeEvidenceIgnore(index)"
              />
            </div>
            <UButton
              icon="i-lucide-plus"
              variant="soft"
              size="xs"
              label="Add ignore pattern"
              @click="addEvidenceIgnore"
            />
          </div>
        </template>
      </div>
    </UFormField>

    <UFormField
      label="Evidence waivers"
      description="Channels this case will not be judged on, with a reason."
    >
      <div class="space-y-2">
        <div
          v-for="(waiver, index) in model.evidenceWaivers"
          :key="index"
          class="flex gap-2 items-start"
        >
          <USelect v-model="waiver.source" :items="evidenceSourceItems" class="w-40 shrink-0" />
          <UInput v-model="waiver.reason" placeholder="reason" class="flex-1" />
          <UButton
            icon="i-lucide-trash-2"
            color="neutral"
            variant="ghost"
            size="sm"
            @click="removeWaiver(index)"
          />
        </div>
        <UButton
          icon="i-lucide-plus"
          variant="soft"
          size="sm"
          label="Add waiver"
          @click="addWaiver"
        />
      </div>
    </UFormField>

    <UFormField
      label="Expectations"
      required
      description="What must hold afterwards. At least one."
    >
      <ExpectationListEditor v-model="model.expect" :viewpoints="props.viewpoints" />
    </UFormField>
  </div>
</template>
