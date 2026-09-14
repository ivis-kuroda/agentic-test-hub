import { readFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";

import { renderDeep } from "@agentic-test-hub/plugin";
import type { Operation } from "@agentic-test-hub/plugin";

import {
  ExecutorError,
  type ExecutionContext,
  type ExecutionResult,
  type Executor,
} from "./types.ts";

/** How a request is made. Injected so tests need no server. */
export type FetchFn = typeof fetch;

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/**
 * Reads a response body without deciding in advance what it is.
 *
 * Content type is advisory, and services under test get it wrong — an error
 * page served as JSON, a body declared JSON that is empty. Text is always
 * kept so that evidence and assertions have something to work with even when
 * parsing fails.
 */
async function readBody(response: Response): Promise<{ body: unknown; text: string }> {
  const text = await response.text();
  if (text === "") return { body: undefined, text };
  try {
    return { body: JSON.parse(text), text };
  } catch {
    return { body: text, text };
  }
}

/** Runs `http` operations. */
export class HttpExecutor implements Executor<"http"> {
  readonly kind = "http" as const;
  private readonly fetchFn: FetchFn;

  /**
   * @param fetchFn - How to make a request. Defaults to the platform's
   *   `fetch`; tests supply a stand-in.
   */
  constructor(fetchFn: FetchFn = fetch) {
    this.fetchFn = fetchFn;
  }

  async run(
    operation: Extract<Operation, { executor: "http" }>,
    context: ExecutionContext,
  ): Promise<ExecutionResult> {
    const connection = context.manifest.connections[operation.connection];
    if (connection?.kind !== "http") {
      throw new ExecutorError(
        `connection "${operation.connection}" is not an http connection`,
        operation.connection,
      );
    }

    const rendered = renderDeep(
      {
        baseUrl: connection.baseUrl,
        path: operation.path,
        headers: { ...connection.headers, ...operation.headers },
        body: operation.body,
      },
      context.scopes,
    );

    let payload: string | undefined;
    if (operation.bodyFile !== undefined) {
      payload = await readFile(resolvePath(context.root, operation.bodyFile), "utf8");
    } else if (rendered.body !== undefined) {
      payload = typeof rendered.body === "string" ? rendered.body : JSON.stringify(rendered.body);
    }

    const url = joinUrl(rendered.baseUrl, rendered.path);
    const headers = { ...rendered.headers };
    if (payload !== undefined && headers["Content-Type"] === undefined) {
      headers["Content-Type"] = "application/json";
    }

    const timeout = AbortSignal.timeout(operation.timeoutMs);
    const signal =
      context.signal === undefined ? timeout : AbortSignal.any([timeout, context.signal]);

    const started = Date.now();
    try {
      const response = await this.fetchFn(url, {
        method: operation.method,
        headers,
        signal,
        ...(payload === undefined ? {} : { body: payload }),
      });
      const { body, text } = await readBody(response);
      return {
        operation: `${operation.method} ${url}`,
        // Any answer from the service is a completed operation, including a
        // rejection. Which statuses are acceptable is the case's business.
        ok: true,
        durationMs: Date.now() - started,
        status: response.status,
        body,
        stdout: text,
      };
    } catch (cause) {
      return {
        operation: `${operation.method} ${url}`,
        ok: false,
        durationMs: Date.now() - started,
        failure: `request did not complete: ${cause instanceof Error ? cause.message : String(cause)}`,
      };
    }
  }
}
