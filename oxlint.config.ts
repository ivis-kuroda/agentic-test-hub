import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["eslint", "typescript", "unicorn", "oxc", "import", "node", "jsdoc", "vitest", "vue"],
  ignorePatterns: [
    "**/dist/**",
    "artifacts/**",
    // apps/hub is a Nuxt project. Its ambient globals (defineEventHandler,
    // useRuntimeConfig, #build/*, ...) exist only through Nuxt and Nitro's
    // virtual module graph, which a standalone type checker cannot resolve.
    // Nuxt's own typecheck (nuxi typecheck, wrapping vue-tsc) is the correct
    // tool for that project; see `pnpm --filter @agentic-test-hub/hub typecheck`.
    "apps/hub/**",
  ],
  rules: {
    // Every exported symbol carries TSDoc; see AGENTS.md.
    "jsdoc/require-returns-description": "warn",
    // Schema tests assert that validation rejects an input. Pinning them to
    // the validator's wording would couple them to a dependency's message
    // format, which changes for reasons unrelated to this project.
    "vitest/require-to-throw-message": "off",
  },
});
