import { fileURLToPath } from "node:url";

// Resolved from this file's own location rather than the process's working
// directory. Nitro's cwd depends on how the app was launched (`nuxt dev`,
// `pnpm --filter ... dev`, a built server started from an arbitrary
// directory), so a plain relative string here would point somewhere
// different depending on that — it did, until this was caught by actually
// starting the dev server and finding an empty suite where the demo's should
// have been.
const DEFAULT_SPECS_ROOT = fileURLToPath(new URL("../../examples/demo-app/specs", import.meta.url));

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ["@nuxt/ui"],
  css: ["~/assets/main.css"],
  compatibilityDate: "2026-09-11",
  future: { compatibilityVersion: 4 },
  devtools: { enabled: true },
  runtimeConfig: {
    // Directory the store reads and writes. The demo suite is the default so
    // a fresh checkout has something to show; overridden per-deployment via
    // the SPECS_ROOT environment variable. That override is deliberately
    // *not* read here: this file is evaluated once, at `nuxt build` time, and
    // reading it here would bake in whatever SPECS_ROOT happened to be set
    // during the build rather than when the server is later started. See
    // server/utils/specs-root.ts, which reads it at request time instead, so
    // the override works the same way for `nuxt dev` and for a built server.
    // A relative override is resolved against the process's working
    // directory there too, which is reasonable for a value the person
    // launching the app supplies themselves from a directory they chose.
    specsRoot: DEFAULT_SPECS_ROOT,
  },
});
