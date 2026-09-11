import { z } from 'zod';
import { EvidenceSource, Polarity } from './evidence.js';

/**
 * What a single evidence source must show for a test to pass.
 *
 * Conditions are stated per source and per polarity rather than as one
 * overall verdict, so that a failure names the channel that contradicted the
 * expectation instead of reporting an undifferentiated "failed".
 */
export const SourceCondition = z.enum([
  /** No errors, exceptions or violations of any kind. */
  'clean',
  /** An error matching what the case expects is present. */
  'expected_error',
  /** Matches the case's stated expectations. */
  'matches_expectation',
  /** A successful response: any 2xx status. */
  'success_response',
  /** A rejection the case expects: a 4xx or 5xx status. */
  'error_response',
  /** The intended rows were written, updated or removed. */
  'expected_change',
  /** Nothing was left behind: the action rolled back cleanly. */
  'no_residual_change',
  /** Collected for the record, but not used to decide the verdict. */
  'informational',
]);
/** What a single evidence source must show for a test to pass. */
export type SourceCondition = z.infer<typeof SourceCondition>;

/**
 * The rules by which collected evidence becomes a verdict.
 *
 * Making this data rather than runner behaviour has a specific purpose: the
 * standard a suite is held to becomes reviewable, diffable and arguable. A
 * team that decides database logs are advisory rather than binding records
 * that decision in one place instead of discovering it in scattered code.
 */
export const VerdictPolicy = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  /** Condition each source must meet, per polarity. */
  rules: z.record(Polarity, z.record(EvidenceSource, SourceCondition)),
  /**
   * Sources that can never settle a verdict on their own.
   *
   * Encodes the rule that a screenshot is not proof: a run whose only
   * deciding evidence is listed here is reported as inconclusive rather than
   * as a pass, which is the difference between a suite that catches broken
   * backends and one that photographs them looking fine.
   */
  insufficientAlone: z.array(EvidenceSource).default(['screenshot']),
});
/** The rules by which collected evidence becomes a verdict. */
export type VerdictPolicy = z.infer<typeof VerdictPolicy>;

/**
 * The default standard: every source is binding, and the two polarities are
 * judged by opposite rules.
 *
 * A success case demands quiet on every channel and a visible change in the
 * data. A rejection case demands the opposite — the expected error observable
 * at the client, in the response, and in the logs — plus proof that nothing
 * was left behind. "It errored" is not enough; the error has to be the one
 * that was expected, in the place it was expected.
 */
export const DEFAULT_VERDICT_POLICY: VerdictPolicy = VerdictPolicy.parse({
  id: 'default',
  title: 'Cross-checked evidence across client, service and data',
  rules: {
    nominal: {
      screenshot: 'matches_expectation',
      browser_console: 'clean',
      browser_network: 'success_response',
      db_records: 'expected_change',
      app_log: 'clean',
      db_log: 'clean',
    },
    error: {
      screenshot: 'expected_error',
      browser_console: 'informational',
      browser_network: 'error_response',
      db_records: 'no_residual_change',
      app_log: 'expected_error',
      db_log: 'informational',
    },
  },
  insufficientAlone: ['screenshot'],
});
