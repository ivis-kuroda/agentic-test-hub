import { z } from 'zod';
import { BaselineId, CaseId, FactorId, LevelId } from './id.js';
import { AppliesTo, Target, Traceable } from './common.js';
import { Expectation } from './expectation.js';

/**
 * A single difference between a case and its baseline.
 *
 * `path` is a dotted path into the baseline, such as
 * `context.headers.Content-Disposition` or `config.DIGEST_VERIFICATION`.
 * Which prefix it addresses determines whether the case can share its
 * group's environment.
 */
export const Override = z.object({
  path: z.string().min(1),
  /** `set` writes a value, `remove` deletes the key, `append` extends a list. */
  op: z.enum(['set', 'remove', 'append']).default('set'),
  /** Required for `set` and `append`; rejected for `remove`. */
  value: z.unknown().optional(),
});
/** A single difference between a case and its baseline. */
export type Override = z.infer<typeof Override>;

/** How far a case has progressed towards being executed by machine. */
export const AutomationStatus = z.enum([
  /** Executed by a person; no code exists. */
  'manual',
  /** Code has been generated but not yet confirmed against the application. */
  'generated',
  /** Code exists and has been seen to pass and to fail for the right reason. */
  'verified',
]);

/**
 * One point in the condition space: the baseline with a stated set of
 * differences, and what must then hold.
 *
 * Cases are independent of one another and may run in any order or in
 * parallel. A sequence whose steps depend on earlier state is a
 * {@link Scenario} instead.
 */
export const TestCase = Traceable.extend({
  id: CaseId,
  /**
   * What distinguishes this case, phrased as the condition under test —
   * "the request carries no filename", not "test 18".
   */
  summary: z.string().min(1),
  baseline: BaselineId,
  /** Overrides applied to the baseline, in order. Empty means the baseline itself. */
  overrides: z.array(Override).default([]),
  /** Narrows the inherited target when this case acts somewhere else. */
  target: Target.optional(),
  /**
   * What must hold afterwards.
   *
   * Required and non-empty: a case with nothing to check is not a test.
   */
  expect: z.array(Expectation).min(1),
  /**
   * Explicit placement on a matrix axis.
   *
   * Normally omitted — placement is derived by matching overrides against
   * factor paths. Declare it only for a factor that is not a single override.
   */
  at: z.record(FactorId, LevelId).optional(),
  /**
   * Whether the case may share its group's environment.
   *
   * Derived when omitted: overriding only `context` is shareable, while
   * touching `config` or preconditions demands exclusive execution. Set it
   * explicitly only to correct that inference.
   */
  isolation: z.enum(['shared', 'exclusive']).optional(),
  priority: z.enum(['P1', 'P2', 'P3']).default('P2'),
  tags: z.array(z.string().min(1)).default([]),
  appliesTo: AppliesTo.optional(),
  automation: z
    .object({
      status: AutomationStatus.default('manual'),
      /** Path to the generated test, relative to the plugin repository. */
      impl: z.string().min(1).optional(),
    })
    .default({ status: 'manual' }),
});
/** One point in the condition space. */
export type TestCase = z.infer<typeof TestCase>;
