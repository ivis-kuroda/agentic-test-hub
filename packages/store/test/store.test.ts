import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Viewpoint } from "@agentic-test-hub/core";

import { toYaml } from "../src/serialize.ts";
import { ConflictError, SpecStore } from "../src/store.ts";

let root: string;
let store: SpecStore;

const viewpoint = Viewpoint.parse({
  id: "VP-AUTH",
  title: "requests without credentials are rejected",
  rationale: "an unauthenticated caller must not be able to send anything",
  source: [{ kind: "design", ref: "service design, section 2" }],
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "spec-store-"));
  store = new SpecStore(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("saving", () => {
  it("creates a file named after the identifier", async () => {
    const result = await store.save({ kind: "viewpoint", entity: viewpoint });
    expect(result).toMatchObject({ file: "viewpoints/VP-AUTH.yaml", created: true });
  });

  it("writes what can be read back", async () => {
    await store.save({ kind: "viewpoint", entity: viewpoint });
    const { suite, problems } = await store.load();
    expect(problems).toEqual([]);
    expect(suite.viewpoints).toEqual([viewpoint]);
  });

  it("refuses an identifier belonging to another kind", async () => {
    // The entity schema settles this, so a case cannot be filed as a
    // viewpoint however the save was issued.
    await expect(
      store.save({ kind: "viewpoint", entity: { ...viewpoint, id: "TC-AUTH" } }),
    ).rejects.toThrow(/VP-EXAMPLE-001/);
  });

  it("refuses a malformed entity before looking at the file", async () => {
    await expect(
      store.save({ kind: "viewpoint", entity: { id: "VP-X", title: "t" } }),
    ).rejects.not.toThrow(ConflictError);
  });

  it("updates a file when given the hash it last saw", async () => {
    const first = await store.save({ kind: "viewpoint", entity: viewpoint });
    const second = await store.save({
      kind: "viewpoint",
      entity: { ...viewpoint, risk: "high" },
      expectedHash: first.hash,
    });
    expect(second.created).toBe(false);
    expect(second.hash).not.toBe(first.hash);
  });

  it("does nothing when the content is unchanged, avoiding an empty commit", async () => {
    const first = await store.save({ kind: "viewpoint", entity: viewpoint });
    const again = await store.save({
      kind: "viewpoint",
      entity: viewpoint,
      expectedHash: first.hash,
    });
    expect(again.hash).toBe(first.hash);
  });
});

describe("concurrent edits", () => {
  it("refuses a save that would overwrite a change it never saw", async () => {
    const first = await store.save({ kind: "viewpoint", entity: viewpoint });
    // Somebody else edits the file.
    await writeFile(
      join(root, "viewpoints/VP-AUTH.yaml"),
      toYaml({ ...viewpoint, title: "edited elsewhere" }, Viewpoint),
      "utf8",
    );
    await expect(
      store.save({
        kind: "viewpoint",
        entity: { ...viewpoint, title: "mine" },
        expectedHash: first.hash,
      }),
    ).rejects.toThrow(ConflictError);
  });

  it("hands back the current contents, so the difference can be shown", async () => {
    const first = await store.save({ kind: "viewpoint", entity: viewpoint });
    await writeFile(
      join(root, "viewpoints/VP-AUTH.yaml"),
      toYaml({ ...viewpoint, title: "edited elsewhere" }, Viewpoint),
      "utf8",
    );
    try {
      await store.save({
        kind: "viewpoint",
        entity: { ...viewpoint, title: "mine" },
        expectedHash: first.hash,
      });
      expect.unreachable("should have refused");
    } catch (error) {
      expect((error as ConflictError).current).toContain("edited elsewhere");
    }
  });

  it("treats a save with no hash over an existing file as a conflict, not consent", async () => {
    await store.save({ kind: "viewpoint", entity: viewpoint });
    await expect(
      store.save({ kind: "viewpoint", entity: { ...viewpoint, title: "mine" } }),
    ).rejects.toThrow(ConflictError);
  });

  it("leaves the file untouched when it refuses", async () => {
    const first = await store.save({ kind: "viewpoint", entity: viewpoint });
    const before = await readFile(join(root, "viewpoints/VP-AUTH.yaml"), "utf8");
    await store
      .save({ kind: "viewpoint", entity: { ...viewpoint, title: "mine" } })
      .catch(() => undefined);
    expect(await readFile(join(root, "viewpoints/VP-AUTH.yaml"), "utf8")).toBe(before);
    expect(first.created).toBe(true);
  });
});

describe("one writer at a time", () => {
  it("serialises writes issued together", async () => {
    const created = await store.save({ kind: "viewpoint", entity: viewpoint });

    // Both are issued before either completes, each claiming the same hash.
    // Exactly one may win; the other must be told, not silently dropped.
    const [a, b] = await Promise.allSettled([
      store.save({
        kind: "viewpoint",
        entity: { ...viewpoint, title: "first" },
        expectedHash: created.hash,
      }),
      store.save({
        kind: "viewpoint",
        entity: { ...viewpoint, title: "second" },
        expectedHash: created.hash,
      }),
    ]);

    const outcomes = [a?.status, b?.status].sort();
    expect(outcomes).toEqual(["fulfilled", "rejected"]);
  });

  it("keeps accepting writes after one fails", async () => {
    await store.save({ kind: "viewpoint", entity: viewpoint }).catch(() => undefined);
    await store.save({ kind: "viewpoint", entity: { id: "VP-BAD" } }).catch(() => undefined);
    const after = await store.save({
      kind: "viewpoint",
      entity: { ...viewpoint, id: "VP-OTHER" },
    });
    expect(after.created).toBe(true);
  });
});

describe("removing", () => {
  it("removes an entity when given the hash it last saw", async () => {
    const saved = await store.save({ kind: "viewpoint", entity: viewpoint });
    await store.remove("viewpoint", "VP-AUTH", saved.hash);
    const { suite } = await store.load();
    expect(suite.viewpoints).toEqual([]);
  });

  it("refuses to remove a file that changed since it was read", async () => {
    const saved = await store.save({ kind: "viewpoint", entity: viewpoint });
    await writeFile(
      join(root, "viewpoints/VP-AUTH.yaml"),
      toYaml({ ...viewpoint, title: "edited elsewhere" }, Viewpoint),
      "utf8",
    );
    await expect(store.remove("viewpoint", "VP-AUTH", saved.hash)).rejects.toThrow(ConflictError);
  });

  it("reports removing something that is not there", async () => {
    await expect(store.remove("viewpoint", "VP-GONE", "abc")).rejects.toThrow(/does not exist/);
  });
});

describe("loading", () => {
  it("treats a kind with no directory as an empty collection", async () => {
    const { suite, problems } = await store.load();
    expect(problems).toEqual([]);
    expect(suite.cases).toEqual([]);
  });

  it("reports a malformed file and still loads the rest", async () => {
    await store.save({ kind: "viewpoint", entity: viewpoint });
    await writeFile(join(root, "viewpoints/VP-BROKEN.yaml"), "id: [unclosed", "utf8");
    const { suite, problems } = await store.load();
    expect(suite.viewpoints).toHaveLength(1);
    expect(problems[0]?.message).toMatch(/not valid YAML/);
  });

  it("reports a file whose contents do not match its schema", async () => {
    await mkdir(join(root, "viewpoints"), { recursive: true });
    await writeFile(join(root, "viewpoints/VP-THIN.yaml"), "id: VP-THIN\ntitle: t\n", "utf8");
    const { problems } = await store.load();
    expect(problems.length).toBeGreaterThan(0);
  });

  it("reports a filename that does not match the identifier it holds", async () => {
    await mkdir(join(root, "viewpoints"), { recursive: true });
    await writeFile(join(root, "viewpoints/WRONG.yaml"), toYaml(viewpoint, Viewpoint), "utf8");
    const { problems } = await store.load();
    expect(problems[0]?.message).toMatch(/should be named VP-AUTH\.yaml/);
  });

  it("records each file's hash, so an editor can offer a safe save", async () => {
    const saved = await store.save({ kind: "viewpoint", entity: viewpoint });
    const { files } = await store.load();
    expect(files.get("viewpoint/VP-AUTH")).toEqual({
      file: "viewpoints/VP-AUTH.yaml",
      hash: saved.hash,
    });
  });
});
