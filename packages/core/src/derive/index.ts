/**
 * Facts computed from the specification rather than stated in it.
 *
 * Everything here exists so that one fact lives in one place. Matrix
 * placement, coverage and isolation are all consequences of what the cases
 * already say, so recording them separately would create a second copy to
 * maintain — the duplication this system exists to remove.
 */
export * from './path.js';
export * from './equal.js';
export * from './isolation.js';
export * from './placement.js';
export * from './coverage.js';
export * from './verdict.js';
