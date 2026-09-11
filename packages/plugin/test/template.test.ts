import { describe, expect, it } from "vitest";

import { collectPlaceholders, render, renderDeep, TemplateError } from "../src/template.js";

/** Runs a function and returns whatever it threw, so assertions stay unconditional. */
function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

const scopes = {
  env: { BASE_URL: "https://example.invalid", EMPTY: "" },
  param: { user: "ada", nested: { id: 42 } },
  step: { recordId: "r-7" },
};

describe("render", () => {
  it("substitutes from each scope", () => {
    expect(render("{{env.BASE_URL}}/u/{{param.user}}/{{step.recordId}}", scopes)).toBe(
      "https://example.invalid/u/ada/r-7",
    );
  });

  it("reads a nested path", () => {
    expect(render("{{param.nested.id}}", scopes)).toBe("42");
  });

  it("tolerates whitespace inside the braces", () => {
    expect(render("{{ param.user }}", scopes)).toBe("ada");
  });

  it("substitutes an empty string when that is the actual value", () => {
    expect(render("[{{env.EMPTY}}]", scopes)).toBe("[]");
  });

  it("leaves text without placeholders alone", () => {
    expect(render("select * from items", scopes)).toBe("select * from items");
  });

  it("throws rather than silently dropping an unresolved value", () => {
    expect(() => render("/items/{{param.missing}}", scopes)).toThrow(TemplateError);
  });

  it("names the placeholder that failed", () => {
    const error = thrownBy(() => render("/items/{{param.missing}}", scopes));
    expect(error).toBeInstanceOf(TemplateError);
    expect((error as TemplateError).placeholder).toBe("param.missing");
  });

  it("rejects an unknown scope", () => {
    expect(() => render("{{secrets.token}}", scopes)).toThrow(/unknown scope/);
  });

  it("rejects substituting an object into text", () => {
    expect(() => render("{{param.nested}}", scopes)).toThrow(/cannot be substituted/);
  });
});

describe("renderDeep", () => {
  it("renders strings anywhere in a structure", () => {
    expect(
      renderDeep({ url: "{{env.BASE_URL}}/x", list: ["{{param.user}}", 1, true] }, scopes),
    ).toEqual({ url: "https://example.invalid/x", list: ["ada", 1, true] });
  });

  it("renders object keys too", () => {
    expect(renderDeep({ "{{param.user}}": 1 }, scopes)).toEqual({ ada: 1 });
  });

  it("leaves non-string leaves untouched", () => {
    expect(renderDeep({ n: 1, b: false, z: null }, scopes)).toEqual({ n: 1, b: false, z: null });
  });
});

describe("collectPlaceholders", () => {
  it("finds placeholders without resolving them", () => {
    expect(collectPlaceholders({ a: "{{env.A}}", b: ["{{param.b}}", "{{env.A}}"] }).sort()).toEqual(
      ["env.A", "param.b"],
    );
  });

  it("returns nothing for a structure with no placeholders", () => {
    expect(collectPlaceholders({ a: 1, b: "plain" })).toEqual([]);
  });
});
