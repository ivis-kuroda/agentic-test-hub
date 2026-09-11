import type { z } from "zod";

/**
 * Any schema, regardless of what it validates.
 *
 * The ordering walk only ever asks a schema what shape it describes, never
 * what it accepts, so the narrowest useful type is the widest one.
 */
export type AnySchema = z.ZodType;

interface SchemaDef {
  readonly type: string;
  readonly innerType?: AnySchema;
  readonly element?: AnySchema;
  readonly valueType?: AnySchema;
  readonly options?: readonly AnySchema[];
  readonly shape?: Readonly<Record<string, AnySchema>>;
}

/** Reads a schema's internal description. */
function defOf(schema: AnySchema): SchemaDef {
  return (schema as unknown as { _zod: { def: SchemaDef } })._zod.def;
}

/** Types that wrap another schema without changing its shape. */
const WRAPPERS = new Set([
  "default",
  "optional",
  "nullable",
  "readonly",
  "prefault",
  "catch",
  "nonoptional",
]);

/**
 * Removes wrappers such as `optional` and `default` to reach the schema that
 * describes the value's actual shape.
 *
 * @param schema - Possibly wrapped schema.
 * @returns The innermost schema.
 */
export function unwrap(schema: AnySchema): AnySchema {
  let current = schema;
  for (;;) {
    const def = defOf(current);
    if (!WRAPPERS.has(def.type) || def.innerType === undefined) return current;
    current = def.innerType;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Picks the union member that describes a value.
 *
 * Chosen by asking each member whether it accepts the value, rather than by
 * reading a discriminator. That works for plain and discriminated unions
 * alike, and the cost is irrelevant at the size specifications reach.
 */
function memberFor(options: readonly AnySchema[], value: unknown): AnySchema | undefined {
  return options.find((option) => option.safeParse(value).success);
}

/**
 * Rewrites a value so its object keys follow the order their schema declares
 * them in.
 *
 * This exists to make saving a file idempotent. A web editor that writes YAML
 * has to produce identical bytes for identical data, or every save reorders
 * keys and the diff fills with noise — at which point reviewing a change to a
 * specification becomes impossible, and the main reason for keeping these
 * files in version control is gone.
 *
 * Declaration order is used rather than alphabetical because the schema
 * already states a sensible reading order: identifier first, then what the
 * thing is, then its details. Alphabetising would scatter that.
 *
 * Keys not described by the schema are kept, after the described ones. They
 * should not occur — validation strips them — but silently dropping data
 * would be worse than emitting it in an unexpected place.
 *
 * @param value - The value to rewrite.
 * @param schema - Schema describing it.
 * @returns A structurally identical value with deterministic key order.
 */
export function canonicalise(value: unknown, schema: AnySchema): unknown {
  const resolved = unwrap(schema);
  const def = defOf(resolved);

  if (def.type === "union" && def.options !== undefined) {
    const member = memberFor(def.options, value);
    return member === undefined ? value : canonicalise(value, member);
  }

  if (def.type === "array" && def.element !== undefined) {
    if (!Array.isArray(value)) return value;
    return value.map((item) => canonicalise(item, def.element as AnySchema));
  }

  if (def.type === "record" && def.valueType !== undefined) {
    if (!isRecord(value)) return value;
    // Record keys are data, not a declared order, so they are sorted. Without
    // this, two editors adding entries in different orders produce different
    // files for the same content.
    const ordered: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      ordered[key] = canonicalise(value[key], def.valueType as AnySchema);
    }
    return ordered;
  }

  if (def.type === "object" && def.shape !== undefined) {
    if (!isRecord(value)) return value;
    const shape = def.shape;
    const ordered: Record<string, unknown> = {};
    for (const key of Object.keys(shape)) {
      if (!Object.hasOwn(value, key)) continue;
      ordered[key] = canonicalise(value[key], shape[key] as AnySchema);
    }
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(shape, key)) ordered[key] = value[key];
    }
    return ordered;
  }

  return value;
}

/**
 * Lists the keys a schema declares, in order.
 *
 * @param schema - Object schema to inspect.
 * @returns Declared keys, or an empty array when the schema is not an object.
 */
export function declaredKeys(schema: AnySchema): string[] {
  const def = defOf(unwrap(schema));
  return def.shape === undefined ? [] : Object.keys(def.shape);
}
