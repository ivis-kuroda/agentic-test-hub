import { z } from 'zod';
import { FactorId, LevelId } from './id.js';

/**
 * One value a {@link Factor} can take.
 *
 * `value` is what an override actually writes; `name` is what a reviewer
 * reads. They differ often enough — `null` displayed as "not set", a header
 * removed rather than blanked — that conflating them loses information.
 */
export const Level = z.object({
  id: LevelId,
  /** Human-readable label shown on matrix axes. */
  name: z.string().min(1),
  /** Concrete value written by an override selecting this level. */
  value: z.unknown().optional(),
  /** Present when selecting this level removes the field instead. */
  absent: z.boolean().default(false),
});
/** One value a factor can take. */
export type Level = z.infer<typeof Level>;

/**
 * One axis of the condition space: a thing that varies between cases.
 *
 * Factors are usually derived rather than invented. A suite built as
 * "baseline plus one change" already encodes its factors in the paths its
 * cases override, so `path` lets the two be reconciled automatically and a
 * case be placed on the matrix without anyone tagging it.
 */
export const Factor = z.object({
  id: FactorId,
  /** Human-readable axis label. */
  name: z.string().min(1),
  /** What this factor varies, and why it is worth varying. */
  description: z.string().optional(),
  /**
   * Path into a baseline that overrides for this factor address, such as
   * `context.headers.Content-Length`.
   *
   * Set it and matrix placement is derived from the cases themselves. Leave
   * it unset for a factor that is not expressed as a single override —
   * placement then has to be declared on the case.
   */
  path: z.string().min(1).optional(),
  /** Values the factor can take. At least two, or it does not vary. */
  levels: z.array(Level).min(2),
});
/** One axis of the condition space. */
export type Factor = z.infer<typeof Factor>;
