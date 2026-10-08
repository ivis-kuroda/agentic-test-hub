import { renderDeep, TemplateError, type Operation } from "@agentic-test-hub/plugin";

import {
  ExecutorError,
  type ExecutionContext,
  type ExecutionResult,
  type Executor,
} from "./types.ts";

/** Executors available to a run, keyed by the operation kind they handle. */
export class ExecutorRegistry {
  private readonly executors = new Map<string, Executor>();

  /**
   * Registers an executor, replacing any previous one for its kind.
   *
   * @param executor - The executor to register.
   * @returns The registry, for chaining.
   */
  register(executor: Executor): this {
    this.executors.set(executor.kind, executor);
    return this;
  }

  /** Reports whether a kind of operation can be run. */
  supports(kind: Operation["executor"]): boolean {
    return this.executors.has(kind);
  }

  /**
   * Runs a declared operation by id.
   *
   * Arguments are rendered, then placed in the `param` scope, so a manifest
   * refers to them as `{{param.name}}` regardless of how the operation is
   * invoked — from a case, from a state provider, or while collecting
   * evidence. Rendering uses the context's own scopes (`env`, `step`, `run`
   * and any `param` already present), so a spec can pass
   * `token: "{{env.TOKEN}}"` or `recid: "{{step.recid}}"`. A string that is a
   * single placeholder keeps a structured value as it is.
   *
   * @param operationId - Operation to run, as declared in the manifest.
   * @param params - Arguments for it.
   * @param context - Manifest, ambient scopes and cancellation.
   * @returns What the operation produced.
   * @throws {ExecutorError} When the operation or its executor is unavailable,
   *   an argument is missing, or a placeholder in an argument cannot be
   *   resolved (the message names operation, param and placeholder).
   */
  async run(
    operationId: string,
    params: Readonly<Record<string, unknown>>,
    context: ExecutionContext,
  ): Promise<ExecutionResult> {
    const operation = context.manifest.operations[operationId];
    if (!operation) {
      throw new ExecutorError(
        `operation ${operationId} is not declared by plugin "${context.manifest.name}"`,
        operationId,
      );
    }

    const executor = this.executors.get(operation.executor);
    if (!executor) {
      throw new ExecutorError(
        `no executor is registered for ${operation.executor} operations`,
        operationId,
      );
    }

    const optional = new Set(operation.optionalParams);
    const missing = [...new Set(operation.params)].filter(
      (name) => !optional.has(name) && !Object.hasOwn(params, name),
    );
    if (missing.length > 0) {
      // Caught here rather than left to interpolation, so the message names
      // the operation and every missing argument at once.
      throw new ExecutorError(`operation ${operationId} needs ${missing.join(", ")}`, operationId);
    }

    const rendered: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(params)) {
      try {
        rendered[name] = renderDeep(value, context.scopes);
      } catch (cause) {
        if (!(cause instanceof TemplateError)) throw cause;
        throw new ExecutorError(
          `operation ${operationId}: param "${name}": ${cause.message}`,
          operationId,
        );
      }
    }

    const merged: ExecutionContext = {
      ...context,
      scopes: { ...context.scopes, param: { ...context.scopes.param, ...rendered } },
    };

    const result = await executor.run(operation as never, merged);
    return { ...result, operation: operationId };
  }
}
