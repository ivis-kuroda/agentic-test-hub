/**
 * Values available to interpolation, by scope.
 *
 * Scopes are separate rather than one flat namespace so that a manifest says
 * where a value comes from. `{{env.DB_URL}}` and `{{param.user}}` are
 * different kinds of promise, and a reader should not have to guess which.
 */
export interface TemplateScopes {
  /** Process environment. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Arguments passed to the operation being rendered. */
  readonly param?: Readonly<Record<string, unknown>>;
  /** Values produced by earlier steps of the same scenario. */
  readonly step?: Readonly<Record<string, unknown>>;
}

/** A placeholder that could not be resolved. */
export class TemplateError extends Error {
  /** The placeholder text, without its braces. */
  readonly placeholder: string;

  constructor(message: string, placeholder: string) {
    super(message);
    this.name = "TemplateError";
    this.placeholder = placeholder;
  }
}

const PLACEHOLDER = /\{\{\s*([a-z]+)\.([A-Za-z0-9_.-]+)\s*\}\}/g;
const SCOPES = ["env", "param", "step"] as const;

function lookup(scopes: TemplateScopes, scope: string, path: string): unknown {
  const root = scopes[scope as (typeof SCOPES)[number]];
  if (root === undefined) return undefined;
  let current: unknown = root;
  for (const segment of path.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    if (!Object.hasOwn(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Substitutes `{{scope.path}}` placeholders in a string.
 *
 * An unresolved placeholder throws rather than becoming an empty string.
 * Silent substitution is how a suite ends up testing `GET /items/` instead of
 * `GET /items/42` and reporting a pass: the request succeeds, the assertion
 * about the status holds, and nothing anywhere says the identifier went
 * missing. Failing loudly at render time costs a run; failing quietly costs
 * confidence in every run.
 *
 * @param input - Text possibly containing placeholders.
 * @param scopes - Values available for substitution.
 * @returns The text with every placeholder replaced.
 * @throws {TemplateError} When a placeholder names an unknown scope or a
 *   value that is absent.
 */
export function render(input: string, scopes: TemplateScopes): string {
  return input.replace(PLACEHOLDER, (whole, scope: string, path: string) => {
    const placeholder = whole.slice(2, -2).trim();
    if (!(SCOPES as readonly string[]).includes(scope)) {
      throw new TemplateError(
        `unknown scope "${scope}" in {{${placeholder}}}; expected one of ${SCOPES.join(", ")}`,
        placeholder,
      );
    }
    const value = lookup(scopes, scope, path);
    if (value === undefined || value === null) {
      throw new TemplateError(`{{${placeholder}}} did not resolve to a value`, placeholder);
    }
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
      return String(value);
    }
    throw new TemplateError(
      `{{${placeholder}}} resolved to a ${typeof value}, which cannot be substituted into text`,
      placeholder,
    );
  });
}

/**
 * Renders every string inside a structure, leaving other values alone.
 *
 * @param input - Structure to render.
 * @param scopes - Values available for substitution.
 * @returns A new structure with all strings rendered.
 * @throws {TemplateError} When any placeholder cannot be resolved.
 */
export function renderDeep<T>(input: T, scopes: TemplateScopes): T {
  if (typeof input === "string") return render(input, scopes) as T;
  if (Array.isArray(input)) {
    return input.map((item) => renderDeep(item, scopes)) as T;
  }
  if (typeof input === "object" && input !== null) {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      output[render(key, scopes)] = renderDeep(value, scopes);
    }
    return output as T;
  }
  return input;
}

/**
 * Lists the placeholders a structure contains, without resolving them.
 *
 * Used to report, before anything runs, which environment variables a plugin
 * expects — so a missing one is a sentence at startup rather than a failure
 * three minutes into a suite.
 *
 * @param input - Structure to scan.
 * @returns Distinct placeholders, as `scope.path`, in encounter order.
 */
export function collectPlaceholders(input: unknown): string[] {
  const found = new Set<string>();
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      for (const match of value.matchAll(PLACEHOLDER)) {
        found.add(`${match[1]}.${match[2]}`);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value === "object" && value !== null) {
      for (const [key, nested] of Object.entries(value)) {
        walk(key);
        walk(nested);
      }
    }
  };
  walk(input);
  return [...found];
}
