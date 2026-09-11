/**
 * The specification directory: reading it, and writing to it safely.
 *
 * Files are authoritative. Everything here exists to keep them that way —
 * deterministic output so a save produces a reviewable diff, hash checks so
 * concurrent edits are reported rather than lost, and one writer so a working
 * tree that git also operates on stays intact.
 */
export * from "./layout.ts";
export * from "./load.ts";
export * from "./order.ts";
export * from "./serialize.ts";
export * from "./store.ts";
