/**
 * `start-hub.ts` on its own: isolation and lifecycle, independent of
 * whatever `e2e/plugin.yaml`/`e2e/specs` end up being. No browser needed —
 * this only exercises the Nuxt server's HTTP surface directly.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { startHubApp, type RunningHub } from "./support/start-hub.ts";

test("starts an isolated instance with an empty suite by default", async () => {
  const hub: RunningHub = await startHubApp();
  try {
    const response = await fetch(`${hub.url}/api/suite`);
    expect(response.ok).toBe(true);
    const body = (await response.json()) as { suite: { cases: unknown[] } };
    expect(body.suite.cases).toEqual([]);
  } finally {
    await hub.stop();
  }
});

test("seeds the temporary SPECS_ROOT from the given fixture directory", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "hub-self-test-fixture-"));
  await writeFile(
    join(fixture, "seed-marker.txt"),
    "not a spec file, just proof the copy happened",
  );

  const hub = await startHubApp({ fixtureSpecs: fixture });
  try {
    expect(hub.specsRoot).not.toBe(fixture);
    const response = await fetch(`${hub.url}/api/suite`);
    expect(response.ok).toBe(true);
  } finally {
    await hub.stop();
    await rm(fixture, { recursive: true, force: true });
  }
});

test("stop() is idempotent and removes the temporary SPECS_ROOT", async () => {
  const hub = await startHubApp();
  const { specsRoot } = hub;
  await hub.stop();
  await expect(hub.stop()).resolves.toBeUndefined();

  const response = await fetch(`${hub.url}/api/suite`).catch(() => undefined);
  expect(response).toBeUndefined();

  await expect(rm(specsRoot, { recursive: false })).rejects.toThrow();
});
