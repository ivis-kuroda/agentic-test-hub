import { describe, expect, it } from "vitest";

import { ShellExecutor } from "../src/executor/shell.ts";
import { SqlExecutor, type QueryFn, type Row } from "../src/executor/sql.ts";
import { ensureState, prepareStates } from "../src/state.ts";
import { contextFor, recordingSpawn, registryWith } from "./harness.ts";

/**
 * A query that answers differently on each call, so a test can describe a
 * state that only holds after setup has run.
 */
function scriptedQuery(...answers: readonly (readonly Row[])[]): QueryFn & { count: number } {
  let index = 0;
  const fn: QueryFn = () => {
    const answer = answers[Math.min(index, answers.length - 1)] ?? [];
    index += 1;
    Object.assign(fn, { count: index });
    return Promise.resolve(answer);
  };
  return Object.assign(fn, { count: 0 });
}

describe("ensureState", () => {
  it("skips setup when the state already holds", async () => {
    const spawn = recordingSpawn();
    const registry = registryWith(
      new SqlExecutor(scriptedQuery([{ n: 0 }])),
      new ShellExecutor(spawn),
    );
    const context = contextFor();
    const outcome = await ensureState(
      "queue.empty",
      context.manifest.states["queue.empty"]!,
      registry,
      context,
    );
    expect(outcome.status).toBe("already_satisfied");
    expect(outcome.ensured).toBe(false);
    expect(spawn.calls).toHaveLength(0);
  });

  it("runs setup and confirms it when the state does not hold", async () => {
    const spawn = recordingSpawn();
    const registry = registryWith(
      new SqlExecutor(scriptedQuery([{ n: 5 }], [{ n: 0 }])),
      new ShellExecutor(spawn),
    );
    const context = contextFor();
    const outcome = await ensureState(
      "queue.empty",
      context.manifest.states["queue.empty"]!,
      registry,
      context,
    );
    expect(outcome.status).toBe("established");
    expect(outcome.ensured).toBe(true);
    expect(spawn.calls).toHaveLength(1);
  });

  it("catches setup that reported success without doing anything", async () => {
    // The command exits zero, but the state is unchanged. This is the failure
    // mode that otherwise surfaces as a confusing assertion elsewhere.
    const registry = registryWith(
      new SqlExecutor(scriptedQuery([{ n: 5 }], [{ n: 5 }])),
      new ShellExecutor(recordingSpawn({ exitCode: 0 })),
    );
    const context = contextFor();
    const outcome = await ensureState(
      "queue.empty",
      context.manifest.states["queue.empty"]!,
      registry,
      context,
    );
    expect(outcome.status).toBe("unsatisfied");
    expect(outcome.why).toMatch(/expected/);
  });

  it("reports a state it cannot decide rather than assuming it holds", async () => {
    const registry = registryWith(
      new SqlExecutor(scriptedQuery([{ n: 5 }])),
      new ShellExecutor(recordingSpawn()),
    );
    const context = contextFor();
    const provider = context.manifest.states["queue.empty"]!;
    const outcome = await ensureState(
      "queue.empty",
      {
        ...provider,
        verify: { ...provider.verify, assert: { kind: "natural", text: "queue looks drained" } },
      },
      registry,
      context,
    );
    expect(outcome.status).toBe("needs_judgement");
  });
});

describe("prepareStates", () => {
  it("reports readiness when every state holds", async () => {
    const registry = registryWith(
      new SqlExecutor(scriptedQuery([{ n: 0 }])),
      new ShellExecutor(recordingSpawn()),
    );
    const report = await prepareStates(["queue.empty"], registry, contextFor());
    expect(report.ready).toBe(true);
    expect(report.outcomes.map((outcome) => outcome.state)).toEqual(["queue.empty"]);
  });

  it("prepares cheap states first, so a wrong environment fails fast", async () => {
    const registry = registryWith(
      new SqlExecutor(scriptedQuery([{ n: 0 }])),
      new ShellExecutor(recordingSpawn()),
    );
    const report = await prepareStates(
      ["queue.drained.slow", "queue.empty"],
      registry,
      contextFor(),
    );
    expect(report.outcomes.map((outcome) => outcome.state)).toEqual([
      "queue.empty",
      "queue.drained.slow",
    ]);
  });

  it("stops at the first state it cannot reach", async () => {
    const registry = registryWith(
      new SqlExecutor(scriptedQuery([{ n: 5 }], [{ n: 5 }])),
      new ShellExecutor(recordingSpawn()),
    );
    const report = await prepareStates(
      ["queue.empty", "queue.drained.slow"],
      registry,
      contextFor(),
    );
    expect(report.ready).toBe(false);
    expect(report.outcomes).toHaveLength(1);
  });

  it("refuses a state the plugin does not provide", async () => {
    const registry = registryWith(new SqlExecutor(scriptedQuery()));
    await expect(prepareStates(["nothing.here"], registry, contextFor())).rejects.toThrow(
      /does not provide it/,
    );
  });

  it("prepares nothing when a case requires nothing", async () => {
    const registry = registryWith(new SqlExecutor(scriptedQuery()));
    const report = await prepareStates([], registry, contextFor());
    expect(report).toEqual({ outcomes: [], ready: true });
  });
});
