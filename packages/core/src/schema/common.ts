import { z } from "zod";

import { ViewpointId } from "./id.ts";

/**
 * Where a claim in the specification comes from.
 *
 * Reviewers judge a viewpoint largely by whether its justification is
 * traceable, and an agent proposing viewpoints from design documents and
 * implementation must show its work. Both needs are served by the same field.
 */
export const SourceRef = z.object({
  /** Which kind of artifact the reference points into. */
  kind: z.enum(["design", "code", "issue", "standard", "other"]),
  /**
   * Locator within that artifact. Free-form because the shape differs per
   * kind: a document section, a `path/to/file.py:symbol`, an issue key.
   */
  ref: z.string().min(1),
  /** Optional clarification of what the reference establishes. */
  note: z.string().optional(),
});
/** Where a claim in the specification comes from. */
export type SourceRef = z.infer<typeof SourceRef>;

/**
 * How much is at stake if the behaviour under test is wrong. Used to order
 * the reviewer view, so that attention lands on the riskiest areas first.
 */
export const Risk = z.enum(["high", "medium", "low"]);
/** How much is at stake if the behaviour under test is wrong. */
export type Risk = z.infer<typeof Risk>;

/**
 * What the tester is acting on, mirroring the "screen" and "action" columns
 * of the spreadsheet format this model replaces.
 *
 * A case usually inherits this from its baseline and leaves it unset.
 */
export const Target = z.object({
  /** Screen, endpoint, console or other surface being exercised. */
  surface: z.string().min(1),
  /** The operation performed on that surface, when it narrows the target. */
  action: z.string().min(1).optional(),
});
/** What the tester is acting on. */
export type Target = z.infer<typeof Target>;

/**
 * Fields shared by every entity that appears in the reviewer view.
 *
 * `viewpoints` is the backbone of traceability: it answers "why does this
 * exist" downward and "where is this verified" upward, and coverage reporting
 * is built entirely from it.
 */
export const Traceable = z.object({
  /** Viewpoints this entity contributes evidence for. */
  viewpoints: z.array(ViewpointId).default([]),
  /** Free-form remark carried through to generated views. */
  note: z.string().optional(),
});

/**
 * Version of the target application a specification applies to.
 *
 * Specifications live in their own repository, so the link to the code under
 * test is a recorded commit rather than shared history.
 */
export const AppliesTo = z.object({
  /** Commit of the target repository the specification was written against. */
  commit: z.string().min(7).optional(),
  /** Branch the work was carried out on, for human orientation. */
  branch: z.string().min(1).optional(),
  /** Release or project version label used by the organisation. */
  release: z.string().min(1).optional(),
});
/** Version of the target application a specification applies to. */
export type AppliesTo = z.infer<typeof AppliesTo>;
