import type { ExecutionContext } from "./executor/types.ts";

/**
 * Gives a context a `run` template scope, unless the caller supplied one.
 *
 * `runCase`/`runScenario` call this once at the start of a run so every
 * operation, state provider and evidence collector sees the same
 * `{{run.startedAt}}` (UTC ISO-8601 with seconds precision and a `Z`) and
 * `{{run.id}}` (a short identifier). An evidence collector can then ask for
 * "logs since this run began" without the hub knowing what produces the logs.
 *
 * @param context - The caller's context.
 * @returns `context` itself when it already has a `run` scope, else a copy
 *   with one added.
 */
export function withRunScope(context: ExecutionContext): ExecutionContext {
  if (context.scopes.run !== undefined) return context;
  const startedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const id = crypto.randomUUID().slice(0, 8);
  return { ...context, scopes: { ...context.scopes, run: { startedAt, id } } };
}
