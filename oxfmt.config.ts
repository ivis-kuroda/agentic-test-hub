import { defineConfig } from "oxfmt";

export default defineConfig({
  ignorePatterns: ["**.md", "**/dist/**", "artifacts/**"],
  sortImports: {
    order: "asc",
    ignoreCase: true,
    newlinesBetween: true,
    customGroups: [
      {
        groupName: "scoped-first-party",
        elementNamePattern: ["@agentic-test-hub/*"],
        modifiers: ["value"],
      },
      {
        groupName: "type-scoped-first-party",
        elementNamePattern: ["@agentic-test-hub/*"],
        modifiers: ["type"],
      },
    ],
    groups: [
      "builtin",
      { newlinesBetween: false },
      "type-builtin",

      "external",
      { newlinesBetween: false },
      "type-external",

      "scoped-first-party",
      { newlinesBetween: false },
      "type-scoped-first-party",

      ["internal", "subpath"],
      { newlinesBetween: false },
      ["type-internal", "type-subpath"],

      ["parent", "sibling", "index"],
      { newlinesBetween: false },
      ["type-parent", "type-sibling", "type-index"],

      "style",
      "unknown",
    ],
  },
});
