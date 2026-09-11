import { describe, expect, it } from "vitest";

import { EMPTY_SUITE, type Suite } from "@agentic-test-hub/core";

import {
  authViewpoint,
  auditViewpoint,
  baseline,
  caseBaselineEmail,
  caseNoAuth,
  factors,
  matrix,
  viewpoints,
} from "../../core/test/fixtures.ts";
import { renderReviewerView } from "../src/reviewer-view.ts";

const soundSuite: Suite = {
  ...EMPTY_SUITE,
  viewpoints: [authViewpoint],
  factors,
  matrices: [matrix],
  baselines: [baseline],
  cases: [caseBaselineEmail, caseNoAuth],
};

describe("renderReviewerView", () => {
  it("produces a complete, well-formed document", () => {
    const html = renderReviewerView(soundSuite, { title: "Review" });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("</html>");
  });

  it("escapes the title, so a suite name cannot inject markup", () => {
    const html = renderReviewerView(soundSuite, { title: "<script>x</script>" });
    expect(html).not.toContain("<script>x</script>");
  });

  it("shows a subtitle when given one, and omits it otherwise", () => {
    const withSubtitle = renderReviewerView(soundSuite, { title: "t", subtitle: "commit abc123" });
    expect(withSubtitle).toContain("commit abc123");
    const without = renderReviewerView(soundSuite, { title: "t" });
    expect(without).not.toContain('class="subtitle"');
  });

  it("renders every viewpoint's title and rationale", () => {
    const html = renderReviewerView(soundSuite, { title: "t" });
    expect(html).toContain(authViewpoint.title);
    expect(html).toContain(authViewpoint.rationale);
  });

  it("marks a viewpoint nothing references as uncovered", () => {
    const suite = { ...soundSuite, viewpoints };
    const html = renderReviewerView(suite, { title: "t" });
    expect(html).toContain(auditViewpoint.title);
    const auditSection = html.slice(html.indexOf(auditViewpoint.title));
    expect(auditSection.slice(0, 400)).toContain("uncovered");
  });

  it("orders viewpoints with the riskiest first", () => {
    const low = { ...auditViewpoint, id: "VP-LOW", risk: "low" as const };
    const suite = { ...soundSuite, viewpoints: [low, authViewpoint] };
    const html = renderReviewerView(suite, { title: "t" });
    expect(html.indexOf(authViewpoint.title)).toBeLessThan(html.indexOf(low.title));
  });

  it("renders a matrix with covered, excluded and gap cells", () => {
    const html = renderReviewerView(soundSuite, { title: "t" });
    expect(html).toContain('class="cell covered"');
    expect(html).toContain('class="cell excluded"');
    expect(html).toContain('class="cell gap"');
  });

  it("shows the exclusion reason as a tooltip on the excluded cell", () => {
    const html = renderReviewerView(soundSuite, { title: "t" });
    expect(html).toContain(matrix.exclusions[0]?.reason);
  });

  it("names the cases behind a covered cell", () => {
    const html = renderReviewerView(soundSuite, { title: "t" });
    expect(html).toContain(caseBaselineEmail.id);
  });

  it("handles an empty suite without throwing", () => {
    expect(() => renderReviewerView(EMPTY_SUITE, { title: "t" })).not.toThrow();
  });

  it("says so when there are no viewpoints yet", () => {
    const html = renderReviewerView(EMPTY_SUITE, { title: "t" });
    expect(html).toContain("No viewpoints are declared yet");
  });

  it("says so when there are no matrices yet", () => {
    const html = renderReviewerView(EMPTY_SUITE, { title: "t" });
    expect(html).toContain("No matrices are declared yet");
  });

  it("surfaces a dangling reference as an issue", () => {
    const broken: Suite = {
      ...EMPTY_SUITE,
      cases: [{ ...caseBaselineEmail, baseline: "BL-GONE" }],
    };
    const html = renderReviewerView(broken, { title: "t" });
    expect(html).toContain("Issues found in this suite");
    expect(html).toContain("BL-GONE");
  });

  it("does not show an issues section when the suite is sound", () => {
    const html = renderReviewerView(soundSuite, { title: "t" });
    expect(html).not.toContain("Issues found in this suite");
  });

  it("reports unplaced cases and off-axis exclusions as matrix notes", () => {
    const orphan = { ...caseBaselineEmail, id: "TC-ORPHAN-001", baseline: "BL-GONE" };
    const suite = { ...soundSuite, cases: [...soundSuite.cases, orphan] };
    const html = renderReviewerView(suite, { title: "t" });
    expect(html).toContain("TC-ORPHAN-001");
    expect(html).toContain("could not be placed");
  });

  it("stamps a fixed generation time when given one", () => {
    const html = renderReviewerView(soundSuite, {
      title: "t",
      generatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(html).toContain("2026-01-01T00:00:00.000Z");
  });
});
