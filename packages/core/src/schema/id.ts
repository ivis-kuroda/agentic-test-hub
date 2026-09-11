import { z } from 'zod';

/**
 * Every entity in the specification model is addressed by a stable,
 * human-authored identifier of the form `PREFIX-SEGMENT[-SEGMENT...]`, for
 * example `TC-SWORD-CREATE-018`.
 *
 * Identifiers are permanent. Renumbering or reusing one silently re-points
 * every run result, bug reference and matrix cell that mentions it, so an
 * entity that is removed takes its identifier with it.
 */
const SEGMENTS = '[A-Z0-9]+(?:-[A-Z0-9]+)*';

/**
 * Builds a schema for identifiers carrying the given prefix.
 *
 * @param prefix - Uppercase prefix that marks the entity kind, without the
 *   separating hyphen.
 * @param entity - Human-readable entity name, used in validation messages.
 * @returns A string schema accepting only identifiers of that kind.
 */
export function idSchema(prefix: string, entity: string) {
  const pattern = new RegExp(`^${prefix}-${SEGMENTS}$`);
  return z
    .string()
    .regex(pattern, `${entity} id must look like ${prefix}-EXAMPLE-001`);
}

/** Identifies a {@link Viewpoint}: what a test is meant to establish. */
export const ViewpointId = idSchema('VP', 'viewpoint');
/** Identifies a {@link Factor}: one axis of the condition space. */
export const FactorId = idSchema('F', 'factor');
/** Identifies a {@link Level}: one value a factor can take. */
export const LevelId = idSchema('L', 'level');
/** Identifies a {@link Matrix}: a chosen projection of the condition space. */
export const MatrixId = idSchema('MX', 'matrix');
/** Identifies a {@link Baseline}: a complete, executable starting point. */
export const BaselineId = idSchema('BL', 'baseline');
/** Identifies an operation declared by the active plugin. */
export const OperationId = idSchema('OP', 'operation');
/** Identifies a {@link TestCase}: one point in the condition space. */
export const CaseId = idSchema('TC', 'case');
/** Identifies a {@link Scenario}: an ordered, stateful sequence of steps. */
export const ScenarioId = idSchema('SC', 'scenario');
/** Identifies a step within a scenario. Unique within its scenario only. */
export const StepId = idSchema('S', 'step');

/**
 * Names a required state, such as `db.item_type_mapping.pristine`.
 *
 * States are namespaced capability names rather than entity identifiers: a
 * specification declares the state it needs, and the active plugin supplies
 * the means to reach and to verify it. The hub never interprets the name.
 */
export const StateRef = z
  .string()
  .regex(
    /^[a-z0-9]+(?:[._][a-z0-9]+)*$/,
    'state ref must be a dotted lower-case name such as db.items.pristine',
  );
