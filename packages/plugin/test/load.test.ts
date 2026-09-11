import { describe, expect, it } from "vitest";

import { checkIntegrity, loadManifest, PluginLoadError } from "../src/load.ts";
import { PluginManifest } from "../src/schema/manifest.ts";
import { sampleManifest } from "./sample-manifest.ts";

/** Runs a function and returns whatever it threw, so assertions stay unconditional. */
function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

/** Parses the sample and applies a mutation, bypassing integrity checking. */
function mutated(mutate: (draft: Record<string, never>) => void): PluginManifest {
  const { manifest } = loadManifest(sampleManifest);
  const draft = structuredClone(manifest) as unknown as Record<string, never>;
  mutate(draft);
  return draft as unknown as PluginManifest;
}

describe("loadManifest", () => {
  it("accepts a coherent manifest", () => {
    const { manifest } = loadManifest(sampleManifest);
    expect(manifest.name).toBe("dispatch-service");
    expect(Object.keys(manifest.operations)).toContain("OP-DISPATCH-SEND");
  });

  it("fills in defaults so a manifest can stay terse", () => {
    const { manifest } = loadManifest(sampleManifest);
    expect(manifest.operations["OP-DRAIN-QUEUE"]).toMatchObject({
      executor: "shell",
      stdin: "none",
      timeoutMs: 30_000,
    });
  });

  it("reports the environment the manifest expects", () => {
    const { requiredEnv } = loadManifest(sampleManifest);
    expect(requiredEnv).toEqual(["DISPATCH_API_URL", "DISPATCH_DB_URL", "DISPATCH_UI_URL"]);
  });

  it("rejects text that is not YAML", () => {
    expect(() => loadManifest("key: [unclosed")).toThrow(PluginLoadError);
  });

  it("rejects a manifest from a future format version", () => {
    expect(() => loadManifest('apiVersion: "99"\nname: x\n')).toThrow(PluginLoadError);
  });

  it("rejects an upper-case plugin name", () => {
    expect(() => loadManifest('apiVersion: "1"\nname: Dispatch\n')).toThrow(PluginLoadError);
  });

  it("rejects an operation id that does not follow the naming rule", () => {
    const source = sampleManifest.replace("OP-DRAIN-QUEUE:", "drainQueue:");
    expect(() => loadManifest(source)).toThrow(PluginLoadError);
  });

  it("carries the problems it found, not just a message", () => {
    const error = thrownBy(() =>
      loadManifest('apiVersion: "1"\nname: x\noperations:\n  bad-id:\n    executor: shell\n'),
    );
    expect(error).toBeInstanceOf(PluginLoadError);
    expect((error as PluginLoadError).problems.length).toBeGreaterThan(0);
  });
});

describe("checkIntegrity", () => {
  it("passes a manifest whose references all resolve", () => {
    const { manifest } = loadManifest(sampleManifest);
    expect(checkIntegrity(manifest)).toEqual([]);
  });

  it("catches a state whose setup operation does not exist", () => {
    const broken = mutated((draft) => {
      const states = draft["states"] as unknown as Record<
        string,
        { ensure: { operation: string } }
      >;
      states["queue.empty"]!.ensure.operation = "OP-NOT-THERE";
    });
    expect(checkIntegrity(broken)).toEqual([
      { at: "states.queue.empty.ensure", message: expect.stringContaining("OP-NOT-THERE") },
    ]);
  });

  it("catches a state whose verification operation does not exist", () => {
    const broken = mutated((draft) => {
      const states = draft["states"] as unknown as Record<
        string,
        { verify: { operation: string } }
      >;
      states["recipient.exists"]!.verify.operation = "OP-GONE";
    });
    expect(checkIntegrity(broken).map((problem) => problem.at)).toEqual([
      "states.recipient.exists.verify",
    ]);
  });

  it("catches an evidence collector that does not exist", () => {
    const broken = mutated((draft) => {
      const evidence = draft["evidence"] as unknown as Record<string, { operation: string }>;
      evidence["app_log"]!.operation = "OP-ABSENT";
    });
    expect(checkIntegrity(broken).map((problem) => problem.at)).toEqual(["evidence.app_log"]);
  });

  it("catches an operation naming a connection that does not exist", () => {
    const broken = mutated((draft) => {
      const operations = draft["operations"] as unknown as Record<string, { connection: string }>;
      operations["OP-COUNT-QUEUED"]!.connection = "nowhere";
    });
    expect(checkIntegrity(broken)[0]?.message).toMatch(/connection "nowhere"/);
  });

  it("catches an operation pointed at the wrong kind of connection", () => {
    const broken = mutated((draft) => {
      const operations = draft["operations"] as unknown as Record<string, { connection: string }>;
      operations["OP-COUNT-QUEUED"]!.connection = "api";
    });
    expect(checkIntegrity(broken)[0]?.message).toMatch(
      /sql operation but "api" is a http connection/,
    );
  });

  it("catches an http operation declaring two bodies", () => {
    const broken = mutated((draft) => {
      const operations = draft["operations"] as unknown as Record<string, { bodyFile?: string }>;
      operations["OP-DISPATCH-SEND"]!.bodyFile = "payload.json";
    });
    expect(checkIntegrity(broken)[0]?.message).toMatch(/both body and bodyFile/);
  });

  it("catches an extension operation with no module to load it from", () => {
    const broken = mutated((draft) => {
      const operations = draft["operations"] as unknown as Record<string, unknown>;
      operations["OP-WAIT-INDEXED"] = { executor: "extension", handler: "waitIndexed", params: [] };
    });
    expect(checkIntegrity(broken)[0]?.message).toMatch(/no extensionModule/);
  });

  it("reports every problem at once, rather than stopping at the first", () => {
    const broken = mutated((draft) => {
      const states = draft["states"] as unknown as Record<
        string,
        { ensure: { operation: string }; verify: { operation: string } }
      >;
      states["queue.empty"]!.ensure.operation = "OP-NOT-THERE";
      states["recipient.exists"]!.verify.operation = "OP-ALSO-GONE";
    });
    expect(checkIntegrity(broken)).toHaveLength(2);
  });
});
