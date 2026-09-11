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
export * from "./id.ts";
export * from "./common.ts";
export * from "./expectation.ts";
export * from "./evidence.ts";
export * from "./policy.ts";
export * from "./viewpoint.ts";
export * from "./factor.ts";
export * from "./matrix.ts";
export * from "./baseline.ts";
export * from "./case.ts";
export * from "./scenario.ts";
