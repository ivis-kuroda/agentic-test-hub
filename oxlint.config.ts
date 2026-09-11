import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["eslint", "typescript", "unicorn", "oxc", "import", "node", "jsdoc", "vitest", "vue"],
  ignorePatterns: ["**/dist/**", "artifacts/**"],
  rules: {
    // Every exported symbol carries TSDoc; see AGENTS.md.
    "jsdoc/require-returns-description": "warn",
    // Schema tests assert that validation rejects an input. Pinning them to
    // the validator's wording would couple them to a dependency's message
    // format, which changes for reasons unrelated to this project.
    "vitest/require-to-throw-message": "off",
  },
});
