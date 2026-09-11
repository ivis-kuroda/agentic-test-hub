import { validateSuite, type Suite } from "@agentic-test-hub/core";

import { escapeHtml } from "./escape.ts";
import { renderMatricesSection } from "./matrices-section.ts";
import { STYLES } from "./styles.ts";
import { renderViewpointsSection } from "./viewpoints-section.ts";

/** Identifies the suite the view was generated from, for the page header. */
export interface ReviewerViewMeta {
  readonly title: string;
  /** Shown under the title, e.g. a target name and a commit. */
  readonly subtitle?: string;
  /** When the view was generated, shown in the footer. Defaults to now. */
  readonly generatedAt?: Date;
}

function renderProblems(suite: Suite): string {
  const problems = validateSuite(suite);
  if (problems.length === 0) return "";

  const items = problems
    .map(
      (problem) =>
        `<li class="${problem.severity}"><code>${escapeHtml(problem.at)}</code>: ${escapeHtml(problem.message)}</li>`,
    )
    .join("");
  const errorCount = problems.filter((problem) => problem.severity === "error").length;

  return `<section id="problems">
  <h2>Issues found in this suite</h2>
  <p class="subtitle">${errorCount} error(s), ${problems.length - errorCount} warning(s).</p>
  <ul class="source-list">${items}</ul>
</section>`;
}

/**
 * Renders the reviewer view: a single self-contained HTML file built from a
 * suite, for the audience that reads viewpoints and matrices rather than
 * steps.
 *
 * This is one of three views generated from the same source — alongside the
 * execution view Playwright and an agent consume, and the delivery view that
 * reproduces an organisation's spreadsheet layout. None of the three is
 * authoritative; the specification files are, and this is thrown away and
 * regenerated on every change.
 *
 * @param suite - The suite to render.
 * @param meta - Page title and generation context.
 * @returns A complete HTML document, with no external dependencies.
 */
export function renderReviewerView(suite: Suite, meta: ReviewerViewMeta): string {
  const generatedAt = meta.generatedAt ?? new Date();
  const subtitle =
    meta.subtitle === undefined ? "" : `<p class="subtitle">${escapeHtml(meta.subtitle)}</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(meta.title)}</title>
<style>${STYLES}</style>
</head>
<body>
<h1>${escapeHtml(meta.title)}</h1>
${subtitle}
<div class="stats">
  <div class="stat"><span class="n">${suite.viewpoints.length}</span><span class="label">viewpoints</span></div>
  <div class="stat"><span class="n">${suite.factors.length}</span><span class="label">factors</span></div>
  <div class="stat"><span class="n">${suite.matrices.length}</span><span class="label">matrices</span></div>
  <div class="stat"><span class="n">${suite.cases.length}</span><span class="label">cases</span></div>
  <div class="stat"><span class="n">${suite.scenarios.length}</span><span class="label">scenarios</span></div>
</div>
${renderProblems(suite)}
${renderViewpointsSection(suite)}
${renderMatricesSection(suite)}
<footer>Generated ${escapeHtml(generatedAt.toISOString())}. Regenerated from source on every change; not itself a source of truth.</footer>
</body>
</html>
`;
}
