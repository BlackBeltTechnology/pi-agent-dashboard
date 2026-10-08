/**
 * Text helpers for a subagent's streaming tail (a bounded SUFFIX of a block
 * that is still being written). Partial markdown renders badly, so previews
 * strip simple markers while keeping line breaks.
 *
 * See change: stream-subagent-reasoning-and-stable-card.
 */

/** Strip heading/bullet/code/bold markers; keep line breaks. */
export function plainTail(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^(\s*)[-*]\s+/gm, "$1• ")
    .replace(/`/g, "")
    .replace(/\*\*/g, "");
}

/**
 * The sentence currently being written, flattened to one line (card ticker).
 * When the last sentence just ended, returns that sentence.
 */
export function currentSentence(text: string): string {
  const flat = plainTail(text).replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const parts = flat.split(/(?<=[.!?:])\s+/);
  return parts[parts.length - 1] ?? flat;
}
