import { spawn } from "node:child_process";
import { resolve as resolvePath } from "node:path";

import { renderDeep } from "@agentic-test-hub/plugin";
import type { Operation } from "@agentic-test-hub/plugin";

import type { ExecutionContext, ExecutionResult, Executor } from "./types.ts";

/** What a command reported when it finished. */
export interface SpawnOutcome {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  /** Set when the command could not be run or was cut short. */
  readonly failure?: string;
}

/** How a command is run. Injected so tests need no real processes. */
export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
    readonly stdin?: string;
    readonly timeoutMs: number;
    readonly signal?: AbortSignal;
  },
) => Promise<SpawnOutcome>;

/**
 * Runs a command through Node, capturing both streams.
 *
 * The command and its arguments are passed separately and no shell is
 * involved, so an interpolated value reaches the process as one argument and
 * cannot become syntax. A fixture path containing a space, a quote or a
 * semicolon stays a path.
 */
export const nodeSpawn: SpawnFn = (command, args, options) =>
  new Promise((settle) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let failure: string | undefined;

    const timer = setTimeout(() => {
      failure = `command did not finish within ${options.timeoutMs}ms`;
      child.kill("SIGKILL");
    }, options.timeoutMs);

    const onAbort = (): void => {
      failure = "command was cancelled";
      child.kill("SIGKILL");
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error: Error) => {
      failure = `command could not be run: ${error.message}`;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      settle({
        exitCode: code ?? -1,
        stdout,
        stderr,
        ...(failure === undefined ? {} : { failure }),
      });
    });

    if (options.stdin !== undefined) child.stdin.end(options.stdin);
    else child.stdin.end();
  });

/** Runs `shell` operations. */
export class ShellExecutor implements Executor<"shell"> {
  readonly kind = "shell" as const;
  private readonly spawnFn: SpawnFn;

  /**
   * @param spawnFn - How to run a command. Defaults to running it for real;
   *   tests supply a stand-in.
   */
  constructor(spawnFn: SpawnFn = nodeSpawn) {
    this.spawnFn = spawnFn;
  }

  async run(
    operation: Extract<Operation, { executor: "shell" }>,
    context: ExecutionContext,
  ): Promise<ExecutionResult> {
    const rendered = renderDeep(
      { run: operation.run, env: operation.env, cwd: operation.cwd },
      context.scopes,
    );
    const [command, ...args] = rendered.run;
    if (command === undefined) {
      throw new Error("shell operation has an empty command");
    }

    const stdin =
      operation.stdin === "json" ? JSON.stringify(context.scopes.param ?? {}) : undefined;

    const started = Date.now();
    const outcome = await this.spawnFn(command, args, {
      cwd: rendered.cwd === undefined ? context.root : resolvePath(context.root, rendered.cwd),
      env: rendered.env,
      timeoutMs: operation.timeoutMs,
      ...(stdin === undefined ? {} : { stdin }),
      ...(context.signal === undefined ? {} : { signal: context.signal }),
    });

    return {
      operation: command,
      // A non-zero exit is an outcome, not an executor failure: plenty of
      // cases expect a command to refuse what they asked of it.
      ok: outcome.failure === undefined,
      durationMs: Date.now() - started,
      exitCode: outcome.exitCode,
      stdout: outcome.stdout,
      stderr: outcome.stderr,
      ...(outcome.failure === undefined ? {} : { failure: outcome.failure }),
    };
  }
}
