#!/usr/bin/env node
/**
 * Stops the `apps/hub` instance `hub-up.ts` started, and removes its
 * temporary `SPECS_ROOT` and log file. See `hub-up.ts` for why this is a
 * separate script rather than part of a single start-run-stop invocation.
 * Safe to run even if `hub-up.ts` was never called (nothing to do).
 */
import { readFile, rm } from "node:fs/promises";

import { stopByPid } from "./start-hub.ts";

const STATE_FILE = new URL("../.hub-state.json", import.meta.url);

let state: { specsRoot: string; logFile: string; pid: number };
try {
  state = JSON.parse(await readFile(STATE_FILE, "utf8"));
} catch (cause) {
  if ((cause as { code?: string }).code === "ENOENT") process.exit(0);
  throw cause;
}

await stopByPid(state.pid);
await rm(state.specsRoot, { recursive: true, force: true });
await rm(state.logFile, { force: true });
await rm(STATE_FILE, { force: true });
