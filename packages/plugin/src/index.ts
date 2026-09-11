/**
 * The contract between the hub and a target application.
 *
 * A plugin is configuration, not code: it declares what can be done against
 * one application and how to tell what state that application is in. The hub
 * itself knows only four ways to act — run a command, make a request, query a
 * database, drive a browser — and nothing about any particular system.
 */
export * from "./load.js";
export * from "./schema/index.js";
export * from "./template.js";
