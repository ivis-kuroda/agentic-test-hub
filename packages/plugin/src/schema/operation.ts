import { z } from "zod";

/**
 * One interaction step in a browser operation.
 *
 * Deliberately small. A browser operation exists to express "log in as this
 * user" or "open the admin page" — things many cases share. Anything more
 * intricate belongs in generated test code, where a real language is
 * available, not in a manifest pretending to be one.
 */
export const BrowserStep = z.discriminatedUnion("action", [
  z.object({ action: z.literal("goto"), url: z.string().min(1) }),
  z.object({
    action: z.literal("fill"),
    selector: z.string().min(1),
    value: z.string(),
  }),
  z.object({ action: z.literal("click"), selector: z.string().min(1) }),
  z.object({
    action: z.literal("select"),
    selector: z.string().min(1),
    value: z.string(),
  }),
  z.object({
    action: z.literal("upload"),
    selector: z.string().min(1),
    /** Path relative to the plugin repository. */
    file: z.string().min(1),
  }),
  z.object({
    action: z.literal("waitFor"),
    selector: z.string().min(1),
    timeoutMs: z.number().int().positive().default(10_000),
  }),
]);
/** One interaction step in a browser operation. */
export type BrowserStep = z.infer<typeof BrowserStep>;

/**
 * One part of a `multipart/form-data` request body.
 *
 * Every string field is a template. `file` is a path relative to the plugin
 * repository whose contents become the part; `value` is inline text. Exactly
 * one of the two is given.
 */
export const MultipartPart = z
  .object({
    /** Form field name. */
    name: z.string().min(1),
    /** File to send, relative to the plugin repository. */
    file: z.string().min(1).optional(),
    /** Inline text to send instead of a file. */
    value: z.string().optional(),
    /**
     * Filename announced for a `file` part. Defaults to the file's basename;
     * an empty string announces an empty filename.
     */
    filename: z.string().optional(),
    /** Content type of the part. Chosen from the filename when omitted. */
    contentType: z.string().min(1).optional(),
  })
  .refine((part) => (part.file === undefined) !== (part.value === undefined), {
    message: "a multipart part needs exactly one of `file` or `value`",
  });
/** One part of a `multipart/form-data` request body. */
export type MultipartPart = z.infer<typeof MultipartPart>;

const base = z.object({
  /** What the operation is for. Shown in generated documentation. */
  description: z.string().min(1).optional(),
  /** Parameters the operation accepts, referenced as `{{param.name}}`. */
  params: z.array(z.string().min(1)).default([]),
  /**
   * Parameters a caller may leave out, listed here instead of in `params`.
   *
   * A header value or multipart part that references an absent optional
   * parameter is omitted from the request; an absent parameter from `params`
   * still fails the run. This is how a case expresses "this header is not
   * sent": it removes the parameter with a `remove` override.
   */
  optionalParams: z.array(z.string().min(1)).default([]),
});

/**
 * Every parameter name an operation accepts, required or optional.
 *
 * @param operation - The operation to inspect.
 * @returns Names from `params` followed by those only in `optionalParams`.
 */
export function acceptedParams(operation: {
  readonly params: readonly string[];
  readonly optionalParams: readonly string[];
}): string[] {
  return [...new Set([...operation.params, ...operation.optionalParams])];
}

/**
 * Something the hub can do on a target's behalf.
 *
 * The four executors are the whole surface between the hub and any
 * application: run a command, make a request, query a database, drive a
 * browser. Everything an integration test needs — seeding data, invoking an
 * API, rebuilding a search index, clicking through a form — reduces to one of
 * them, which is why the hub never needs to know what it is testing.
 */
export const Operation = z.discriminatedUnion("executor", [
  /**
   * Runs a command.
   *
   * `run` is an argument list, never a shell string, and there is no option
   * to make it one. Interpolated values therefore reach the process as
   * arguments and cannot become syntax — a test fixture containing a quote or
   * a semicolon stays a fixture instead of becoming a command.
   */
  base.extend({
    executor: z.literal("shell"),
    run: z.array(z.string()).min(1),
    /** Working directory, relative to the plugin repository. */
    cwd: z.string().min(1).optional(),
    env: z.record(z.string(), z.string()).default({}),
    /** Feeds the rendered parameters to the process as JSON on stdin. */
    stdin: z.enum(["none", "json"]).default("none"),
    timeoutMs: z.number().int().positive().default(120_000),
  }),

  /**
   * Makes an HTTP request against a declared connection.
   *
   * `multipart` sends a `multipart/form-data` body and excludes `body` and
   * `bodyFile`. Only the Python runtime sends it; generation for TypeScript
   * is refused.
   */
  base
    .extend({
      executor: z.literal("http"),
      connection: z.string().min(1),
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]).default("GET"),
      /** Path appended to the connection's base address. */
      path: z.string().min(1),
      headers: z.record(z.string(), z.string()).default({}),
      /** Inline request body. */
      body: z.unknown().optional(),
      /** Body read from a file, for payloads too large to inline. */
      bodyFile: z.string().min(1).optional(),
      /** Parts of a `multipart/form-data` body. */
      multipart: z.array(MultipartPart).min(1).optional(),
      timeoutMs: z.number().int().positive().default(60_000),
    })
    .refine(
      (op) => op.multipart === undefined || (op.body === undefined && op.bodyFile === undefined),
      { message: "`multipart` cannot be combined with `body` or `bodyFile`" },
    ),

  /** Runs a query against a declared database connection. */
  base.extend({
    executor: z.literal("sql"),
    connection: z.string().min(1),
    query: z.string().min(1),
    timeoutMs: z.number().int().positive().default(60_000),
  }),

  /** Drives a browser through a short, shared interaction. */
  base.extend({
    executor: z.literal("browser"),
    connection: z.string().min(1),
    steps: z.array(BrowserStep).min(1),
  }),

  /**
   * Defers to a function the plugin exports from its extension module.
   *
   * The escape hatch for what a manifest cannot express — waiting on an
   * asynchronous indexing pipeline, say. Kept narrow on purpose: a plugin
   * that is mostly configuration can be maintained by people who do not write
   * TypeScript, and that is worth protecting.
   */
  base.extend({
    executor: z.literal("extension"),
    /** Exported name in the plugin's extension module. */
    handler: z.string().min(1),
  }),
]);
/** Something the hub can do on a target's behalf. */
export type Operation = z.infer<typeof Operation>;
