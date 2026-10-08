import { z } from "zod";

import { EvidenceSource, OperationId, StateRef, VerdictPolicy } from "@agentic-test-hub/core";

import { Connection } from "./connection.ts";
import { Operation } from "./operation.ts";
import { OperationCall, StateProvider } from "./state.ts";

/** Whether `source` compiles as a regular expression. */
function compiles(source: string): boolean {
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
}

/**
 * What to mask before evidence is written to disk, beyond the built-in rules.
 *
 * Saved evidence is meant to be passed around for review, so secrets must not
 * ride along. The hub always masks the values of the `Authorization`,
 * `Cookie`, `Set-Cookie`, `Proxy-Authorization` and `X-API-Key` headers and
 * bearer-style tokens wherever they appear. A target with its own secret
 * headers or secret-looking text declares them here.
 */
export const RedactRules = z.object({
  /** Regular expressions matched, case-insensitively, against whole header names. */
  headers: z
    .array(z.string().min(1).refine(compiles, "not a valid regular expression"))
    .default([]),
  /** Regular expressions whose matches are masked in bodies and header values. */
  patterns: z
    .array(z.string().min(1).refine(compiles, "not a valid regular expression"))
    .default([]),
});
/** What to mask before evidence is written to disk, beyond the built-in rules. */
export type RedactRules = z.infer<typeof RedactRules>;

/** Manifest format this hub understands. */
export const PLUGIN_API_VERSION = "1";

/**
 * Everything the hub needs to know about one target application.
 *
 * The hub has no built-in knowledge of any application; a manifest supplies
 * all of it. Because a manifest is configuration rather than code, a plugin
 * can be read, reviewed and extended by people who do not write TypeScript —
 * which matters, since the people who know a system best are often not the
 * people maintaining its test harness.
 */
export const PluginManifest = z.object({
  /** Manifest format version. Checked on load. */
  apiVersion: z.literal(PLUGIN_API_VERSION),
  /** Short identifier for the target, used in messages and paths. */
  name: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "plugin name must be lower-case and hyphenated"),
  description: z.string().min(1).optional(),
  /** Module exporting handlers for `extension` operations. */
  extensionModule: z.string().min(1).optional(),
  /** Endpoints operations run against, by name. */
  connections: z.record(z.string().min(1), Connection).default({}),
  /** Everything the hub can do against this target, by operation id. */
  operations: z.record(OperationId, Operation).default({}),
  /** How to reach and confirm each state specifications may require. */
  states: z.record(StateRef, StateProvider).default({}),
  /**
   * How each evidence channel is captured for this target.
   *
   * A channel with no collector cannot be gathered, so any case the policy
   * binds to it will be reported inconclusive rather than passed. That is the
   * intended behaviour: a missing collector should be visible, not silently
   * equivalent to everything being fine.
   */
  evidence: z.partialRecord(EvidenceSource, OperationCall).default({}),
  /** Extra masking applied to saved evidence (Python runtime). */
  redact: RedactRules.optional(),
  /** Replaces the default verdict policy for this target. */
  policy: VerdictPolicy.optional(),
});
/** Everything the hub needs to know about one target application. */
export type PluginManifest = z.infer<typeof PluginManifest>;
