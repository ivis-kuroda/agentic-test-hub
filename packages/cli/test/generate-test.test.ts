import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SpecStore } from "@agentic-test-hub/store";

import { main } from "../src/main.ts";

const manifestSource = `
apiVersion: "1"
name: dispatch-service

connections:
  api:
    kind: http
    baseUrl: "https://api.invalid/v1"
  postgres:
    kind: postgres
    url: "postgres://invalid/dispatch"

operations:
  OP-SEND:
    executor: http
    connection: api
    method: POST
    path: /notifications
    params: [channel]
    body:
      channel: "{{param.channel}}"

  OP-SEED-DB:
    executor: sql
    connection: postgres
    query: "insert into notifications (channel) values ({{param.channel}})"
`;

function fakeIo(): {
  stdout: string[];
  stderr: string[];
  io: { stdout: { write(chunk: string): void }; stderr: { write(chunk: string): void } };
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: { write: (chunk: string) => void stdout.push(chunk) },
      stderr: { write: (chunk: string) => void stderr.push(chunk) },
    },
  };
}

const dirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setupSpecs(): Promise<{ specsDir: string; pluginPath: string; pluginRoot: string }> {
  const specsDir = await makeTempDir("ath-cli-specs-");
  const pluginRoot = await makeTempDir("ath-cli-plugin-");
  const pluginPath = join(pluginRoot, "plugin.yaml");
  await writeFile(pluginPath, manifestSource, "utf8");

  const store = new SpecStore(specsDir);
  await store.save({
    kind: "baseline",
    entity: {
      id: "BL-TEST",
      title: "the standard request",
      preconditions: [],
      config: {},
      context: { body: { channel: "email" } },
      action: { operation: "OP-SEND", params: {} },
    },
  });
  await store.save({
    kind: "case",
    entity: {
      id: "TC-DISPATCH-002",
      summary: "sends over sms",
      baseline: "BL-TEST",
      overrides: [{ path: "context.body.channel", op: "set", value: "sms" }],
      expect: [{ kind: "http_status", status: 201, viewpoints: [] }],
      polarity: "nominal",
      priority: "P2",
      viewpoints: [],
    },
  });
  await store.save({
    kind: "case",
    entity: {
      id: "TC-SQL",
      summary: "seeds the database",
      baseline: "BL-TEST",
      overrides: [],
      expect: [
        {
          kind: "operation_result",
          operation: "OP-SEED-DB",
          params: { channel: "email" },
          assert: { kind: "contains", value: "1" },
          viewpoints: [],
        },
      ],
      polarity: "nominal",
      priority: "P2",
      viewpoints: [],
    },
  });

  return { specsDir, pluginPath, pluginRoot };
}

describe("main (ath-generate-test)", () => {
  it("generates a TypeScript test and writes automation.status back to the case YAML", async () => {
    const { specsDir, pluginPath, pluginRoot } = await setupSpecs();
    const { io, stderr } = fakeIo();

    const code = await main(
      ["TC-DISPATCH-002", "--specs", specsDir, "--plugin", pluginPath, "--plugin-root", pluginRoot],
      io,
    );

    expect(stderr.join("")).toBe("");
    expect(code).toBe(0);

    const outPath = join(pluginRoot, "generated", "TC-DISPATCH-002.spec.ts");
    const generated = await readFile(outPath, "utf8");
    expect(generated).toContain("runCase(testCase, baseline, registry, context)");

    const caseYaml = await readFile(join(specsDir, "cases", "TC-DISPATCH-002.yaml"), "utf8");
    expect(caseYaml).toContain("status: generated");
    expect(caseYaml).toContain("impl:");
  });

  it("refuses to regenerate an already-generated case without --force", async () => {
    const { specsDir, pluginPath, pluginRoot } = await setupSpecs();
    const first = fakeIo();
    await main(
      ["TC-DISPATCH-002", "--specs", specsDir, "--plugin", pluginPath, "--plugin-root", pluginRoot],
      first.io,
    );

    const second = fakeIo();
    const code = await main(
      ["TC-DISPATCH-002", "--specs", specsDir, "--plugin", pluginPath, "--plugin-root", pluginRoot],
      second.io,
    );
    expect(code).toBe(1);
    expect(second.stderr.join("")).toContain("already generated");

    const forced = fakeIo();
    const forcedCode = await main(
      [
        "TC-DISPATCH-002",
        "--specs",
        specsDir,
        "--plugin",
        pluginPath,
        "--plugin-root",
        pluginRoot,
        "--force",
      ],
      forced.io,
    );
    expect(forcedCode).toBe(0);
  });

  it("refuses generation for a case using the sql executor, and writes nothing", async () => {
    const { specsDir, pluginPath, pluginRoot } = await setupSpecs();
    const { io, stderr, stdout } = fakeIo();

    const code = await main(
      ["TC-SQL", "--specs", specsDir, "--plugin", pluginPath, "--plugin-root", pluginRoot],
      io,
    );

    expect(code).toBe(1);
    expect(stdout.length).toBe(0);
    expect(stderr.join("")).toContain("OP-SEED-DB");

    await expect(stat(join(pluginRoot, "generated", "TC-SQL.spec.ts"))).rejects.toThrow();
  });

  it("generates a Python test when --lang python is passed", async () => {
    const { specsDir, pluginPath, pluginRoot } = await setupSpecs();
    const { io } = fakeIo();

    const code = await main(
      [
        "TC-DISPATCH-002",
        "--specs",
        specsDir,
        "--plugin",
        pluginPath,
        "--plugin-root",
        pluginRoot,
        "--lang",
        "python",
      ],
      io,
    );

    expect(code).toBe(0);
    const outPath = join(pluginRoot, "generated", "TC-DISPATCH-002.test.py");
    const generated = await readFile(outPath, "utf8");
    expect(generated).toContain("run_case(TEST_CASE, BASELINE, registry, context)");
  });

  it("reports a usage error and exits 2 when a required flag is missing", async () => {
    const { io, stderr } = fakeIo();
    const code = await main(["TC-DISPATCH-002"], io);
    expect(code).toBe(2);
    expect(stderr.join("")).toContain("missing --specs");
  });
});
