import { describe, expect, it } from "vitest";

import { ShellExecutor } from "../src/executor/shell.ts";
import { ExecutorError } from "../src/executor/types.ts";
import { contextFor, recordingSpawn, registryWith } from "./harness.ts";

describe("ExecutorRegistry", () => {
  it("reports which kinds it can run", () => {
    const registry = registryWith(new ShellExecutor(recordingSpawn()));
    expect(registry.supports("shell")).toBe(true);
    expect(registry.supports("http")).toBe(false);
  });

  it("refuses an operation the manifest does not declare", async () => {
    const registry = registryWith(new ShellExecutor(recordingSpawn()));
    await expect(registry.run("OP-NOT-THERE", {}, contextFor())).rejects.toThrow(ExecutorError);
  });

  it("refuses an operation whose executor is not registered", async () => {
    const registry = registryWith(new ShellExecutor(recordingSpawn()));
    await expect(registry.run("OP-SEND", { channel: "email" }, contextFor())).rejects.toThrow(
      /no executor is registered for http/,
    );
  });

  it("names every missing argument at once, rather than failing on the first", async () => {
    const registry = registryWith(new ShellExecutor(recordingSpawn()));
    await expect(registry.run("OP-SEED", {}, contextFor())).rejects.toThrow(/needs email/);
  });

  it("labels the result with the operation id, not the underlying command", async () => {
    const registry = registryWith(new ShellExecutor(recordingSpawn()));
    const result = await registry.run("OP-DRAIN", {}, contextFor());
    expect(result.operation).toBe("OP-DRAIN");
  });

  it("leaves ambient scopes in place while adding arguments", async () => {
    const spawn = recordingSpawn();
    const registry = registryWith(new ShellExecutor(spawn));
    await registry.run(
      "OP-SEED",
      { email: "a@example.invalid" },
      contextFor({ scopes: { env: { HOME: "/root" }, param: { email: "overridden" } } }),
    );
    expect(spawn.calls[0]?.args).toContain("a@example.invalid");
  });

  it("replaces an executor registered for the same kind", async () => {
    const first = recordingSpawn({ stdout: "first" });
    const second = recordingSpawn({ stdout: "second" });
    const registry = registryWith(new ShellExecutor(first), new ShellExecutor(second));
    const result = await registry.run("OP-DRAIN", {}, contextFor());
    expect(result.stdout).toBe("second");
  });
});
