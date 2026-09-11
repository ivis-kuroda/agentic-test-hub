/**
 * Replaces a value repeated immediately after itself with a marker.
 *
 * Hand-written specifications abbreviate a repeated value as "same as
 * above" — a device that reads fine and breaks the moment a row is
 * reordered, because the abbreviation depends on position. Storing that
 * abbreviation would reintroduce exactly the fragility a structured source
 * exists to remove.
 *
 * So the source never abbreviates anything; every row is complete. This
 * function produces the abbreviation only at render time, for the one view
 * — the delivery document — where the convention is expected. It has
 * nothing to do with what is stored.
 *
 * @param values - Values in row order.
 * @param marker - Text to substitute for a repeat.
 * @returns A same-length array with immediate repeats replaced.
 */
export function collapseRepeats(values: readonly string[], marker: string): string[] {
  return values.map((value, index) => {
    // An empty value collapsing into the marker would read as "same as
    // above" for a cell that was never filled in — a claim the row is not
    // making. Only a genuine, non-empty repeat is worth abbreviating.
    if (value === "" || index === 0) return value;
    return values[index - 1] === value ? marker : value;
  });
}
