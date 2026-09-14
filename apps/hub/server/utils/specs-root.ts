import { resolve } from "node:path";

/**
 * Resolves the configured specs root to an absolute path, once per call site.
 *
 * `process.env["SPECS_ROOT"]` is read here rather than left to
 * `nuxt.config.ts`'s `runtimeConfig` default deliberately: `nuxt.config.ts`
 * is evaluated once, at `nuxt build` time, and its result is baked into the
 * built server — a `SPECS_ROOT` set before *starting* a built server
 * (`node .output/server/index.mjs`) rather than before *building* it would
 * be silently ignored, falling back to whatever the build baked in. Reading
 * it here instead, in code that runs when the server actually starts
 * handling requests, makes the override work the same way for `nuxt dev`
 * and for a production build — this was caught by actually building and
 * starting apps/hub with an overridden `SPECS_ROOT` and finding it silently
 * ignored.
 */
export function resolveSpecsRoot(config: { specsRoot: string }): string {
  return resolve(process.cwd(), process.env["SPECS_ROOT"] ?? config.specsRoot);
}
