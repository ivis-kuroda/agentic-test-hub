import { join } from "node:path";

import {
  Baseline,
  Factor,
  Matrix,
  Scenario,
  TestCase,
  Viewpoint,
  type Suite,
} from "@agentic-test-hub/core";

import type { AnySchema } from "./order.ts";

/** The kinds of entity a suite is made of. */
export type EntityKind = "viewpoint" | "factor" | "matrix" | "baseline" | "case" | "scenario";

/** Where one kind of entity lives, and what validates it. */
export interface EntityLayout {
  readonly kind: EntityKind;
  /** Directory under the specification root. */
  readonly directory: string;
  readonly schema: AnySchema;
  /** Field of {@link Suite} the entities are collected into. */
  readonly collection: keyof Suite;
  /** Identifier prefix, used to check that a file is where it belongs. */
  readonly prefix: string;
}

/**
 * One file per entity, named after its identifier.
 *
 * A file per entity rather than one file per kind, for three reasons that all
 * matter at the scale a real suite reaches: two people editing different
 * cases do not conflict, an agent reading one case does not have to hold a
 * thousand, and a change to a case shows up in history as a change to that
 * case.
 */
export const LAYOUTS: readonly EntityLayout[] = [
  {
    kind: "viewpoint",
    directory: "viewpoints",
    schema: Viewpoint,
    collection: "viewpoints",
    prefix: "VP",
  },
  { kind: "factor", directory: "factors", schema: Factor, collection: "factors", prefix: "F" },
  { kind: "matrix", directory: "matrices", schema: Matrix, collection: "matrices", prefix: "MX" },
  {
    kind: "baseline",
    directory: "baselines",
    schema: Baseline,
    collection: "baselines",
    prefix: "BL",
  },
  { kind: "case", directory: "cases", schema: TestCase, collection: "cases", prefix: "TC" },
  {
    kind: "scenario",
    directory: "scenarios",
    schema: Scenario,
    collection: "scenarios",
    prefix: "SC",
  },
];

/** Looks up a layout by kind. */
export function layoutFor(kind: EntityKind): EntityLayout {
  const layout = LAYOUTS.find((candidate) => candidate.kind === kind);
  if (!layout) throw new Error(`unknown entity kind: ${kind}`);
  return layout;
}

/**
 * Builds the path an entity is stored at.
 *
 * @param root - Specification root directory.
 * @param kind - What kind of entity it is.
 * @param id - The entity's identifier.
 * @returns The absolute path of its file.
 */
export function pathFor(root: string, kind: EntityKind, id: string): string {
  return join(root, layoutFor(kind).directory, `${id}.yaml`);
}
