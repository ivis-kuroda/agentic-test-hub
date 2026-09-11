import { buildViewpointCoverage, type Risk, type Suite } from "@agentic-test-hub/core";

import { escapeHtml } from "./escape.ts";

const RISK_ORDER: Readonly<Record<Risk, number>> = { high: 0, medium: 1, low: 2 };

function sourceList(source: Suite["viewpoints"][number]["source"]): string {
  return `<ul class="source-list">${source
    .map((ref) => {
      const note = ref.note === undefined ? "" : ` — ${escapeHtml(ref.note)}`;
      return `<li><code>${escapeHtml(ref.kind)}</code>: ${escapeHtml(ref.ref)}${note}</li>`;
    })
    .join("")}</ul>`;
}

/**
 * Renders the viewpoint list: what the suite claims, ordered so the riskiest
 * claims are read first, each showing what actually verifies it.
 *
 * This is the section reviewers spend the most time on. A step describes
 * keystrokes; a viewpoint describes the claim those keystrokes support, and a
 * reviewer arguing with the suite argues with this list, not with the steps.
 *
 * @param suite - The suite to render.
 * @returns An HTML section.
 */
export function renderViewpointsSection(suite: Suite): string {
  if (suite.viewpoints.length === 0) {
    return '<section id="viewpoints"><h2>Viewpoints</h2><p class="empty">No viewpoints are declared yet.</p></section>';
  }

  const coverage = buildViewpointCoverage(suite.viewpoints, suite.cases, suite.scenarios);
  const sorted = [...coverage].sort(
    (a, b) => RISK_ORDER[a.viewpoint.risk] - RISK_ORDER[b.viewpoint.risk],
  );
  const uncoveredCount = coverage.filter((entry) => entry.uncovered).length;

  const rows = sorted
    .map((entry) => {
      const { viewpoint } = entry;
      const references = [
        ...entry.cases.map((id) => `<code>${escapeHtml(id)}</code>`),
        ...entry.steps.map((id) => `<code>${escapeHtml(id)}</code>`),
      ];
      const coverageLine = entry.uncovered
        ? '<p class="coverage-line"><span class="badge uncovered">uncovered</span> nothing verifies this viewpoint</p>'
        : `<p class="coverage-line"><span class="n">${references.length}</span> reference(s): ${references.join(", ")}</p>`;

      return `<article class="viewpoint risk-${viewpoint.risk}${entry.uncovered ? " uncovered" : ""}">
  <h3>${escapeHtml(viewpoint.title)} <span class="badge risk-${viewpoint.risk}">${viewpoint.risk}</span></h3>
  <p class="rationale">${escapeHtml(viewpoint.rationale)}</p>
  ${sourceList(viewpoint.source)}
  ${coverageLine}
</article>`;
    })
    .join("\n");

  return `<section id="viewpoints">
  <h2>Viewpoints</h2>
  <div class="stats">
    <div class="stat"><span class="n">${coverage.length}</span><span class="label">viewpoints</span></div>
    <div class="stat${uncoveredCount > 0 ? " gap" : ""}"><span class="n">${uncoveredCount}</span><span class="label">uncovered</span></div>
  </div>
  ${rows}
</section>`;
}
