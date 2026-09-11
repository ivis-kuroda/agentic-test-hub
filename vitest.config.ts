import { defineConfig } from "vitest/config";

/**
 * One test run for the whole workspace.
 *
 * Tests execute the TypeScript sources directly — nothing is built first, and
 * no package emits JavaScript. Relative imports therefore name the file that
 * exists on disk, with its real `.ts` extension.
 */
export default defineConfig({
  test: {
    projects: ["packages/*", "apps/hub"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      reporter: ["text", "html"],
    },
  },
});
