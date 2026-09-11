import type { Operation, PluginManifest, TemplateScopes } from "@agentic-test-hub/plugin";

/** Everything an executor needs besides the operation itself. */
export interface ExecutionContext {
  /** The loaded manifest, for resolving connections. */
  readonly manifest: PluginManifest;
  /** Values available to interpolation. */
  readonly scopes: TemplateScopes;
  /** Plugin repository root, which relative paths are resolved against. */
  readonly root: string;
  /** Cancels the operation, for timeouts and shutdown. */
  readonly signal?: AbortSignal;
}

/**
 * What running an operation produced.
 *
 * `ok` reports whether the operation *completed*, not whether the test
 * passed. A request that returns 404 completed: `ok` is true and `status` is
 * 404. A request whose host does not resolve did not: `ok` is false.
 *
 * The distinction is load-bearing. Roughly half the cases in a real suite
 * expect a rejection, so a 4xx response is the desired outcome. An executor
 * that treated it as its own failure would make those cases unexpressible,
 * and the usual workaround — catching the error and inspecting the message —
 * is how suites end up asserting on prose.
 */
export interface ExecutionResult {
  /** The operation that ran. */
  readonly operation: string;
  /** Whether the operation completed, regardless of what it reported. */
  readonly ok: boolean;
  readonly durationMs: number;
  /** Process exit code, for commands. */
  readonly exitCode?: number;
  /** Response status, for requests. */
  readonly status?: number;
  readonly stdout?: string;
  readonly stderr?: string;
  /** Parsed response body, for requests. */
  readonly body?: unknown;
  /** Result rows, for queries. */
  readonly rows?: readonly Record<string, unknown>[];
  /** Why the operation could not complete. Set only when `ok` is false. */
  readonly failure?: string;
}

/** Runs one kind of operation. */
export interface Executor<K extends Operation["executor"] = Operation["executor"]> {
  readonly kind: K;
  /**
   * Runs the operation.
   *
   * Implementations report a failed operation through {@link
   * ExecutionResult.ok} rather than by throwing. Throwing is reserved for
   * programming errors — a missing connection, an unsupported shape — which
   * a plugin author should hear about immediately rather than see reported as
   * a test result.
   *
   * @param operation - The operation to run, with placeholders unresolved.
   * @param context - Manifest, interpolation scopes and cancellation.
   * @returns What the operation produced.
   */
  run(
    operation: Extract<Operation, { executor: K }>,
    context: ExecutionContext,
  ): Promise<ExecutionResult>;
}

/** Raised when an operation cannot be attempted at all. */
export class ExecutorError extends Error {
  /** The operation that could not be attempted. */
  readonly operation: string;

  constructor(message: string, operation: string) {
    super(message);
    this.name = "ExecutorError";
    this.operation = operation;
  }
}
