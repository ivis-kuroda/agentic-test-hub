/**
 * The reviewer view: a static HTML page built from a suite, for the audience
 * that reads viewpoints and coverage matrices rather than test steps.
 *
 * Every function here is pure and synchronous — given a {@link Suite}, it
 * returns a string. Nothing reads a file or writes one; that is left to
 * whatever calls this from a CLI, a web handler, or a test.
 */
export * from "./escape.ts";
export * from "./reviewer-view.ts";
