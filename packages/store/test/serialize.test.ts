import { describe, expect, it } from "vitest";

import { Factor, TestCase, Viewpoint } from "@agentic-test-hub/core";

import { canonicalise, declaredKeys, unwrap } from "../src/order.ts";
import { checkRoundTrip, fromYaml, toYaml } from "../src/serialize.ts";

const viewpoint = Viewpoint.parse({
  id: "VP-AUTH",
  title: "requests without credentials are rejected",
  rationale: "an unauthenticated caller must not be able to send anything",
  source: [{ kind: "design", ref: "service design, section 2" }],
  risk: "high",
});

const testCase = TestCase.parse({
  id: "TC-DISPATCH-001",
  summary: "the standard request is accepted",
  baseline: "BL-DISPATCH-STD",
  expect: [{ kind: "http_status", status: 200 }],
});

describe("canonicalise", () => {
  it("puts keys in the order the schema declares them", () => {
    const scrambled = {
      risk: "high",
      id: "VP-X",
      rationale: "r",
      parents: [],
      title: "t",
      source: [],
    };
    expect(Object.keys(canonicalise(scrambled, Viewpoint) as object)).toEqual(
      declaredKeys(Viewpoint),
    );
  });

  it("produces the same order however the object was built", () => {
    const a = canonicalise({ id: "VP-X", title: "t", rationale: "r", source: [] }, Viewpoint);
    const b = canonicalise({ source: [], rationale: "r", title: "t", id: "VP-X" }, Viewpoint);
    expect(Object.keys(a as object)).toEqual(Object.keys(b as object));
  });

  it("omits keys the value does not have, rather than inventing them", () => {
    const ordered = canonicalise({ id: "VP-X", title: "t" }, Viewpoint) as object;
    expect(Object.keys(ordered)).toEqual(["id", "title"]);
  });

  it("keeps a key the schema does not describe, rather than dropping data", () => {
    const ordered = canonicalise({ title: "t", id: "VP-X", stray: 1 }, Viewpoint) as object;
    expect(Object.keys(ordered)).toEqual(["id", "title", "stray"]);
  });

  it("orders nested objects too", () => {
    const ordered = canonicalise(
      { id: "VP-X", title: "t", rationale: "r", source: [{ note: "n", ref: "r", kind: "code" }] },
      Viewpoint,
    ) as { source: object[] };
    expect(Object.keys(ordered.source[0] ?? {})).toEqual(["kind", "ref", "note"]);
  });

  it("orders through a union by finding the member that fits", () => {
    const ordered = canonicalise(
      {
        id: "TC-X-001",
        summary: "s",
        baseline: "BL-X",
        expect: [{ status: 404, kind: "http_status" }],
      },
      TestCase,
    ) as { expect: object[] };
    expect(Object.keys(ordered.expect[0] ?? {})[0]).toBe("kind");
  });

  it("sorts record keys, which carry no declared order", () => {
    const ordered = canonicalise(
      {
        id: "TC-X-001",
        summary: "s",
        baseline: "BL-X",
        expect: [],
        at: { "F-B": "L-1", "F-A": "L-2" },
      },
      TestCase,
    ) as { at: object };
    expect(Object.keys(ordered.at)).toEqual(["F-A", "F-B"]);
  });

  it("leaves a value alone when its schema describes no shape", () => {
    expect(canonicalise(42, Factor)).toBe(42);
  });
});

describe("unwrap", () => {
  it("reaches through optional and default", () => {
    expect(declaredKeys(Viewpoint.optional())).toEqual(declaredKeys(Viewpoint));
    expect(unwrap(Viewpoint.optional())).toBe(Viewpoint);
  });
});

describe("toYaml", () => {
  it("ends the file with a newline", () => {
    expect(toYaml(viewpoint, Viewpoint).endsWith("\n")).toBe(true);
  });

  it("writes keys in schema order", () => {
    const lines = toYaml(viewpoint, Viewpoint).split("\n");
    expect(lines[0]).toBe("id: VP-AUTH");
  });

  it("writes the same bytes for the same data, however it was built", () => {
    const rebuilt = Viewpoint.parse({
      risk: "high",
      source: [{ kind: "design", ref: "service design, section 2" }],
      rationale: "an unauthenticated caller must not be able to send anything",
      title: "requests without credentials are rejected",
      id: "VP-AUTH",
    });
    expect(toYaml(rebuilt, Viewpoint)).toBe(toYaml(viewpoint, Viewpoint));
  });

  it("does not fold a long line, which would reflow on unrelated edits", () => {
    const long = Viewpoint.parse({
      ...viewpoint,
      rationale: "a ".repeat(120).trim(),
    });
    const rationaleLines = toYaml(long, Viewpoint)
      .split("\n")
      .filter((line) => line.startsWith("rationale:"));
    expect(rationaleLines).toHaveLength(1);
  });

  it("writes multi-line text as a literal block, which reviews readably", () => {
    const multiline = Viewpoint.parse({ ...viewpoint, rationale: "first line\nsecond line" });
    expect(toYaml(multiline, Viewpoint)).toContain("rationale: |-");
  });

  it("adds a header comment when asked", () => {
    const text = toYaml(viewpoint, Viewpoint, { header: "generated; edit the source" });
    expect(text.startsWith("# generated; edit the source\n")).toBe(true);
  });
});

describe("round tripping", () => {
  it("reads back what it wrote", () => {
    expect(Viewpoint.parse(fromYaml(toYaml(viewpoint, Viewpoint)))).toEqual(viewpoint);
  });

  it("reports a file it wrote as stable", () => {
    expect(checkRoundTrip(toYaml(viewpoint, Viewpoint), Viewpoint).stable).toBe(true);
  });

  it("reports a file with scrambled keys as unstable, and says what to write", () => {
    const scrambled = [
      "title: requests without credentials are rejected",
      "id: VP-AUTH",
      "rationale: an unauthenticated caller must not be able to send anything",
      "risk: high",
      "source:",
      "  - kind: design",
      "    ref: service design, section 2",
      "parents: []",
      "",
    ].join("\n");
    const result = checkRoundTrip(scrambled, Viewpoint);
    expect(result.stable).toBe(false);
    expect(result.written.split("\n")[0]).toBe("id: VP-AUTH");
  });

  it("is stable for a case carrying defaults the file omitted", () => {
    const written = toYaml(testCase, TestCase);
    expect(checkRoundTrip(written, TestCase).stable).toBe(true);
  });
});
