/**
 * Renders a factor level's actual value as the text an input shows.
 *
 * A plain string is shown as-is (no quotes) since that is the common case;
 * anything else is JSON so numbers, booleans, and objects round-trip.
 */
export function stringifyLevelValue(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * Parses a factor level's input text back into the value an override would
 * write.
 *
 * Tries JSON first (so `123`, `true`, `null` become their real types), and
 * falls back to the raw text for anything that is not valid JSON (so typing
 * `email` does not require quoting it as `"email"`).
 */
export function parseLevelValue(text: string): unknown {
  if (text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
