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
});
/** What evidence to collect for a case or scenario, and when. */
export type EvidencePlan = z.infer<typeof EvidencePlan>;

/** Collection settings with every default filled in. */
export const DEFAULT_EVIDENCE_PLAN: EvidencePlan = EvidencePlan.parse({});
