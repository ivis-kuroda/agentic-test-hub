import { resolve } from "node:path";

/** Resolves the configured specs root to an absolute path, once per call site. */
export function resolveSpecsRoot(config: { specsRoot: string }): string {
  return resolve(process.cwd(), config.specsRoot);
}
