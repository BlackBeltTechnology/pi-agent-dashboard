/**
 * Pure URL extraction from a session's ChatMessage list. Scans newest-first,
 * dedupes preserving first-seen order, caps at 50. Used by the composer's
 * `@`-autocomplete to surface URLs from the current session's chat history.
 * See change: render-file-previews.
 */
import type { ChatMessage } from "../chat/event-reducer.js";

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const MAX = 50;

/** Strip a trailing punctuation char that's unlikely to be part of the URL. */
const TRAILING_STRIP = /[)\].,;:!?'"`]+$/;

function clean(raw: string): string {
  return raw.replace(TRAILING_STRIP, "");
}

export function extractRecentUrls(messages: ChatMessage[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  // Iterate newest → oldest. `messages` is conventionally oldest-first;
  // reverse the index for the scan.
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const text = `${m.content ?? ""}\n${m.result ?? ""}`;
    if (!text) continue;
    const matches = text.match(URL_RE);
    if (!matches) continue;
    for (const raw of matches) {
      const url = clean(raw);
      if (!url) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      out.push(url);
      if (out.length >= MAX) return out;
    }
  }
  return out;
}
