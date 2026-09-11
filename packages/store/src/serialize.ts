import { parse, stringify, type ToStringOptions } from "yaml";

import { canonicalise, type AnySchema } from "./order.ts";

/**
 * The only YAML writing settings in the project.
 *
 * Every option here is pinned because the alternative is a file whose bytes
 * depend on something other than its content:
 *
 * - `lineWidth: 0` disables folding. With folding on, a long value reflows
 *   when an unrelated word nearby changes, and the diff shows lines nobody
 *   touched.
 * - `blockQuote: "literal"` writes multi-line text as a `|` block. Expected
 *   results and procedures are routinely several lines, and a folded quoted
 *   string is unreadable in a review.
 * - `singleQuote: false` settles the one remaining choice the writer would
 *   otherwise make per string.
 *
 * Nothing else in the codebase may call `stringify`. One module owning this
 * is what makes "saving twice produces the same file" enforceable.
 */
export const YAML_OPTIONS: ToStringOptions = {
  indent: 2,
  lineWidth: 0,
  blockQuote: "literal",
  singleQuote: false,
  nullStr: "null",
};

/** Header written above generated-adjacent files, for human readers. */
export interface SerializeOptions {
  /** Comment placed at the top of the file, without the leading `#`. */
  readonly header?: string;
}

/**
 * Writes a validated entity to YAML, deterministically.
 *
 * The value is reordered to follow its schema before being written, so the
 * same data always produces the same bytes regardless of how the object was
 * built — parsed from a file, assembled by an editor, or constructed in a
 * test.
 *
 * @param value - The entity to write.
 * @param schema - Its schema, which supplies key order.
 * @param options - Optional file header.
 * @returns YAML text, ending in a newline.
 */
export function toYaml(value: unknown, schema: AnySchema, options: SerializeOptions = {}): string {
  const body = stringify(canonicalise(value, schema), YAML_OPTIONS);
  const header =
    options.header === undefined
      ? ""
      : `${options.header
          .split("\n")
          .map((line) => (line === "" ? "#" : `# ${line}`))
          .join("\n")}\n`;
  return `${header}${body.endsWith("\n") ? body : `${body}\n`}`;
}

/**
 * Reads YAML into plain data, without validating it.
 *
 * Validation is a separate step so that a malformed file and an invalid one
 * are distinguishable: the first is a syntax problem the author can see, the
 * second is a schema problem that needs explaining.
 *
 * @param text - YAML text.
 * @returns The parsed data.
 * @throws When the text is not valid YAML.
 */
export function fromYaml(text: string): unknown {
  return parse(text);
}

/** What a round-trip check found. */
export interface RoundTripResult {
  readonly stable: boolean;
  /** The text as it would be written. */
  readonly written: string;
}

/**
 * Checks that reading a file and writing it back produces the same bytes.
 *
 * Run over every specification in CI. It is the only thing that actually
 * keeps the guarantee: a serialisation change that reorders keys or reflows
 * text passes every other test while quietly making the next save produce a
 * diff touching every file.
 *
 * @param text - The file's current contents.
 * @param schema - Schema for the entity it holds.
 * @returns Whether it is stable, and what would be written.
 */
export function checkRoundTrip(text: string, schema: AnySchema): RoundTripResult {
  const parsed = schema.parse(fromYaml(text));
  const written = toYaml(parsed, schema);
  return { stable: written === text, written };
}
