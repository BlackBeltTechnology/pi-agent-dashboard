/**
 * sudo's prompt text is agent-controlled (`sudo -p`), so the bridge shows it as
 * inert, labelled text: control / bidi / zero-width characters become visible
 * escapes (nothing is stripped) and the result is middle-truncated to 500
 * displayed characters so a trailing `SUDO_ASKPASS=` part is never hidden.
 *
 * See change: add-sudo-credential-prompt (D4, G1, G11).
 */

import { SUDO_CREDENTIAL_PROMPT_TEXT_MAX } from "@blackbelt-technology/pi-dashboard-shared/sudo-credential.js";

const NAMED: Record<string, string> = { "\n": "\\n", "\r": "\\r", "\t": "\\t" };

/** Format / bidi / zero-width code points that render invisibly or reorder text. */
function isInvisibleFormat(cp: number): boolean {
  return (
    cp === 0x00ad ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0x2028 && cp <= 0x202e) ||
    (cp >= 0x2060 && cp <= 0x2064) ||
    (cp >= 0x2066 && cp <= 0x2069) ||
    cp === 0xfeff
  );
}

const hex = (n: number, width: number): string => n.toString(16).padStart(width, "0");

/** Replace control and invisible characters with visible escapes (`\x1b`, `\u202E`). */
export function escapePromptText(raw: string): string {
  let out = "";
  for (const ch of raw) {
    const cp = ch.codePointAt(0) as number;
    if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) out += NAMED[ch] ?? `\\x${hex(cp, 2)}`;
    else if (isInvisibleFormat(cp)) out += `\\u${hex(cp, 4).toUpperCase()}`;
    else out += ch;
  }
  return out;
}

export interface PromptDisplay {
  prompt: string;
  /** Characters removed from the middle; absent when the text was not truncated. */
  promptTruncated?: number;
}

/** Escape, then keep the first 250 + last 250 characters of anything over the 500 cap. */
export function buildPromptDisplay(raw: string): PromptDisplay {
  const chars = Array.from(escapePromptText(raw));
  const max = SUDO_CREDENTIAL_PROMPT_TEXT_MAX;
  if (chars.length <= max) return { prompt: chars.join("") };
  const keep = max / 2;
  const removed = chars.length - max;
  const prompt = `${chars.slice(0, keep).join("")}…[${removed} more chars]…${chars.slice(chars.length - keep).join("")}`;
  return { prompt, promptTruncated: removed };
}
