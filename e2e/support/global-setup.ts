/**
 * Starts one `apps/hub` instance for the whole `hub-self-test` Playwright
 * project run, and publishes its address to every generated test file.
 *
 * AI-generated test code (`e2e/generated/typescript/**`, from
 * `ath-generate-test`) is a self-contained `runCase`/`runScenario` call that
 * reads `{{env.X}}` placeholders from `process.env` — it has no lifecycle
 * hook of its own to start a target, by design, since the same generated
 * shape has to work for any plugin. `start-hub.ts`'s own guidance ("a fresh
 * instance once per test file") is about isolating *separate runs* of this
 * suite from each other, not about restarting mid-run: every generated case
 * and scenario here creates entities under ids it also deletes (or is safe
 * to recreate) by the time it finishes, so sharing one instance across every
 * file in a single run is safe, and is the only option generated code's
 * fixed shape actually allows.
 *
 * Returning the teardown function (rather than a separate globalTeardown
 * module) is Playwright's own documented mechanism for this exact case: it
 * runs in the same process as this function, so it can close over `hub`
 * directly instead of having to serialise enough state to reconstruct it.
 */
import { startHubApp } from "./start-hub.ts";

export default async function globalSetup(): Promise<() => Promise<void>> {
  const hub = await startHubApp();
  process.env["HUB_URL"] = hub.url;
  process.env["HUB_LOG_FILE"] = hub.logFile;
  return () => hub.stop();
}
