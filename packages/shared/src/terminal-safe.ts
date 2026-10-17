/**
 * Untrusted-string hygiene shared by the server (knock requester names) and the
 * CLI print boundary (`pi-dashboard pair list`).
 * See change: fix-pairing-approval-credential (D8).
 */

/**
 * Characters stripped from an untrusted name: control + format (bidi overrides,
 * zero-width), surrogates, private-use, line/paragraph separators, and the
 * blank-rendering Hangul fillers — all could fake a layout or an invisible name.
 * Defined ONCE; `pairing.ts` and the CLI both import it.
 */
export const INVISIBLE_OR_SEPARATOR = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}\u115F\u1160\u3164\uFFA0]/gu;

/**
 * Remove {@link INVISIBLE_OR_SEPARATOR} characters, then cap at `maxChars` Unicode
 * code points (never splitting a surrogate pair). An over-long value becomes
 * `maxChars - 1` code points plus `…`, so the ellipsis counts inside the cap.
 */
export function terminalSafe(value: string, maxChars: number): string {
  const cps = Array.from(value.replace(INVISIBLE_OR_SEPARATOR, ""));
  if (cps.length <= maxChars) return cps.join("");
  return `${cps.slice(0, Math.max(0, maxChars - 1)).join("")}…`;
}
