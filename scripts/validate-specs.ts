#!/usr/bin/env node
/**
 * Fails when a specification directory does not hold together.
 *
 * Separate from the round-trip check because the two answer different
 * questions: that one asks whether a file is written the way the tool writes
 * it, this one asks whether what the files say makes sense together. A
 * failure in either should not have to be read carefully to tell which.
 *
 * Usage: `node scripts/validate-specs.ts <specs-dir>...`
 */
import { hasErrors, validateSuite } from "@agentic-test-hub/core";
import { loadSuite } from "@agentic-test-hub/store";

const roots = process.argv.slice(2);
if (roots.length === 0) {
  process.stderr.write("usage: validate-specs <specs-dir>...\n");
  process.exit(2);
}

let failed = false;

for (const root of roots) {
  const { suite, problems: fileProblems } = await loadSuite(root);

  for (const problem of fileProblems) {
    const where = problem.at === undefined ? problem.file : `${problem.file}:${problem.at}`;
    process.stderr.write(`error  ${where}  ${problem.message}\n`);
    failed = true;
  }

  const problems = validateSuite(suite);
  for (const problem of problems) {
    const stream = problem.severity === "error" ? process.stderr : process.stdout;
    stream.write(`${problem.severity.padEnd(7)}${problem.at}  ${problem.message}\n`);
  }
  if (hasErrors(problems)) failed = true;

  const counts = [
    `${suite.viewpoints.length} viewpoint(s)`,
    `${suite.factors.length} factor(s)`,
    `${suite.matrices.length} matrix/matrices`,
    `${suite.baselines.length} baseline(s)`,
    `${suite.cases.length} case(s)`,
    `${suite.scenarios.length} scenario(s)`,
  ].join(", ");
  process.stdout.write(`${root}: ${counts}\n`);
}

// Warnings are reported and do not fail: an unverified viewpoint is worth
// knowing about and blocks nothing, and a check that blocks on advice gets
// switched off.
process.exit(failed ? 1 : 0);
