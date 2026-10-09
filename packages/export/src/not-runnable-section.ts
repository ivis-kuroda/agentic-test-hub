import type { Suite } from "@agentic-test-hub/core";

import { escapeHtml } from "./escape.ts";

/**
 * Renders the cases that cannot be run, each with the reason and how that was
 * established.
 *
 * Kept apart from the viewpoint list because these are not gaps in the suite
 * (the case exists and is specified) and not manual work either: nobody can
 * run them, and a reader deciding what to do next needs the reason.
 *
 * @param suite - The suite to render.
 * @returns An HTML section, or an empty string when every case can be run.
 */
export function renderNotRunnableSection(suite: Suite): string {
  const cases = suite.cases.filter((testCase) => testCase.automation.status === "not_runnable");
  if (cases.length === 0) return "";

  const items = cases
    .map((testCase) => {
      const { reason, checkedAt, checkedBy } = testCase.automation;
      const checked = [checkedAt, checkedBy]
        .filter((part): part is string => part !== undefined)
        .map(escapeHtml)
        .join(" — ");
      return `<li><code>${escapeHtml(testCase.id)}</code>: ${escapeHtml(testCase.summary)}<br>Reason: ${escapeHtml(reason ?? "(none recorded)")}${checked === "" ? "" : `<br>Checked: ${checked}`}</li>`;
    })
    .join("");

  return `<section id="not-runnable">
  <h2>Not runnable (実施不可)</h2>
  <p class="subtitle">${cases.length} case(s) cannot be run by machine or by hand as specified.</p>
  <ul class="source-list">${items}</ul>
</section>`;
}
