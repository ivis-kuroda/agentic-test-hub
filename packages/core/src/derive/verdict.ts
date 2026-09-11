import type { EvidenceSource, EvidenceWaiver, Polarity } from "../schema/evidence.ts";
import type { SourceCondition, VerdictPolicy } from "../schema/policy.ts";

/**
 * What one evidence channel actually showed.
 *
 * Kept to a small set of facts rather than raw captures so that the verdict
 * rules stay checkable: whoever collected the evidence decides what counts as
 * an error on their channel, and this module decides what that means for the
 * outcome.
 */
export interface Observation {
  readonly source: EvidenceSource;
  /**
   * Whether the channel was successfully read.
   *
   * False is not the same as "nothing was wrong". Evidence that was supposed
   * to be gathered and was not leaves the verdict unsettled, and saying so is
   * the whole reason this field exists.
   */
  readonly collected: boolean;
  /** Errors, exceptions or violations seen on this channel. */
  readonly errors?: readonly string[];
  /** HTTP status observed, where the channel carries one. */
  readonly status?: number;
  /** Whether what was seen matches what the case said to expect. */
  readonly matchedExpectation?: boolean;
  /** Rows changed as the case intended. */
  readonly intendedChanges?: number;
  /** Rows changed that the case did not intend, including failed rollback. */
  readonly residualChanges?: number;
}

/** The outcome of judging a run against a policy. */
export type Verdict =
  /** Every binding condition was met. */
  | "pass"
  /** At least one binding condition was contradicted. */
  | "fail"
  /** Not enough evidence to decide. Never reported as a pass. */
  | "inconclusive";

/** Why a single source did not meet its condition. */
export interface ConditionFailure {
  readonly source: EvidenceSource;
  readonly condition: SourceCondition;
  readonly why: string;
}

/** The result of judging a run, with its reasoning intact. */
export interface VerdictResult {
  readonly verdict: Verdict;
  /** Conditions that were contradicted. */
  readonly failures: readonly ConditionFailure[];
  /** Binding sources that were never collected. */
  readonly missing: readonly EvidenceSource[];
  /** Sources that actually carried the decision. */
  readonly decidedBy: readonly EvidenceSource[];
  /**
   * Sources this case was excused from, and why.
   *
   * Reported rather than silently dropped: a verdict reached on fewer
   * channels is a weaker verdict, and the reviewer view says so.
   */
  readonly waived: readonly EvidenceWaiver[];
}

function checkCondition(condition: SourceCondition, observation: Observation): string | undefined {
  const errors = observation.errors ?? [];
  switch (condition) {
    case "informational":
      return undefined;
    case "clean":
      return errors.length === 0 ? undefined : `${errors.length} error(s) reported`;
    case "expected_error":
      if (errors.length === 0) return "no error was reported, but one was expected";
      return observation.matchedExpectation === true
        ? undefined
        : "an error was reported but it is not the expected one";
    case "matches_expectation":
      return observation.matchedExpectation === true
        ? undefined
        : "does not match the stated expectation";
    case "success_response": {
      const status = observation.status;
      if (status === undefined) return "no response status was observed";
      return status >= 200 && status < 300 ? undefined : `status ${status} is not a success`;
    }
    case "error_response": {
      const status = observation.status;
      if (status === undefined) return "no response status was observed";
      return status >= 400 ? undefined : `status ${status} is not a rejection`;
    }
    case "expected_change":
      return (observation.intendedChanges ?? 0) > 0
        ? undefined
        : "the intended data change was not observed";
    case "no_residual_change":
      return (observation.residualChanges ?? 0) === 0
        ? undefined
        : `${observation.residualChanges} unintended change(s) remain`;
  }
}

/**
 * Judges collected evidence against a policy.
 *
 * Three properties are deliberate:
 *
 * - **Missing evidence never passes.** A binding source that was not
 *   collected yields `inconclusive`, so a broken collector degrades into a
 *   visible gap rather than a green run.
 * - **Weak evidence never passes alone.** If the only sources that decided
 *   the outcome are ones the policy marks insufficient by themselves — a
 *   screenshot, typically — the result is `inconclusive`. This is what stops
 *   a suite from certifying a system whose backend failed quietly behind a
 *   correct-looking page.
 * - **Failures name their channel.** The caller learns which observation
 *   contradicted which condition, which is what makes triage possible.
 *
 * @param policy - Rules to judge by.
 * @param polarity - Whether the case expected success or rejection.
 * @param observations - What each channel showed.
 * @returns The verdict together with the reasoning behind it.
 */
export function evaluateVerdict(
  policy: VerdictPolicy,
  polarity: Polarity,
  observations: readonly Observation[],
  waivers: readonly EvidenceWaiver[] = [],
): VerdictResult {
  const rules = policy.rules[polarity] ?? {};
  const seen = new Map(observations.map((observation) => [observation.source, observation]));
  const waivedBySource = new Map(waivers.map((waiver) => [waiver.source, waiver]));

  const failures: ConditionFailure[] = [];
  const missing: EvidenceSource[] = [];
  const decidedBy: EvidenceSource[] = [];
  const waived: EvidenceWaiver[] = [];

  for (const [rawSource, rawCondition] of Object.entries(rules)) {
    const source = rawSource as EvidenceSource;
    const condition = rawCondition as SourceCondition;
    if (condition === "informational") continue;

    const waiver = waivedBySource.get(source);
    if (waiver) {
      if (policy.nonWaivable.includes(source)) {
        failures.push({
          source,
          condition,
          why: `this channel cannot be waived: ${waiver.reason}`,
        });
      } else {
        waived.push(waiver);
      }
      continue;
    }

    const observation = seen.get(source);
    if (!observation || !observation.collected) {
      missing.push(source);
      continue;
    }

    decidedBy.push(source);
    const why = checkCondition(condition, observation);
    if (why !== undefined) failures.push({ source, condition, why });
  }

  if (failures.length > 0) {
    return { verdict: "fail", failures, missing, decidedBy, waived };
  }
  if (missing.length > 0) {
    return { verdict: "inconclusive", failures, missing, decidedBy, waived };
  }

  const weakOnly =
    decidedBy.length > 0 && decidedBy.every((source) => policy.insufficientAlone.includes(source));
  if (decidedBy.length === 0 || weakOnly) {
    return { verdict: "inconclusive", failures, missing, decidedBy, waived };
  }

  return { verdict: "pass", failures, missing, decidedBy, waived };
}

/** A waiver a policy does not permit. */
export interface WaiverProblem {
  readonly source: EvidenceSource;
  readonly reason: string;
}

/**
 * Checks a case's waivers against a policy, for validation ahead of any run.
 *
 * Catching an impermissible waiver when the specification is saved is worth
 * more than catching it when the suite runs: the person who wrote it is still
 * there, and no run has yet been reported on evidence the team had already
 * decided was mandatory.
 *
 * @param policy - Policy the case will be judged under.
 * @param waivers - Waivers the case declares.
 * @returns The waivers the policy forbids; empty when all are permitted.
 */
export function validateWaivers(
  policy: VerdictPolicy,
  waivers: readonly EvidenceWaiver[],
): WaiverProblem[] {
  return waivers
    .filter((waiver) => policy.nonWaivable.includes(waiver.source))
    .map((waiver) => ({ source: waiver.source, reason: waiver.reason }));
}
