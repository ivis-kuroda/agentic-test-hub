/**
 * Escapes text for placement inside HTML content.
 *
 * Specification content is authored by whoever writes the YAML, not by the
 * hub, so it is untrusted the same way any user input is: a rationale or a
 * summary containing `<` must not become markup.
 *
 * @param text - Raw text.
 * @returns Text safe to place between tags.
 */
export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Escapes text for placement inside an HTML attribute value.
 *
 * Distinct from {@link escapeHtml} only in name: the same substitutions are
 * safe in both positions, but calling the right-sounding function at each
 * call site is what makes a missed case easy to spot in review.
 */
export const escapeAttr = escapeHtml;
