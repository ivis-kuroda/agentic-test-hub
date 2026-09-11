import { describe, expect, it } from "vitest";

import { HttpExecutor } from "../src/executor/http.ts";
import { ShellExecutor } from "../src/executor/shell.ts";
import { SqlExecutor } from "../src/executor/sql.ts";
import { ExecutorError } from "../src/executor/types.ts";
import {
  contextFor,
  recordingFetch,
  recordingQuery,
  recordingSpawn,
  registryWith,
} from "./harness.ts";

describe("ShellExecutor", () => {
  it("passes the command and its arguments separately, with no shell", async () => {
    const spawn = recordingSpawn();
    const registry = registryWith(new ShellExecutor(spawn));
    await registry.run("OP-DRAIN", {}, contextFor());
    expect(spawn.calls[0]).toMatchObject({
      command: "dispatchctl",
      args: ["queue", "drain"],
    });
  });

  it("keeps an interpolated value as one argument, not as syntax", async () => {
    const spawn = recordingSpawn();
    const registry = registryWith(new ShellExecutor(spawn));
    await registry.run("OP-SEED", { email: 'a"; rm -rf /; echo "b' }, contextFor());
    expect(spawn.calls[0]?.args).toEqual([
      "seeds/recipient.py",
      "--email",
      'a"; rm -rf /; echo "b',
    ]);
  });

  it("feeds parameters as json on stdin when asked", async () => {
    const spawn = recordingSpawn();
    const registry = registryWith(new ShellExecutor(spawn));
    await registry.run("OP-SEED", { email: "someone@example.invalid" }, contextFor());
    expect(JSON.parse(spawn.calls[0]?.stdin ?? "{}")).toEqual({
      email: "someone@example.invalid",
    });
  });

  it("sends no stdin for an operation that did not ask for it", async () => {
    const spawn = recordingSpawn();
    const registry = registryWith(new ShellExecutor(spawn));
    await registry.run("OP-DRAIN", {}, contextFor());
    expect(spawn.calls[0]?.stdin).toBeUndefined();
  });

  it("resolves the working directory against the plugin root", async () => {
    const spawn = recordingSpawn();
    const registry = registryWith(new ShellExecutor(spawn));
    await registry.run("OP-DRAIN", {}, contextFor({ root: "/somewhere/plugin" }));
    expect(spawn.calls[0]?.cwd).toBe("/somewhere/plugin");
  });

  it("treats a non-zero exit as an outcome, not as a failure to run", async () => {
    const registry = registryWith(new ShellExecutor(recordingSpawn({ exitCode: 3 })));
    const result = await registry.run("OP-DRAIN", {}, contextFor());
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(3);
  });

  it("treats a command that could not run as a failure", async () => {
    const registry = registryWith(
      new ShellExecutor(recordingSpawn({ exitCode: -1, failure: "not found" })),
    );
    const result = await registry.run("OP-DRAIN", {}, contextFor());
    expect(result.ok).toBe(false);
    expect(result.failure).toBe("not found");
  });

  it("captures both streams", async () => {
    const registry = registryWith(
      new ShellExecutor(recordingSpawn({ stdout: "drained", stderr: "warned" })),
    );
    const result = await registry.run("OP-DRAIN", {}, contextFor());
    expect(result).toMatchObject({ stdout: "drained", stderr: "warned" });
  });
});

describe("HttpExecutor", () => {
  it("joins the connection base with the operation path", async () => {
    const fetchFn = recordingFetch();
    const registry = registryWith(new HttpExecutor(fetchFn));
    await registry.run("OP-SEND", { channel: "email" }, contextFor());
    expect(fetchFn.calls[0]?.url).toBe("https://api.invalid/v1/notifications");
  });

  it("interpolates into the path", async () => {
    const fetchFn = recordingFetch();
    const registry = registryWith(new HttpExecutor(fetchFn));
    await registry.run("OP-FETCH", { id: "42" }, contextFor());
    expect(fetchFn.calls[0]?.url).toBe("https://api.invalid/v1/notifications/42");
  });

  it("merges connection headers with operation headers", async () => {
    const fetchFn = recordingFetch();
    const registry = registryWith(new HttpExecutor(fetchFn));
    await registry.run("OP-SEND", { channel: "email" }, contextFor());
    expect(fetchFn.calls[0]?.init.headers).toMatchObject({
      Accept: "application/json",
      "Content-Type": "application/json",
    });
  });

  it("renders the body from parameters", async () => {
    const fetchFn = recordingFetch();
    const registry = registryWith(new HttpExecutor(fetchFn));
    await registry.run("OP-SEND", { channel: "sms" }, contextFor());
    const body = fetchFn.calls[0]?.init.body;
    expect(typeof body).toBe("string");
    expect(JSON.parse(body as string)).toEqual({ channel: "sms" });
  });

  it("treats a rejection as a completed operation, since cases expect them", async () => {
    const registry = registryWith(new HttpExecutor(recordingFetch({ status: 401 })));
    const result = await registry.run("OP-SEND", { channel: "email" }, contextFor());
    expect(result.ok).toBe(true);
    expect(result.status).toBe(401);
  });

  it("treats a request that never reached the service as a failure", async () => {
    const failing = (() => Promise.reject(new Error("getaddrinfo ENOTFOUND"))) as typeof fetch;
    const registry = registryWith(new HttpExecutor(failing));
    const result = await registry.run("OP-SEND", { channel: "email" }, contextFor());
    expect(result.ok).toBe(false);
    expect(result.failure).toMatch(/ENOTFOUND/);
  });

  it("parses a json body", async () => {
    const registry = registryWith(new HttpExecutor(recordingFetch({ body: '{"id":"n-1"}' })));
    const result = await registry.run("OP-SEND", { channel: "email" }, contextFor());
    expect(result.body).toEqual({ id: "n-1" });
  });

  it("keeps a body that is not json as text rather than failing", async () => {
    const registry = registryWith(
      new HttpExecutor(recordingFetch({ body: "<html>gateway error</html>" })),
    );
    const result = await registry.run("OP-SEND", { channel: "email" }, contextFor());
    expect(result.body).toBe("<html>gateway error</html>");
  });

  it("reports an empty body as absent, not as an empty string", async () => {
    const registry = registryWith(new HttpExecutor(recordingFetch({ status: 204 })));
    const result = await registry.run("OP-SEND", { channel: "email" }, contextFor());
    expect(result.body).toBeUndefined();
  });
});

describe("SqlExecutor", () => {
  it("runs the declared query against the connection", async () => {
    const query = recordingQuery([{ n: 0 }]);
    const registry = registryWith(new SqlExecutor(query));
    await registry.run("OP-COUNT-QUEUED", {}, contextFor());
    expect(query.calls[0]).toEqual({
      url: "postgres://user@db.invalid/dispatch",
      query: "select count(*) as n from queued",
    });
  });

  it("returns the rows", async () => {
    const registry = registryWith(new SqlExecutor(recordingQuery([{ id: 1 }, { id: 2 }])));
    const result = await registry.run("OP-LIST-QUEUED", {}, contextFor());
    expect(result.rows).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("treats a query that failed as a failure, since it revealed nothing", async () => {
    const failing = () => Promise.reject(new Error("relation does not exist"));
    const registry = registryWith(new SqlExecutor(failing));
    const result = await registry.run("OP-COUNT-QUEUED", {}, contextFor());
    expect(result.ok).toBe(false);
    expect(result.failure).toMatch(/relation does not exist/);
  });

  it("refuses a connection of the wrong kind", async () => {
    const registry = registryWith(new SqlExecutor(recordingQuery()));
    const broken = contextFor({
      manifest: {
        ...contextFor().manifest,
        operations: {
          ...contextFor().manifest.operations,
          "OP-COUNT-QUEUED": {
            executor: "sql",
            connection: "api",
            query: "select 1",
            params: [],
            timeoutMs: 1000,
          },
        },
      },
    });
    await expect(registry.run("OP-COUNT-QUEUED", {}, broken)).rejects.toThrow(ExecutorError);
  });
});
