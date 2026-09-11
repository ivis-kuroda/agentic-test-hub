/**
 * Running operations against a target, and preparing the state they need.
 *
 * Every executor takes its means of doing work as a parameter — how to run a
 * command, how to make a request, how to query a database. That keeps drivers
 * out of this package, lets the hub's own tests run without any
 * infrastructure, and makes a new kind of target an adapter rather than a
 * change here.
 */
export * from "./assert.ts";
export * from "./executor/http.ts";
export * from "./executor/registry.ts";
export * from "./executor/shell.ts";
export * from "./executor/sql.ts";
export * from "./executor/types.ts";
export * from "./state.ts";
