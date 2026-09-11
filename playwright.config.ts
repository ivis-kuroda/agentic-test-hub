import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests: the hub's browser stack against a real browser and a real
 * application.
 *
 * These are separate from the unit and integration suites because they are
 * the only tests that need a browser, and a suite that needs a browser is one
 * people stop running locally. Keeping them apart means the fast suites stay
 * fast.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // A test marked `only` passes locally and silently narrows the suite in CI.
  forbidOnly: Boolean(process.env["CI"]),
  // One retry, to distinguish a genuine failure from a browser that lost a
  // race. Anything failing twice is real.
  retries: Boolean(process.env["CI"]) ? 1 : 0,
  reporter: Boolean(process.env["CI"]) ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    // Kept for the retry, where they earn their size.
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium" }],
});
