import { describe, expect, it } from "vitest";

import { escapeHtml } from "../src/escape.ts";

describe("escapeHtml", () => {
  it("escapes the five characters that matter for html safety", () => {
    expect(escapeHtml(`<b>"it's" & more</b>`)).toBe(
      "&lt;b&gt;&quot;it&#39;s&quot; &amp; more&lt;/b&gt;",
    );
  });

  it("leaves plain text alone", () => {
    expect(escapeHtml("a plain sentence")).toBe("a plain sentence");
  });

  it("neutralises a script tag rather than passing it through", () => {
    const escaped = escapeHtml("<script>alert(1)</script>");
    expect(escaped).not.toContain("<script>");
  });
});
