import { z } from "zod";

import { Risk, SourceRef } from "./common.ts";
import { ViewpointId } from "./id.ts";

/**
 * Something the suite sets out to establish, stated independently of how it
 * is checked.
 *
 * Viewpoints, not steps, are what external reviewers read. A step describes
 * keystrokes; a viewpoint describes the claim those keystrokes support, and
 * only the claim can be argued with. Keeping them separate is what lets the
 * same source produce a review document and an execution document.
 */
export const Viewpoint = z.object({
  id: ViewpointId,
  /** Short statement of the claim, as a reviewer would phrase it. */
  title: z.string().min(1),
  /** Why the claim matters and what goes wrong if it does not hold. */
  rationale: z.string().min(1),
  /**
   * Evidence that the claim is a real requirement.
   *
   * Required and non-empty: a viewpoint nobody can trace to a design
   * document, an implementation or a standard is an assumption, and
   * reviewers are entitled to see which one it is.
   */
  source: z.array(SourceRef).min(1),
  risk: Risk.default("medium"),
  /**
   * Viewpoints this one specialises, for grouping in the reviewer view.
   * Cycles are rejected at validation time.
   */
  parents: z.array(ViewpointId).default([]),
});
/** Something the suite sets out to establish. */
export type Viewpoint = z.infer<typeof Viewpoint>;
