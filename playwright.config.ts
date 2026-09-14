import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests: the hub's browser stack against a real browser and a real
 * application.
 *
 * These are separate from the unit and integration suites because they are
 * the only tests that need a browser, and a suite that needs a browser is one
 * people stop running locally. Keeping them apart means the fast suites stay
 * fast.
 *
 * Two projects, one per target, each with its own `testDir` rather than a
 * shared top-level one:
 * - `demo-app`: hand-written tests of the hub's own engine, using
 *   `examples/demo-app` as the fixture target they need to run against
 *   something (`examples/demo-app/e2e/`, bundled with that target's own
 *   `plugin.yaml`/`specs/`, the same reasoning as any plugin owning its own
 *   tests).
 * - `hub-self-test`: the hub testing *itself* — a real plugin.yaml pointed
 *   at `apps/hub`, with AI-generated TypeScript test code under
 *   `e2e/generated/typescript/` (auto-discovered here; the Python-generated
 *   counterpart under `e2e/generated/python/` runs via `pytest`, not
 *   Playwright).
 */
export default defineConfig({
  fullyParallel: true,
  // A test marked `only` passes locally and silently narrows the suite in CI.
  forbidOnly: Boolean(process.env["CI"]),
  // One retry, to distinguish a genuine failure from a browser that lost a
  // race. Anything failing twice is real.
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    // Kept for the retry, where they earn their size.
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "demo-app", testDir: "./examples/demo-app/e2e" },
    { name: "hub-self-test", testDir: "./e2e" },
  ],
});
