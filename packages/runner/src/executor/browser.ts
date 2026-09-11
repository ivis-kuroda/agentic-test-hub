import { renderDeep } from "@agentic-test-hub/plugin";
import type { BrowserStep, Operation } from "@agentic-test-hub/plugin";

import {
  ExecutorError,
  type ExecutionContext,
  type ExecutionResult,
  type Executor,
} from "./types.ts";

/** Something the page reported to the browser console. */
export interface ConsoleMessage {
  readonly level: "log" | "info" | "warn" | "error";
  readonly text: string;
  /**
   * Where the message came from, when the browser said.
   *
   * Load-bearing for noise filtering. A browser reporting a failed
   * subresource writes only "Failed to load resource: the server responded
   * with a status of 404", naming the resource in the location rather than in
   * the text — so a pattern matched against the text alone cannot tell an
   * absent optional asset from anything else.
   */
  readonly location?: string;
}

/** One request the page made, and what came back. */
export interface NetworkExchange {
  readonly method: string;
  readonly url: string;
  readonly status: number;
  /** True when the request did not complete at all. */
  readonly failed?: boolean;
}

/**
 * A live browser, with the page it is on and what it has observed.
 *
 * A session is not only a way to act. It is also the source of two evidence
 * channels — what the page logged and what it asked the service for — and
 * those cannot be gathered afterwards by running an operation, because they
 * exist only while the page is open. Anything that wants them has to hold a
 * session.
 */
export interface BrowserSession {
  goto(url: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  click(selector: string): Promise<void>;
  select(selector: string, value: string): Promise<void>;
  upload(selector: string, file: string): Promise<void>;
  waitFor(selector: string, timeoutMs: number): Promise<void>;
  /** Text of the first match, or `null` when nothing matches. */
  textOf(selector: string): Promise<string | null>;
  /** An image of the page as it stands. */
  screenshot(): Promise<Uint8Array>;
  /** Everything the page logged since the session opened. */
  consoleMessages(): readonly ConsoleMessage[];
  /** Every request the page made since the session opened. */
  networkExchanges(): readonly NetworkExchange[];
  close(): Promise<void>;
}

/** Opens browser sessions. Injected so tests need no browser. */
export interface BrowserDriver {
  /**
   * Opens a session.
   *
   * @param baseUrl - Address the session starts from.
   * @returns A live session, which the caller closes.
   */
  open(baseUrl: string): Promise<BrowserSession>;
}

/**
 * Runs `browser` operations.
 *
 * A session is opened per operation and closed afterwards unless one is
 * supplied. Supplying one is how a scenario keeps a signed-in page across
 * steps: signing in once and reusing the session is the difference between a
 * suite that runs in minutes and one that spends most of its time on login
 * forms.
 */
export class BrowserExecutor implements Executor<"browser"> {
  readonly kind = "browser" as const;
  private readonly driver: BrowserDriver;
  private readonly session?: BrowserSession;

  /**
   * @param driver - Opens sessions when none is supplied.
   * @param session - An existing session to reuse. Not closed by this
   *   executor, since its owner may still need it.
   */
  constructor(driver: BrowserDriver, session?: BrowserSession) {
    this.driver = driver;
    if (session !== undefined) this.session = session;
  }

  async run(
    operation: Extract<Operation, { executor: "browser" }>,
    context: ExecutionContext,
  ): Promise<ExecutionResult> {
    const connection = context.manifest.connections[operation.connection];
    if (connection?.kind !== "browser") {
      throw new ExecutorError(
        `connection "${operation.connection}" is not a browser connection`,
        operation.connection,
      );
    }

    const baseUrl = renderDeep(connection.baseUrl, context.scopes);
    const steps = renderDeep(operation.steps, context.scopes);

    const borrowed = this.session !== undefined;
    const session = this.session ?? (await this.driver.open(baseUrl));
    const started = Date.now();

    try {
      for (const step of steps) await applyStep(session, step);
      return {
        operation: operation.connection,
        ok: true,
        durationMs: Date.now() - started,
        stdout: (await session.textOf("body")) ?? "",
      };
    } catch (cause) {
      // A step that could not be carried out — an element that never
      // appeared, a navigation that failed — has told us nothing about the
      // behaviour under test, so it is an executor failure rather than a
      // result the case can assert on.
      return {
        operation: operation.connection,
        ok: false,
        durationMs: Date.now() - started,
        failure: `browser step failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      };
    } finally {
      if (!borrowed) await session.close();
    }
  }
}

async function applyStep(session: BrowserSession, step: BrowserStep): Promise<void> {
  switch (step.action) {
    case "goto":
      await session.goto(step.url);
      return;
    case "fill":
      await session.fill(step.selector, step.value);
      return;
    case "click":
      await session.click(step.selector);
      return;
    case "select":
      await session.select(step.selector, step.value);
      return;
    case "upload":
      await session.upload(step.selector, step.file);
      return;
    case "waitFor":
      await session.waitFor(step.selector, step.timeoutMs);
      return;
  }
}
