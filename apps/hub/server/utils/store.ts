import { SpecStore } from "@agentic-test-hub/store";

/**
 * The one {@link SpecStore} this server process uses.
 *
 * A single instance matters as much here as inside the store itself: two
 * instances pointed at the same directory would each run their own write
 * queue, and the serialisation the store promises would not hold across them.
 */
let instance: SpecStore | undefined;

/** Returns the process-wide store, creating it from `specsRoot` on first use. */
export function useStore(): SpecStore {
  if (instance === undefined) {
    const config = useRuntimeConfig();
    instance = new SpecStore(resolveSpecsRoot(config));
  }
  return instance;
}
