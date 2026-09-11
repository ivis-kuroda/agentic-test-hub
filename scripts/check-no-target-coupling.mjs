/**
 * Fails when hub source mentions a specific target application.
 *
 * The hub is generic: it knows how to run a command, make a request, query a
 * database and drive a browser, and nothing about any particular system.
 * Application knowledge belongs in a plugin repository.
 *
 * That boundary erodes quietly. Someone adds one conditional for the target
 * they happen to be working on, it is reasonable in isolation, and a year
 * later the hub only works for that target. This check makes the erosion
 * loud, at the cost of occasionally being wrong — in which case the fix is to
 * rename the thing, not to widen the list.
 *
 * Vocabulary is read from `scripts/target-vocabulary.txt`, one term per line,
 * so that adding a second target does not mean editing this file.
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const VOCABULARY_FILE = join(ROOT, "scripts/target-vocabulary.txt");

/** Directories with nothing authored in them. */
const EXEMPT = new Set(["node_modules", ".git", "dist", "artifacts", "coverage"]);

/** Files allowed to name a target, because naming one is their subject. */
const EXEMPT_FILES = new Set([
  "scripts/check-no-target-coupling.mjs",
  "scripts/target-vocabulary.txt",
]);

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (EXEMPT.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(ts|mts|vue|json|ya?ml|md)$/.test(entry.name)) yield full;
  }
}

const vocabulary = (await readFile(VOCABULARY_FILE, "utf8"))
  .split("\n")
  .map((line) => line.replace(/#.*$/, "").trim().toLowerCase())
  .filter(Boolean);

const findings = [];
for await (const file of walk(ROOT)) {
  const rel = relative(ROOT, file);
  if (EXEMPT_FILES.has(rel)) continue;
  const text = (await readFile(file, "utf8")).toLowerCase();
  for (const term of vocabulary) {
    let index = text.indexOf(term);
    while (index !== -1) {
      findings.push({ rel, term, line: text.slice(0, index).split("\n").length });
      index = text.indexOf(term, index + term.length);
    }
  }
}

if (findings.length > 0) {
  console.error("Hub source must not name a specific target application.\n");
  for (const { rel, line, term } of findings) {
    console.error(`  ${rel}:${line}  mentions "${term}"`);
  }
  console.error("\nMove this into the plugin repository, or rename it in generic terms.");
  process.exit(1);
}

console.log(`No target coupling found (${vocabulary.length} term(s) checked).`);
