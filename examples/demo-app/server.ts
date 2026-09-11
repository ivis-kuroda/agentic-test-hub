/**
 * A deliberately small application the hub tests itself against.
 *
 * Its purpose is to be *not* the real target. The hub must stay generic, and
 * the easiest way for application knowledge to creep in is for the only thing
 * it is ever run against to be one particular system. Everything here is
 * fictional: a service that accepts notification requests and delivers them
 * over a channel.
 *
 * It is deliberately dependency-free and served from one file so that it
 * starts instantly and can never become a project of its own.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

/** A notification the service accepted. */
export interface Notification {
  readonly id: string;
  readonly channel: string;
  readonly recipient: string;
  readonly createdAt: string;
}

/** Channels the service will deliver over. */
export const CHANNELS = ["email", "sms", "push"] as const;

/** One line the service wrote while handling a request. */
export interface LogLine {
  readonly level: "info" | "warn" | "error";
  readonly message: string;
  readonly at: string;
}

/**
 * Everything the running service holds.
 *
 * Exposed so tests can inspect it directly when they are testing the hub
 * rather than the service. Nothing in the hub may reach for it.
 */
export interface DemoState {
  notifications: Notification[];
  logs: LogLine[];
  nextId: number;
}

/** Options for starting the service. */
export interface DemoOptions {
  /** Token callers must present. Requests without it are rejected. */
  readonly token?: string;
  /** Port to listen on. Zero asks the operating system for a free one. */
  readonly port?: number;
}

/** A running service, with the means to inspect and stop it. */
export interface RunningDemo {
  readonly url: string;
  readonly state: DemoState;
  readonly server: Server;
  stop(): Promise<void>;
}

const DEFAULT_TOKEN = "demo-token";

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": String(Buffer.byteLength(payload)),
  });
  response.end(payload);
}

function html(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  response.end(body);
}

async function readRequestBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  if (text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Renders the single page the browser-driven tests exercise.
 *
 * Every element a test needs carries a `data-testid`. That is the point: the
 * example shows what a target looks like when it has been made testable, so
 * the hub's own browser tests never depend on incidental markup.
 */
function page(state: DemoState): string {
  const rows = state.notifications
    .map(
      (notification) =>
        `<li data-testid="notification" data-channel="${notification.channel}">` +
        `${notification.recipient} via ${notification.channel}</li>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Dispatch</title></head>
<body>
  <h1 data-testid="heading">Dispatch</h1>
  <form data-testid="compose" method="post" action="/notifications">
    <input data-testid="recipient" name="recipient" placeholder="recipient">
    <select data-testid="channel" name="channel">
      ${CHANNELS.map((channel) => `<option value="${channel}">${channel}</option>`).join("")}
    </select>
    <button data-testid="submit" type="submit">Send</button>
  </form>
  <p data-testid="count">${state.notifications.length}</p>
  <ul data-testid="notifications">${rows}</ul>
</body>
</html>`;
}

/**
 * Starts the service.
 *
 * @param options - Token to require and port to listen on.
 * @returns The running service, its address and its state.
 */
export async function startDemoApp(options: DemoOptions = {}): Promise<RunningDemo> {
  const token = options.token ?? DEFAULT_TOKEN;
  const state: DemoState = { notifications: [], logs: [], nextId: 1 };

  const log = (level: LogLine["level"], message: string): void => {
    state.logs.push({ level, message, at: new Date().toISOString() });
  };

  const server = createServer((request, response) => {
    void handle(request, response).catch((cause: unknown) => {
      log("error", `unhandled: ${String(cause)}`);
      json(response, 500, { error: "internal error" });
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://localhost");
    const route = `${request.method} ${url.pathname}`;

    if (route === "GET /health") {
      json(response, 200, { ok: true });
      return;
    }

    if (route === "GET /") {
      html(response, 200, page(state));
      return;
    }

    if (route === "GET /logs") {
      json(response, 200, { logs: state.logs });
      return;
    }

    if (route === "GET /notifications") {
      json(response, 200, { notifications: state.notifications });
      return;
    }

    if (route === "POST /notifications") {
      const authorization = request.headers.authorization;
      if (authorization !== `Bearer ${token}`) {
        // Logged as a warning, not an error: a rejected request is the
        // service working, and tests for it assert on the rejection rather
        // than on the absence of noise.
        log("warn", "rejected a request with no usable credentials");
        json(response, 401, { error: "credentials required" });
        return;
      }

      const body = await readRequestBody(request);
      const fields = (typeof body === "object" && body !== null ? body : {}) as Record<
        string,
        unknown
      >;
      // A field that is not text is not a value the service accepts, so it is
      // read as absent rather than coerced into something plausible.
      const channel = typeof fields["channel"] === "string" ? fields["channel"] : "";
      const recipient = typeof fields["recipient"] === "string" ? fields["recipient"] : "";

      if (!(CHANNELS as readonly string[]).includes(channel)) {
        log("warn", `rejected an unsupported channel: ${channel || "(none)"}`);
        json(response, 400, { error: `unsupported channel: ${channel || "(none)"}` });
        return;
      }
      if (recipient === "") {
        log("warn", "rejected a request with no recipient");
        json(response, 400, { error: "recipient is required" });
        return;
      }

      const notification: Notification = {
        id: `n-${state.nextId}`,
        channel,
        recipient,
        createdAt: new Date().toISOString(),
      };
      state.nextId += 1;
      state.notifications.push(notification);
      log("info", `accepted ${notification.id} for delivery over ${channel}`);
      json(response, 201, { notification });
      return;
    }

    if (route === "DELETE /notifications") {
      const removed = state.notifications.length;
      state.notifications = [];
      log("info", `drained ${removed} notification(s)`);
      json(response, 200, { removed });
      return;
    }

    json(response, 404, { error: `no route for ${route}` });
  }

  await new Promise<void>((settle) => {
    server.listen(options.port ?? 0, "127.0.0.1", settle);
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("demo app did not bind to a port");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    state,
    server,
    // Idempotent: a test that stops the service to observe how the hub
    // reports an unreachable target should not then fail in its own teardown.
    stop: () =>
      new Promise<void>((settle, fail) => {
        if (!server.listening) {
          settle();
          return;
        }
        server.close((error) => (error ? fail(error) : settle()));
      }),
  };
}
