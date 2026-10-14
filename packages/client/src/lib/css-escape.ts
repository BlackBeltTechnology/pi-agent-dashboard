/**
 * `CSS.escape` with a correct fallback for environments that lack it (jsdom).
 * The fallback is specified for QUOTED ATTRIBUTE VALUES only
 * (`[data-x="${cssEscape(v)}"]`): it hex-escapes every code point outside
 * `[A-Za-z0-9_-]` and does not apply the identifier leading-digit rule.
 */
export function cssEscape(s: string): string {
  if (typeof window !== "undefined" && typeof window.CSS?.escape === "function") {
    return window.CSS.escape(s);
  }
  let out = "";
  for (const ch of s) {
    out += /[A-Za-z0-9_-]/.test(ch) ? ch : `\\${ch.codePointAt(0)!.toString(16)} `;
  }
  return out;
}
