/**
 * Test scaffolding for the runner.
 *
 * Every executor takes its means of doing work as a parameter, so these
 * tests need no processes, no server and no database. The subject is a
 * fictional dispatch service, unrelated to any real target.
 */
import { loadManifest, type PluginManifest } from "@agentic-test-hub/plugin";

import { ExecutorRegistry } from "../src/executor/registry.ts";
import type { SpawnFn, SpawnOutcome } from "../src/executor/shell.ts";
import type { QueryFn, Row } from "../src/executor/sql.ts";
import type { ExecutionContext } from "../src/executor/types.ts";

export const manifestSource = `
apiVersion: "1"
name: dispatch-service

connections:
  primary-db:
    kind: postgres
    url: "postgres://user@db.invalid/dispatch"
  api:
    kind: http
    baseUrl: "https://api.invalid/v1"
    headers:
      Accept: application/json

operations:
  OP-SEND:
    executor: http
    connection: api
    method: POST
    path: /notifications
    params: [channel]
    body:
      channel: "{{param.channel}}"

  OP-FETCH:
    executor: http
    connection: api
    path: /notifications/{{param.id}}
    params: [id]

  OP-COUNT-QUEUED:
    executor: sql
    connection: primary-db
    query: "select count(*) as n from queued"

  OP-LIST-QUEUED:
    executor: sql
    connection: primary-db
    query: "select id from queued"

  OP-DRAIN:
    executor: shell
    run: ["dispatchctl", "queue", "drain"]
    timeoutMs: 5000

  OP-SEED:
    executor: shell
    run: ["python", "seeds/recipient.py", "--email", "{{param.email}}"]
    stdin: json
    params: [email]

states:
  queue.empty:
    ensure: { operation: OP-DRAIN }
    verify:
      operation: OP-COUNT-QUEUED
      assert: { kind: equals, value: 0 }
    cost: low

  queue.drained.slow:
    ensure: { operation: OP-DRAIN }
    verify:
      operation: OP-COUNT-QUEUED
      assert: { kind: equals, value: 0 }
    cost: high
`;

export const manifest: PluginManifest = loadManifest(manifestSource).manifest;

/** A context with no ambient values, for the fictional plugin above. */
export function contextFor(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return { manifest, scopes: {}, root: "/plugin", ...overrides };
}

/** Records what a command was asked to do and replies with a fixed outcome. */
export function recordingSpawn(outcome: Partial<SpawnOutcome> = {}): SpawnFn & {
  calls: { command: string; args: readonly string[]; stdin?: string; cwd: string }[];
} {
  const calls: { command: string; args: readonly string[]; stdin?: string; cwd: string }[] = [];
  const fn: SpawnFn = (command, args, options) => {
    calls.push({
      command,
      args,
      cwd: options.cwd,
      ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
    });
    return Promise.resolve({ exitCode: 0, stdout: "", stderr: "", ...outcome });
  };
  return Object.assign(fn, { calls });
}

/** Replies to every request with a fixed response, recording the requests. */
export function recordingFetch(
  reply: { status?: number; body?: string; headers?: Record<string, string> } = {},
): typeof fetch & { calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = ((url: string | URL | Request, init: RequestInit = {}) => {
    // Request carries no useful default stringification, so each shape is
    // read explicitly rather than coerced.
    const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    calls.push({ url: href, init });
    return Promise.resolve(
      new Response(reply.body ?? "", {
        status: reply.status ?? 200,
        headers: reply.headers ?? {},
      }),
    );
  }) as typeof fetch;
  return Object.assign(fn, { calls });
}

/** Returns fixed rows, recording the queries it was given. */
export function recordingQuery(
  rows: readonly Row[] = [],
): QueryFn & { calls: { url: string; query: string }[] } {
  const calls: { url: string; query: string }[] = [];
  const fn: QueryFn = (url, query) => {
    calls.push({ url, query });
    return Promise.resolve(rows);
  };
  return Object.assign(fn, { calls });
}

/** A registry wired with whichever executors a test supplies. */
export function registryWith(
  ...executors: Parameters<ExecutorRegistry["register"]>[0][]
): ExecutorRegistry {
  const registry = new ExecutorRegistry();
  for (const executor of executors) registry.register(executor);
  return registry;
}
