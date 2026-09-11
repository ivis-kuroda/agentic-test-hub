<script setup lang="ts">
import type { ExpectationDraft } from "~/utils/expectationDraft.ts";

/**
 * The scenario form's fields, as a plain editable shape.
 *
 * A step's `action` is optional (a step may only observe) and, when
 * present, is an operation plus JSON params — the same shape as a
 * baseline's action, edited the same way (see BaselineEditor.vue).
 * `produces` is a `Record<string, string>` in the schema (a name mapped to
 * an extraction expression); edited as a list of pairs, like a matrix
 * exclusion's `when`.
 */
export interface StepDraft {
  id: string;
  summary: string;
  targetSurface: string;
  targetAction: string;
  actionOperation: string;
  actionParams: string;
  expect: ExpectationDraft[];
  polarity: "nominal" | "error";
  dependsOn: string[];
  produces: { name: string; expression: string }[];
  viewpoints: string[];
  note: string;
}

export interface ScenarioDraft {
  id: string;
  title: string;
  preconditions: string[];
  steps: StepDraft[];
  evidenceEnabled: boolean;
  evidenceSources: string[];
  evidenceTiming: "before" | "after" | "each_step" | "on_failure";
  evidenceTrace: "always" | "on_failure" | "never";
  evidenceIgnore: string[];
  evidenceWaivers: { source: string; reason: string }[];
  tags: string[];
  appliesToCommit: string;
  appliesToBranch: string;
  appliesToRelease: string;
  viewpoints: string[];
  note: string;
}

const model = defineModel<ScenarioDraft>({ required: true });
const props = defineProps<{
  idEditable?: boolean;
  viewpoints: { id: string; title: string }[];
}>();

const viewpointItems = computed(() =>
  props.viewpoints.map((viewpoint) => ({ label: viewpoint.title, value: viewpoint.id })),
);
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

function addPrecondition(): void {
  model.value.preconditions.push("");
}
function removePrecondition(index: number): void {
  model.value.preconditions.splice(index, 1);
}

function addStep(): void {
  model.value.steps.push(newStepDraft());
}
function removeStep(index: number): void {
  model.value.steps.splice(index, 1);
}

function addDependsOn(step: StepDraft): void {
  step.dependsOn.push("");
}
function removeDependsOn(step: StepDraft, index: number): void {
  step.dependsOn.splice(index, 1);
}

function addProduces(step: StepDraft): void {
  step.produces.push({ name: "", expression: "" });
}
function removeProduces(step: StepDraft, index: number): void {
  step.produces.splice(index, 1);
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
      :description="props.idEditable ? 'SC-EXAMPLE style. Permanent once created.' : undefined"
    >
      <UInput
        v-model="model.id"
        :disabled="!props.idEditable"
        placeholder="SC-EXAMPLE"
        class="w-full"
      />
    </UFormField>

    <UFormField label="Title" required>
      <UInput v-model="model.title" class="w-full" />
    </UFormField>

    <UFormField label="Preconditions" description="States that must hold before the first step.">
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

    <UFormField label="Viewpoints" description="Viewpoints this scenario contributes evidence for.">
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
      description="Override the suite's default evidence collection for this scenario."
    >
      <div class="space-y-3">
        <UCheckbox v-model="model.evidenceEnabled" label="Override for this scenario" />
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
      description="Channels this scenario will not be judged on, with a reason."
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
      label="Steps"
      required
      description="Steps in the order they must run. At least one."
    >
      <div class="space-y-4">
        <div
          v-for="(step, stepIndex) in model.steps"
          :key="stepIndex"
          class="border border-default rounded-lg p-3 space-y-3"
        >
          <div class="flex gap-2 items-start">
            <UInput v-model="step.id" placeholder="S-EXAMPLE" class="w-40 shrink-0" />
            <UInput
              v-model="step.summary"
              placeholder="what this step establishes"
              class="flex-1"
            />
            <UButton
              icon="i-lucide-trash-2"
              color="error"
              variant="soft"
              size="sm"
              label="Remove step"
              @click="removeStep(stepIndex)"
            />
          </div>

          <div class="grid grid-cols-2 gap-2">
            <UInput v-model="step.targetSurface" placeholder="target surface (optional)" />
            <UInput
              v-model="step.targetAction"
              :disabled="step.targetSurface === ''"
              placeholder="target action"
            />
          </div>

          <UInput
            v-model="step.actionOperation"
            placeholder="OP-EXAMPLE (optional; omit for an observing step)"
            class="w-full"
          />
          <UTextarea
            v-if="step.actionOperation !== ''"
            v-model="step.actionParams"
            :rows="2"
            placeholder="params, as JSON"
            class="w-full font-mono text-sm"
          />

          <USelect
            v-model="step.polarity"
            :items="[
              { label: 'nominal', value: 'nominal' },
              { label: 'error', value: 'error' },
            ]"
            class="w-40"
          />

          <div>
            <p class="text-sm text-muted mb-1">Depends on</p>
            <div class="space-y-2">
              <div v-for="(_, index) in step.dependsOn" :key="index" class="flex gap-2 items-start">
                <UInput v-model="step.dependsOn[index]" placeholder="S-EARLIER" class="flex-1" />
                <UButton
                  icon="i-lucide-trash-2"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  @click="removeDependsOn(step, index)"
                />
              </div>
              <UButton
                icon="i-lucide-plus"
                variant="soft"
                size="xs"
                label="Add dependency"
                @click="addDependsOn(step)"
              />
            </div>
          </div>

          <div>
            <p class="text-sm text-muted mb-1">Produces</p>
            <div class="space-y-2">
              <div
                v-for="(produced, index) in step.produces"
                :key="index"
                class="flex gap-2 items-start"
              >
                <UInput v-model="produced.name" placeholder="itemTypeId" class="w-40 shrink-0" />
                <UInput
                  v-model="produced.expression"
                  placeholder="extraction expression"
                  class="flex-1"
                />
                <UButton
                  icon="i-lucide-trash-2"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  @click="removeProduces(step, index)"
                />
              </div>
              <UButton
                icon="i-lucide-plus"
                variant="soft"
                size="xs"
                label="Add produced value"
                @click="addProduces(step)"
              />
            </div>
          </div>

          <UFormField
            label="Expectations"
            required
            description="What must hold after this step. At least one."
          >
            <ExpectationListEditor v-model="step.expect" :viewpoints="props.viewpoints" />
          </UFormField>

          <UInput v-model="step.note" placeholder="note (optional)" class="w-full" />
          <USelectMenu
            v-model="step.viewpoints"
            :items="viewpointItems"
            value-key="value"
            multiple
            placeholder="viewpoints"
            class="w-full"
          />
        </div>
        <UButton icon="i-lucide-plus" variant="soft" size="sm" label="Add step" @click="addStep" />
      </div>
    </UFormField>
  </div>
</template>
