/**
 * The specification data model.
 *
 * Entities divide into three groups:
 *
 * - **Review**: {@link Viewpoint}, {@link Factor}, {@link Matrix} — what the
 *   suite claims and how much of the condition space it covers.
 * - **Execution**: {@link Baseline}, {@link TestCase}, {@link Scenario} —
 *   what is actually run.
 * - **Shared**: identifiers, targets, expectations.
 *
 * Both groups derive from the same files; neither is generated from the
 * other.
 */
export * from './id.js';
export * from './common.js';
export * from './expectation.js';
export * from './evidence.js';
export * from './policy.js';
export * from './viewpoint.js';
export * from './factor.js';
export * from './matrix.js';
export * from './baseline.js';
export * from './case.js';
export * from './scenario.js';
