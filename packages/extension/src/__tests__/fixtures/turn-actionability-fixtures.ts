/**
 * Shared assistant-turn fixtures for the empty-actionable-turn guard.
 *
 * `THINKING_ONLY_STOP` is derived from the captured live transcript
 * `…/2026-07-12T01-56-02…_019f5409….jsonl` (line 7): a `google-vertex/
 * gemini-2.5-pro` turn whose content is a single thinking block, `usage.output`
 * entirely reasoning, zero visible text, no tool call, `stopReason = "stop"`.
 *
 * See change: fix-gemini-subagent-silent-tool-schema-failure.
 */

import type { ClassifiableTurn } from "../../turn-actionability.js";

/** Captured defect: thinking-only completion, clean `stop`, no output. */
export const THINKING_ONLY_STOP: ClassifiableTurn = {
  role: "assistant",
  stopReason: "stop",
  content: [{ type: "thinking", thinking: "**Exploring Doubtful Decisions**\nI'm processing…" }],
  error: {},
};

/** Wholly empty completion — no parts at all, clean `stop`. */
export const EMPTY_STOP: ClassifiableTurn = {
  role: "assistant",
  stopReason: "stop",
  content: [],
};

/** Normal turn: thinking + a visible text part, `stop`. */
export const NORMAL_TEXT_STOP: ClassifiableTurn = {
  role: "assistant",
  stopReason: "stop",
  content: [
    { type: "thinking", thinking: "**Analyzing…**" },
    { type: "text", text: "This skill is for stress-testing non-trivial decisions." },
  ],
};

/** Tool-call turn: thinking + a toolCall part, `toolUse`. */
export const TOOL_CALL_TURN: ClassifiableTurn = {
  role: "assistant",
  stopReason: "toolUse",
  content: [
    { type: "thinking", thinking: "**Testing…**" },
    { type: "toolCall", id: "read_1", name: "read", arguments: { path: "/x" } },
  ],
};

/** Truncated turn: hit the token budget mid-reasoning, no visible output. */
export const LENGTH_TRUNCATED: ClassifiableTurn = {
  role: "assistant",
  stopReason: "length",
  content: [{ type: "thinking", thinking: "**Long reasoning that ran out of budget…**" }],
};

/** Errored turn: terminal provider/adapter error. */
export const ERRORED_TURN: ClassifiableTurn = {
  role: "assistant",
  stopReason: "error",
  content: [],
  errorMessage: "provider returned error: 503 service unavailable",
};

/** Whitespace-only text — treated as no visible text (empty-actionable). */
export const WHITESPACE_TEXT_STOP: ClassifiableTurn = {
  role: "assistant",
  stopReason: "stop",
  content: [{ type: "text", text: "   \n\t  " }],
};
