import { renderDeep } from "@agentic-test-hub/plugin";
import type { Operation } from "@agentic-test-hub/plugin";

import {
  ExecutorError,
  type ExecutionContext,
  type ExecutionResult,
  type Executor,
} from "./types.ts";

/** A row as returned by a query. */
export type Row = Record<string, unknown>;

/**
 * How a query is run. Injected rather than tied to a driver.
 *
 * Keeping the driver out of this package means the hub's own tests need no
 * database, and a target using something other than Postgres is a new adapter
 * rather than a change here.
 */
export type QueryFn = (
  connectionUrl: string,
  query: string,
  options: { readonly signal?: AbortSignal; readonly timeoutMs: number },
) => Promise<readonly Row[]>;

/** Runs `sql` operations. */
export class SqlExecutor implements Executor<"sql"> {
  readonly kind = "sql" as const;
  private readonly queryFn: QueryFn;

  /** @param queryFn - How to run a query against a connection string. */
  constructor(queryFn: QueryFn) {
    this.queryFn = queryFn;
  }

  async run(
    operation: Extract<Operation, { executor: "sql" }>,
    context: ExecutionContext,
  ): Promise<ExecutionResult> {
    const connection = context.manifest.connections[operation.connection];
    if (connection?.kind !== "postgres") {
      throw new ExecutorError(
        `connection "${operation.connection}" is not a database connection`,
        operation.connection,
      );
    }

    const rendered = renderDeep({ url: connection.url, query: operation.query }, context.scopes);

    const started = Date.now();
    try {
      const rows = await this.queryFn(rendered.url, rendered.query, {
        timeoutMs: operation.timeoutMs,
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      });
      return {
        operation: operation.connection,
        ok: true,
        durationMs: Date.now() - started,
        rows,
      };
    } catch (cause) {
      // Unlike a rejected request, a query that fails has told us nothing
      // about the system under test, so it is an executor failure.
      return {
        operation: operation.connection,
        ok: false,
        durationMs: Date.now() - started,
        failure: `query did not complete: ${cause instanceof Error ? cause.message : String(cause)}`,
      };
    }
  }
}
