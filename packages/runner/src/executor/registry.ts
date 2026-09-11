import type { Operation } from "@agentic-test-hub/plugin";

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
   * Arguments are placed in the `param` scope, so a manifest refers to them
   * as `{{param.name}}` regardless of how the operation is invoked — from a
   * case, from a state provider, or while collecting evidence.
   *
   * @param operationId - Operation to run, as declared in the manifest.
   * @param params - Arguments for it.
   * @param context - Manifest, ambient scopes and cancellation.
   * @returns What the operation produced.
   * @throws {ExecutorError} When the operation or its executor is unavailable.
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

    const declared = new Set(operation.params);
    const missing = [...declared].filter((name) => !Object.hasOwn(params, name));
    if (missing.length > 0) {
      // Caught here rather than left to interpolation, so the message names
      // the operation and every missing argument at once.
      throw new ExecutorError(`operation ${operationId} needs ${missing.join(", ")}`, operationId);
    }

    const merged: ExecutionContext = {
      ...context,
      scopes: { ...context.scopes, param: { ...context.scopes.param, ...params } },
    };

    const result = await executor.run(operation as never, merged);
    return { ...result, operation: operationId };
  }
}
