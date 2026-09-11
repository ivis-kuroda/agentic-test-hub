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

/**
 * Reads a request body, accepting both of the shapes a real service receives.
 *
 * A browser submitting a form sends form encoding; a client calling the API
 * sends JSON. Supporting only the latter would make the page unusable, and a
 * demo whose own form does not work is not much of a demo.
 */
async function readRequestBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  if (text === "") return undefined;

  const contentType = request.headers["content-type"] ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(text));
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Reads one cookie from a request. */
function cookie(request: IncomingMessage, name: string): string | undefined {
  const header = request.headers.cookie;
  if (header === undefined) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

/**
 * Renders the single page the browser-driven tests exercise.
 *
 * Every element a test needs carries a `data-testid`. That is the point: the
 * example shows what a target looks like when it has been made testable, so
 * the hub's own browser tests never depend on incidental markup.
 */
function page(state: DemoState, variant: "sound" | "broken" | "noisy" = "sound"): string {
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
  ${variant === "broken" ? BROKEN_SCRIPT : variant === "noisy" ? NOISY_SCRIPT : ""}
</body>
</html>`;
}

/**
 * A page that is merely noisy.
 *
 * It asks for something that is not there, which a browser reports on the
 * console as an error, and does nothing else wrong. Mature applications are
 * full of this — an absent optional asset, a third-party script that gives up
 * — and a suite that treats it as failure is a suite whose console channel
 * gets switched off. Having a page that reproduces it means the filtering can
 * be tested rather than asserted.
 */
const NOISY_SCRIPT = `<script>
  fetch("/legacy/optional-widget.json").catch(function () {});
</script>`;

/**
 * A page that looks correct and is not.
 *
 * Served on request so the hub's own tests can demonstrate the thing the
 * evidence rules exist for: every visible element is present and correct, so
 * a screenshot shows a working page, while the console carries an uncaught
 * exception and a request to the service failed. A suite that judged by
 * appearance would pass this.
 */
const BROKEN_SCRIPT = `<script>
  fetch("/does-not-exist").catch(function () {});
  window.setTimeout(function () { throw new Error("dispatch widget failed to initialise"); }, 0);
</script>`;

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

    if (route === "GET /favicon.ico") {
      // Answered rather than left to 404. A browser reports a failed
      // subresource load as a console error, so a missing favicon makes every
      // page look broken on the console channel. Real applications have the
      // same problem; this one does not model it.
      response.writeHead(204).end();
      return;
    }

    if (route === "GET /") {
      // Opening the page establishes a session, which is how the form is
      // authenticated. The API path uses a bearer token instead, so both
      // kinds of credential are exercised.
      response.setHeader("Set-Cookie", `demo_session=${token}; Path=/; SameSite=Lax`);
      // `?broken=1` serves a page that looks right but is not. See
      // BROKEN_SCRIPT for why that is worth being able to ask for.
      const variant =
        url.searchParams.get("broken") === "1"
          ? "broken"
          : url.searchParams.get("noisy") === "1"
            ? "noisy"
            : "sound";
      html(response, 200, page(state, variant));
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
      const fromBrowser = (request.headers.accept ?? "").includes("text/html");
      const authorized =
        request.headers.authorization === `Bearer ${token}` ||
        cookie(request, "demo_session") === token;
      if (!authorized) {
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
      if (fromBrowser) {
        // A page that is left looking at raw JSON after submitting a form is
        // not a page anyone would ship.
        response.writeHead(303, { Location: "/" }).end();
        return;
      }
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
