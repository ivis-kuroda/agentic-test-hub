#!/usr/bin/env node
/**
 * Starts one `apps/hub` instance and exits, leaving it running as a detached
 * process — the CI/shell counterpart to `startHubApp()` for the Python
 * generated tests, which (unlike the TypeScript ones, wired up through
 * Playwright's `globalSetup`) run via a plain `pytest` invocation with
 * nothing to call `startHubApp()` from directly.
 *
 * Deliberately two separate process invocations (this script, then `pytest`
 * as an unrelated shell command, then `hub-down.ts`) rather than one script
 * that starts the instance and spawns `pytest` itself as a child: spawning
 * `pytest` from a Node process that had just run `startHubApp()`'s own
 * `fetch()`-based readiness polling was found, empirically, to leave a
 * `sync_playwright()` call in the *grandchild* process convinced an asyncio
 * event loop was already running ("Please use the Async API instead") —
 * reliably, though its exact mechanism was not pinned down beyond "some
 * interaction between this Node process's own prior async activity and
 * inherited state in a spawned child's child." Every variant that skipped
 * that specific lineage (a plain shell invocation, `pytest` spawned by a
 * *different* short-lived Node process than the one that awaited any
 * networking) did not reproduce it. Splitting into separate processes here
 * sidesteps the whole question rather than resolving it.
 *
 * Prints `KEY=value` lines for `HUB_URL`/`HUB_LOG_FILE` on stdout, and also
 * appends them to `$GITHUB_ENV` when set, so both `eval "$(node
 * e2e/support/hub-up.ts)"` locally and a plain `node e2e/support/hub-up.ts`
 * step in a GitHub Actions workflow make the same two variables available
 * to every step/command that follows, until `hub-down.ts` tears it down.
 */
import { appendFile, writeFile } from "node:fs/promises";

import { startHubApp } from "./start-hub.ts";

const STATE_FILE = new URL("../.hub-state.json", import.meta.url);

const hub = await startHubApp();
await writeFile(
  STATE_FILE,
  JSON.stringify({ specsRoot: hub.specsRoot, logFile: hub.logFile, pid: hub.pid }),
  "utf8",
);

const lines = [`HUB_URL=${hub.url}`, `HUB_LOG_FILE=${hub.logFile}`];
process.stdout.write(lines.map((line) => `export ${line}\n`).join(""));

const githubEnv = process.env["GITHUB_ENV"];
if (githubEnv !== undefined) {
  await appendFile(githubEnv, lines.map((line) => `${line}\n`).join(""), "utf8");
}
