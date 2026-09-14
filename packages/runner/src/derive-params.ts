import type { Override, ResolvedBaseline } from "@agentic-test-hub/core";
import type { Operation } from "@agentic-test-hub/plugin";

/** One override that cannot mechanically reach the operation it targets. */
export interface UnexpressibleOverride {
  readonly path: string;
  readonly why: string;
}

/** Whether a case's overrides can be turned into a real operation call. */
export interface ParamDerivation {
  /** True iff every override is expressible; `unexpressible` is then empty. */
  readonly ok: boolean;
  /** Parameters to pass to `registry.run`, as far as they could be derived. */
  readonly params: Record<string, unknown>;
  /** Every override that has no mechanical path to the executed request. */
  readonly unexpressible: readonly UnexpressibleOverride[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Decides whether a case's overrides can reach the operation they resolve
 * to, and derives the parameters to run it with if so.
 *
 * A plugin operation's `params`/`headers`/`body` templates only read the
 * `env`/`param`/`step` scopes (see `packages/plugin/src/template.ts`) — there
 * is no generic path from a baseline's `context`/`config` into what actually
 * gets sent. An override only reaches the request when its path's last
 * segment happens to also be a name the target operation declares as a
 * `param`; anything else (a header the operation never parameterised, a
 * `config.*` path — nothing reads `config` into a request at all) has no
 * mechanical way to affect the call. Extending operations to read a `context`
 * scope generically is a deliberate, deferred follow-up (a plugin-facing
 * contract change); this function is the gate that keeps a case whose
 * overrides fall outside today's coverage from silently generating dead
 * code, in either the TypeScript or the Python track.
 *
 * @param overrides - The case's overrides, as declared.
 * @param resolved - The baseline with those overrides already applied (see
 *   {@link applyOverrides}).
 * @param operationId - Identifier of the operation `resolved.action` names,
 *   for readable refusal messages.
 * @param operation - That operation's declaration, for its `params` list.
 * @returns Whether every override is expressible, the params derived so far
 *   regardless, and which overrides (if any) could not be derived.
 */
export function deriveActionParams(
  overrides: readonly Override[],
  resolved: ResolvedBaseline,
  operationId: string,
  operation: Operation,
): ParamDerivation {
  const params: Record<string, unknown> = { ...resolved.action?.params };
  const ambiguous = new Set<string>();
  const body = isRecord(resolved.context["body"]) ? resolved.context["body"] : undefined;

  for (const name of operation.params) {
    if (Object.hasOwn(params, name)) continue;

    const hasDirect = Object.hasOwn(resolved.context, name);
    const hasBody = body !== undefined && Object.hasOwn(body, name);

    if (hasDirect && hasBody && !deepEqual(resolved.context[name], body[name])) {
      ambiguous.add(name);
      continue;
    }
    if (hasDirect) {
      params[name] = resolved.context[name];
    } else if (hasBody) {
      params[name] = body[name];
    }
  }

  const unexpressible: UnexpressibleOverride[] = [];
  for (const override of overrides) {
    // Already reflected in `resolved.action` (including `.params`, folded in
    // above) by the time this runs — nothing further to check.
    if (override.path.startsWith("action.")) continue;

    if (override.path.startsWith("context.")) {
      const segments = override.path.split(".");
      const name = segments[segments.length - 1] as string;
      if (ambiguous.has(name)) {
        unexpressible.push({
          path: override.path,
          why: `"${name}" resolves to different values at context.${name} and context.body.${name}; operation ${operationId} cannot tell which one is meant`,
        });
        continue;
      }
      if (operation.params.includes(name) && Object.hasOwn(params, name)) continue;
      unexpressible.push({
        path: override.path,
        why: `operation ${operationId} declares no param named "${name}", so nothing reads it`,
      });
      continue;
    }

    unexpressible.push({
      path: override.path,
      why: override.path.startsWith("config.")
        ? `config is never read into what operation ${operationId} sends`
        : `this path is not part of what operation ${operationId} sends`,
    });
  }

  return { ok: unexpressible.length === 0, params, unexpressible };
}
