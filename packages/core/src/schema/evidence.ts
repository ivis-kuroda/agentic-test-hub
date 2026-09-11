import { z } from "zod";

/**
 * A channel through which a test's behaviour can be observed.
 *
 * The set is deliberately wider than screenshots. A screenshot proves what a
 * page rendered and nothing else: it cannot show that the API returned the
 * status it should have, that the database actually changed, or that the
 * server logged an exception on the way. A suite that judges by screenshot
 * alone passes tests whose backend is broken.
 *
 * Names are generic on purpose; the active plugin decides how each is
 * collected for its target.
 */
export const EvidenceSource = z.enum([
  /** Rendered appearance of the surface under test. */
  "screenshot",
  /** Client-side errors and warnings reported by the browser. */
  "browser_console",
  /** Requests the client made, with status codes and bodies. */
  "browser_network",
  /** Database rows before and after the action, compared. */
  "db_records",
  /** Application or service logs produced during the action. */
  "app_log",
  /** Database server logs: errors, constraint violations, slow queries. */
  "db_log",
]);
/** A channel through which a test's behaviour can be observed. */
export type EvidenceSource = z.infer<typeof EvidenceSource>;

/** When evidence is captured relative to the action under test. */
export const CaptureTiming = z.enum([
  /** Once before the action, to establish a baseline for comparison. */
  "before",
  /** Once after the action. */
  "after",
  /** Around every step, for scenarios where intermediate state matters. */
  "each_step",
  /** Only when something failed, to keep passing runs cheap. */
  "on_failure",
]);
/** When evidence is captured relative to the action under test. */
export type CaptureTiming = z.infer<typeof CaptureTiming>;

/**
 * Whether a test expects the system to succeed or to reject the input.
 *
 * This is not cosmetic: the two are judged by opposite rules. A clean
 * application log is required for a success case and is a *failure signal*
 * for an error case, where the absence of the expected error means the
 * system did not reject what it should have. Without this field a runner
 * cannot tell which rule to apply.
 */
export const Polarity = z.enum(["nominal", "error"]);
/** Whether a test expects the system to succeed or to reject the input. */
export type Polarity = z.infer<typeof Polarity>;

/** What evidence to collect for a case or scenario, and when. */
export const EvidencePlan = z.object({
  /** Sources to collect. Defaults to every source. */
  sources: z.array(EvidenceSource).default([...EvidenceSource.options]),
  /** When to capture. */
  timing: CaptureTiming.default("after"),
  /**
   * Also capture a full execution trace. Traces are large, so the default
   * keeps them for failures, where they are worth their size.
   */
  trace: z.enum(["always", "on_failure", "never"]).default("on_failure"),
  /**
   * Regular expressions matching log and console output that is already
   * present before the change under test.
   *
   * Without this, "no errors on this channel" is unusable against a mature
   * application: existing warnings would fail every case, and the usual
   * response is to stop looking at the channel entirely. Filtering known
   * noise keeps the condition meaningful — it asks whether *this change*
   * introduced anything, which is the question worth asking.
   *
   * Suppressed entries are counted and reported, so the allowance stays
   * visible rather than quietly growing.
   */
  ignore: z.array(z.string().min(1)).default([]),
});
/** What evidence to collect for a case or scenario, and when. */
export type EvidencePlan = z.infer<typeof EvidencePlan>;

/** Collection settings with every default filled in. */
export const DEFAULT_EVIDENCE_PLAN: EvidencePlan = EvidencePlan.parse({});

/**
 * Permission for one case to be judged without one evidence channel.
 *
 * Not every case can produce every kind of evidence: some exercise paths that
 * touch no data, some run where a log is unavailable. Forcing those to
 * declare evidence they cannot supply would make the requirement a formality,
 * and formalities get switched off.
 *
 * The escape is deliberately uncomfortable. A waiver names one channel,
 * demands a reason, cannot touch the channels a policy protects, and shows up
 * in the reviewer view — so a case resting on thin evidence looks thin.
 */
export const EvidenceWaiver = z.object({
  /** The channel this case will not be judged on. */
  source: EvidenceSource,
  /** Why this case cannot supply it. Shown to reviewers verbatim. */
  reason: z.string().min(1),
});
/** Permission for one case to be judged without one evidence channel. */
export type EvidenceWaiver = z.infer<typeof EvidenceWaiver>;
