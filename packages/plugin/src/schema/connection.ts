import { z } from "zod";

/**
 * A named endpoint an operation runs against.
 *
 * Connections are declared once and referenced by name so that credentials
 * and addresses live in one place, and so that pointing a suite at a
 * different environment is a change to the manifest rather than to every
 * operation in it.
 */
export const Connection = z.discriminatedUnion("kind", [
  /** A relational database reachable by connection string. */
  z.object({
    kind: z.literal("postgres"),
    /** Connection string, usually interpolated from the environment. */
    url: z.string().min(1),
  }),

  /**
   * An HTTP service.
   *
   * Search clusters are reached this way rather than through a client
   * library on purpose: Elasticsearch and OpenSearch clients reject servers
   * outside a narrow version range, and a suite that has to match its target's
   * exact major version is a suite that stops running after an upgrade. The
   * REST surface is stable where the clients are not.
   */
  z.object({
    kind: z.literal("http"),
    baseUrl: z.string().min(1),
    headers: z.record(z.string(), z.string()).default({}),
  }),

  /** A browser session against an application's base address. */
  z.object({
    kind: z.literal("browser"),
    baseUrl: z.string().min(1),
  }),
]);
/** A named endpoint an operation runs against. */
export type Connection = z.infer<typeof Connection>;
