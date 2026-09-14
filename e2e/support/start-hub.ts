/**
 * Starts `apps/hub` in isolation for the hub self-test suite, mirroring
 * `examples/demo-app/server.ts`'s `startDemoApp()`: a fresh instance, its own
 * address, and a `stop()` that leaves nothing behind.
 *
 * Unlike demo-app's dependency-free in-process HTTP server, `apps/hub` is a
 * full Nuxt application with no "start programmatically" export, so this
 * spawns it as a child process instead — a production build (`nuxt build`,
 * then `node .output/server/index.mjs`), not `nuxt dev`. That was not the
 * first choice: dev mode's cold *server* startup measured only ~6.5s, which
 * looked acceptable. What dev mode does not offer is fast *hydration* —
 * it serves the client bundle as dozens of individual unbundled ES modules,
 * and a browser step that interacts with the page (a click, a fill) before
 * Vue has finished attaching its event listeners fails silently: the DOM
 * click "succeeds" with no error, but nothing happens, because dev mode's
 * hydration was still in flight. The production build hydrates in under a
 * second in this sandbox and does not have that race. The build itself
 * (~27s) is shared across every caller, in this process and any others
 * running concurrently, via {@link ensureBuilt} — see its own doc comment —
 * so it is paid once per test run, not once per file or per worker.
 *
 * A fresh server instance is intended once per test file (`test.beforeAll`),
 * not per case — spawning a new process per case would be far slower than
 * demo-app's instant in-memory server. Individual cases should create and
 * delete their own uniquely-ID'd entities rather than relying on the
 * directory being reset between them.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { access, cp, mkdir, mkdtemp, open, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/** `apps/hub`'s own package directory — where it is built and run from. */
const HUB_ROOT = join(HERE, "..", "..", "apps", "hub");
/** Held by whichever process is currently running `pnpm build` (see {@link ensureBuilt}). */
const HUB_BUILD_LOCK_DIR = join(HUB_ROOT, ".output-building");
/** The built server's entry point, once `pnpm build` has run. */
const HUB_SERVER_ENTRY = join(HUB_ROOT, ".output", "server", "index.mjs");
/** Seed content copied into a fresh `SPECS_ROOT` for every run. */
const DEFAULT_FIXTURE_SPECS = join(HERE, "..", "fixtures", "specs");

/**
 * Builds `apps/hub` once and reuses the result — including across separate
 * *processes*, not only within one: Playwright runs this suite's test files
 * across several worker processes in parallel, each an independent Node
 * process with no shared in-memory state, so an in-process-only cache (a
 * plain module-level promise) does not stop two workers from calling this
 * at nearly the same moment and both starting `pnpm build`, clobbering the
 * same `.output` mid-write — found exactly this way in CI, where multiple
 * workers really do race this, unlike every local run in this sandbox so
 * far (always started with `--workers=1`).
 *
 * `mkdir` on `HUB_BUILD_LOCK_DIR` is the cross-process lock: it is atomic
 * (POSIX guarantees `EEXIST` for a second caller, never two callers both
 * succeeding), so exactly one process ever proceeds to build; every other
 * caller — in this process or another — polls for `HUB_SERVER_ENTRY` to
 * appear instead. The build writes into `HUB_OUTPUT_DIR` directly (Nitro's
 * own output path, not reconfigurable per-call), so a poller can only tell
 * "done" from "not started yet" by the entry file's existence, which is why
 * the lock directory is removed only *after* a successful build confirms
 * that file is actually there.
 */
let buildOnce: Promise<void> | undefined;

async function waitForEntry(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await accessible(HUB_SERVER_ENTRY)) return true;
    await new Promise((settle) => setTimeout(settle, 300));
  }
  return accessible(HUB_SERVER_ENTRY);
}

async function accessible(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureBuilt(): Promise<void> {
  buildOnce ??= (async () => {
    if (await accessible(HUB_SERVER_ENTRY)) return;

    try {
      await mkdir(HUB_BUILD_LOCK_DIR);
    } catch (cause) {
      if ((cause as { code?: string }).code !== "EEXIST") throw cause;
      // Another process (this one or a sibling worker) is already building;
      // wait for its result rather than racing it.
      const ready = await waitForEntry(180_000);
      if (!ready) {
        throw new Error(
          `apps/hub build did not finish (started by another process) within 180000ms`,
        );
      }
      return;
    }

    try {
      await new Promise<void>((resolve, reject) => {
        // Inherited, not "ignore": a build failure with its output
        // swallowed is undiagnosable from the test failure alone (found
        // the hard way — CI reported only "apps/hub build failed with exit
        // code 1", no output).
        const build = spawn("pnpm", ["build"], { cwd: HUB_ROOT, stdio: "inherit" });
        build.once("error", reject);
        build.once("exit", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`apps/hub build failed with exit code ${code}`));
        });
      });
    } finally {
      await rm(HUB_BUILD_LOCK_DIR, { recursive: true, force: true });
    }
  })();
  await buildOnce;
}

/** A running `apps/hub` instance under test. */
export interface RunningHub {
  readonly url: string;
  /** The temporary directory `apps/hub` is reading/writing as its `SPECS_ROOT`. */
  readonly specsRoot: string;
  /**
   * Where the server's stdout/stderr is captured.
   *
   * apps/hub exposes no log-reading endpoint the way `examples/demo-app`
   * does, so `e2e/plugin.yaml`'s `app_log` evidence collector reads this file
   * (via `{{env.HUB_LOG_FILE}}`) instead of an HTTP call.
   */
  readonly logFile: string;
  /**
   * The server process's id, for stopping it from a separate later
   * invocation (see `hub-up.ts`/`hub-down.ts`) rather than only via the
   * `stop()` closure here, which needs the same process alive to call.
   */
  readonly pid: number;
  /** Stops the Nuxt process and removes the temporary `SPECS_ROOT`. Idempotent. */
  stop(): Promise<void>;
}

export interface StartHubOptions {
  /** Seed specs to copy into the temporary `SPECS_ROOT`. Defaults to `e2e/fixtures/specs`. */
  readonly fixtureSpecs?: string;
  /** How long to wait for the first successful `GET /api/suite`. */
  readonly readyTimeoutMs?: number;
}

/** Asks the OS for a free port by briefly binding to one, then releasing it. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        reject(new Error("could not allocate a port"));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}

/** Copies fixture seed content into a fresh temp directory; empty if none exists. */
async function seedSpecsRoot(fixtureSpecs: string): Promise<string> {
  const specsRoot = await mkdtemp(join(tmpdir(), "hub-self-test-"));
  try {
    await cp(fixtureSpecs, specsRoot, { recursive: true });
  } catch (cause) {
    if ((cause as { code?: string }).code !== "ENOENT") throw cause;
  }
  return specsRoot;
}

/** Polls `GET /api/suite` until it answers, or the process exits, or time runs out. */
async function waitUntilReady(url: string, child: ChildProcess, timeoutMs: number): Promise<void> {
  let earlyExit: string | undefined;
  const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
    earlyExit = `apps/hub exited before becoming ready (code ${code}, signal ${signal})`;
  };
  child.once("exit", onExit);

  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      if (earlyExit !== undefined) throw new Error(earlyExit);
      try {
        const response = await fetch(`${url}/api/suite`);
        if (response.ok) return;
      } catch {
        // Not accepting connections yet.
      }
      await new Promise((settle) => setTimeout(settle, 300));
    }
    throw new Error(`apps/hub did not become ready at ${url} within ${timeoutMs}ms`);
  } finally {
    child.off("exit", onExit);
  }
}

/** Kills the whole process group `child` heads, waiting for it to actually exit. */
async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    try {
      process.kill(-child.pid!, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
    const hardKill = setTimeout(() => {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        // Already gone.
      }
    }, 5_000);
    hardKill.unref();
  });
}

/**
 * Starts `apps/hub` against a fresh, isolated `SPECS_ROOT`.
 *
 * @param options - Fixture seed override and readiness timeout.
 * @returns The running instance: its URL, its temp `SPECS_ROOT`, and `stop()`.
 */
export async function startHubApp(options: StartHubOptions = {}): Promise<RunningHub> {
  await ensureBuilt();
  const specsRoot = await seedSpecsRoot(options.fixtureSpecs ?? DEFAULT_FIXTURE_SPECS);
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const logFile = join(specsRoot, "..", `${specsRoot.split("/").pop()}.log`);
  const log = await open(logFile, "w");

  const child = spawn(process.execPath, [HUB_SERVER_ENTRY], {
    cwd: HUB_ROOT,
    env: { ...process.env, SPECS_ROOT: specsRoot, PORT: String(port), HOST: "127.0.0.1" },
    stdio: ["ignore", log.fd, log.fd],
    // Its own process group, so stopProcess can kill any child workers the
    // Nitro server starts too, rather than orphaning them.
    detached: true,
  });
  // Never by itself a reason for this process to stay alive — normal
  // callers (a test file, Playwright's global-setup) have other work doing
  // that already, and hub-up.ts (which has none) depends on this to exit
  // once it has printed the running instance's details, leaving the server
  // running as a detached process behind it.
  child.unref();

  let logClosed = false;
  const cleanupLog = async (): Promise<void> => {
    if (logClosed) return;
    logClosed = true;
    await log.close();
    await rm(logFile, { force: true });
  };

  try {
    await waitUntilReady(url, child, options.readyTimeoutMs ?? 60_000);
  } catch (cause) {
    await stopProcess(child);
    await rm(specsRoot, { recursive: true, force: true });
    await cleanupLog();
    throw cause;
  }

  return {
    url,
    specsRoot,
    logFile,
    pid: child.pid!,
    stop: async () => {
      await stopProcess(child);
      await rm(specsRoot, { recursive: true, force: true });
      await cleanupLog();
    },
  };
}

/**
 * Kills the process group headed by `pid`, waiting for it to actually exit.
 *
 * The counterpart to {@link stopProcess} for a caller that only has a PID,
 * not the original `ChildProcess` — `hub-down.ts`, run as its own fresh
 * process well after the one that started the server has already exited.
 * Polls for death with signal `0` (raises `ESRCH` once the process is gone)
 * since there is no `child.once("exit", ...)` to await here.
 */
export async function stopByPid(pid: number, timeoutMs = 10_000): Promise<void> {
  const isAlive = (): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  if (!isAlive()) return;

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    // Already gone, or never had its own process group.
  }

  const deadline = Date.now() + timeoutMs;
  while (isAlive() && Date.now() < deadline) {
    await new Promise((settle) => setTimeout(settle, 200));
  }
  if (isAlive()) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
}
