import type { EvidencePlan, EvidenceSource, Observation } from "@agentic-test-hub/core";

import type { BrowserSession, ConsoleMessage, NetworkExchange } from "./executor/browser.ts";
import type { ExecutionResult } from "./executor/types.ts";

/** Splits entries into those that count and those filtered as known noise. */
function partition<T>(
  entries: readonly T[],
  text: (entry: T) => string,
  patterns: readonly RegExp[],
): { kept: T[]; suppressed: number } {
  const kept: T[] = [];
  let suppressed = 0;
  for (const entry of entries) {
    if (patterns.some((pattern) => pattern.test(text(entry)))) suppressed += 1;
    else kept.push(entry);
  }
  return { kept, suppressed };
}

/**
 * Compiles ignore patterns, discarding any that are not valid expressions.
 *
 * A malformed pattern is dropped rather than allowed to abort a run: the
 * consequence of dropping it is that some known noise is reported, which is
 * noticeable and harmless. The consequence of the alternative is a suite that
 * will not start.
 */
function compile(patterns: readonly string[]): RegExp[] {
  return patterns.flatMap((pattern) => {
    try {
      return [new RegExp(pattern)];
    } catch {
      return [];
    }
  });
}

/** How the exchange whose status decides the verdict is picked. */
export type PrimaryExchange = (exchange: NetworkExchange) => boolean;

/**
 * The exchange a browser-driven case is usually about.
 *
 * A page makes many requests, most of them incidental — assets, polling,
 * navigation. The one a case cares about is almost always the one its action
 * triggered, which is almost always the request that changed something. This
 * is a heuristic and is overridable, because a heuristic presented as a rule
 * is how a suite starts asserting on the wrong request.
 */
export const lastMutation: PrimaryExchange = (exchange) =>
  exchange.method !== "GET" && exchange.method !== "HEAD";

/** Settings for turning observations into evidence. */
export interface ObserveOptions {
  /** Patterns matching output that predates the change under test. */
  readonly ignore?: readonly string[];
  /** Which exchange's status decides the network channel. */
  readonly primary?: PrimaryExchange;
}

/**
 * Reads the two channels that exist only while a page is open.
 *
 * Console output and network traffic cannot be gathered afterwards by running
 * an operation — they are gone when the session closes — which is why they
 * come from the session rather than from the plugin's evidence collectors.
 *
 * A screenshot is deliberately not among them. Whether a page looks right
 * cannot be decided by comparison, so the image is kept as an artifact and
 * the judgement is made separately; manufacturing a `matchedExpectation` here
 * would be the harness marking its own homework.
 *
 * @param session - The live session to read.
 * @param options - Noise filtering and which exchange matters.
 * @returns One observation for the console and one for the network.
 */
export function observeBrowser(
  session: BrowserSession,
  options: ObserveOptions = {},
): Observation[] {
  const patterns = compile(options.ignore ?? []);

  const consoleErrors = session
    .consoleMessages()
    .filter((message: ConsoleMessage) => message.level === "error" || message.level === "warn");
  // Matched against the location too: a browser reporting a failed
  // subresource names it only there, so text-only matching cannot distinguish
  // an absent optional asset from a real fault.
  const consoleSplit = partition(
    consoleErrors,
    (message) => `${message.text} ${message.location ?? ""}`,
    patterns,
  );

  const exchanges = session.networkExchanges();
  const networkFailures = exchanges.filter(
    (exchange) => exchange.failed === true || exchange.status >= 500,
  );
  const networkSplit = partition(networkFailures, (exchange) => exchange.url, patterns);

  const isPrimary = options.primary ?? lastMutation;
  const candidates = exchanges.filter(isPrimary);
  const primary = candidates.at(-1) ?? exchanges.at(-1);

  return [
    {
      source: "browser_console",
      collected: true,
      errors: consoleSplit.kept.map((message) => `${message.level}: ${message.text}`),
      suppressed: consoleSplit.suppressed,
    },
    {
      source: "browser_network",
      collected: true,
      errors: networkSplit.kept.map(
        (exchange) => `${exchange.method} ${exchange.url} -> ${exchange.status}`,
      ),
      suppressed: networkSplit.suppressed,
      ...(primary === undefined ? {} : { status: primary.status }),
    },
  ];
}

/** Words that mark a log line as reporting a problem. */
const PROBLEM = /\b(error|exception|traceback|fatal|critical|constraint violation)\b/i;

/**
 * Turns what an evidence operation produced into an observation.
 *
 * Used for the channels a plugin gathers by running something — application
 * logs, database logs, row counts. What counts as a problem is decided by
 * looking for the words that mark one, which is crude but honest: the
 * alternative is a per-target parser, and a log format that changes would
 * then silently stop reporting anything.
 *
 * @param source - Which channel this is.
 * @param result - What the collecting operation produced.
 * @param options - Noise filtering.
 * @returns The observation, marked uncollected when the operation failed.
 */
export function observeFromResult(
  source: EvidenceSource,
  result: ExecutionResult,
  options: ObserveOptions = {},
): Observation {
  if (!result.ok) {
    // Not "nothing was wrong": the channel could not be read, and a verdict
    // reached without it is unsettled rather than clean.
    return { source, collected: false, errors: [result.failure ?? "collection failed"] };
  }

  const text = [result.stdout ?? "", result.stderr ?? ""].filter(Boolean).join("\n");
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const problems = lines.filter((line) => PROBLEM.test(line));
  const split = partition(problems, (line) => line, compile(options.ignore ?? []));

  return {
    source,
    collected: true,
    errors: split.kept,
    suppressed: split.suppressed,
  };
}

/** Channels a plugin gathers by running an operation. */
export const COLLECTED_BY_OPERATION: readonly EvidenceSource[] = [
  "db_records",
  "app_log",
  "db_log",
];

/** Channels that exist only while a browser session is open. */
export const COLLECTED_FROM_SESSION: readonly EvidenceSource[] = [
  "screenshot",
  "browser_console",
  "browser_network",
];

/**
 * Reports channels a plan asks for that nothing can supply.
 *
 * A channel with no source is not an error to fail on — it is a gap, and the
 * verdict already reports it as leaving the outcome unsettled. Surfacing it
 * here lets a plugin be told what it is missing before a run rather than
 * after.
 *
 * @param plan - What the suite intends to collect.
 * @param declared - Channels the plugin declares a collector for.
 * @param hasSession - Whether a browser session will be available.
 * @returns Channels that will not be gathered.
 */
export function unsuppliedChannels(
  plan: EvidencePlan,
  declared: readonly EvidenceSource[],
  hasSession: boolean,
): EvidenceSource[] {
  return plan.sources.filter((source) => {
    if (COLLECTED_FROM_SESSION.includes(source)) return !hasSession;
    return !declared.includes(source);
  });
}
