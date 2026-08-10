import type { ChatMessage } from "../chat/event-reducer.js";
import { parseSkillBlock } from "@blackbelt-technology/pi-dashboard-shared/skill-block-parser.js";

/**
 * Extract the user's previously sent prompts from a session's chat message
 * list for use as an input-history source (bash-style ArrowUp recall).
 *
 * Rules:
 * - Keep only entries with `role === "user"`.
 * - For skill invocations (messages whose content is a `<skill>...</skill>`
 *   envelope, recognised either via the `msg.skill` stamp or by re-parsing
 *   the raw content), substitute the condensed slash form
 *   (`/skill:name args`). This means ArrowUp recalls the user-typed slash
 *   command, not the multi-thousand-character expanded body.
 *   See change: render-skill-invocations-collapsibly.
 * - Drop empty / whitespace-only contents.
 * - Collapse *consecutive* duplicate entries (after condensation) to a
 *   single entry. Preserve non-consecutive duplicates — they represent
 *   legitimate re-sends after intervening work.
 * - Return newest-first: index `0` is the most recently sent prompt.
 *
 * The input `messages` array is assumed to be in chronological order
 * (oldest → newest), matching `SessionState.messages`.
 */
export function extractUserPromptHistory(messages: ChatMessage[]): string[] {
  const chronological: string[] = [];
  for (const msg of messages) {
    if (msg.role !== "user") continue;
    const content = msg.content;
    if (typeof content !== "string") continue;
    if (content.trim() === "") continue;
    // Prefer the stamped skill metadata; fall back to ad-hoc parsing for
    // messages that pre-date the stamping change. condensed === content for
    // plain user messages.
    const condensed = msg.skill?.condensed ?? parseSkillBlock(content)?.condensed ?? content;
    if (chronological.length > 0 && chronological[chronological.length - 1] === condensed) {
      continue;
    }
    chronological.push(condensed);
  }
  // Reverse so index 0 is newest.
  return chronological.reverse();
}
