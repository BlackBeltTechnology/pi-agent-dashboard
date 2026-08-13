/**
 * Self-target refusal guard (spec Req 6, design.md Decision 4).
 *
 * A session driving *itself* through the MCP endpoint is an unbounded loop, and
 * an aggravated one: `sendToSession` routes `/`-prefixed text to extension-
 * command dispatch, so the loop drives commands rather than merely chat.
 *
 * The guard is only meaningful because the caller's session is resolved from a
 * server-side token record (`tokens.ts`), never from a client claim. A
 * device-token caller — Claude Desktop, Cursor, a phone — has no originating
 * session and is structurally outside the guard (G4).
 *
 * SCOPE LIMIT, deliberate and tested (G6): this catches **direct** self-
 * targeting only. An indirect loop, where A drives B and B drives A, is
 * permitted. Detecting it needs call-graph state, which a stateless endpoint
 * does not have, and a depth/force-kill mechanism this change explicitly
 * excludes (Decision 13). The permission is asserted in the test suite so that
 * narrowing it later must be a deliberate spec edit.
 */
import type { McpCaller } from "./tokens.js";

/**
 * Tools that take a target session and can therefore self-target. Kept
 * explicit so adding a session-targeting tool without considering the guard is
 * a visible omission rather than a silent gap.
 */
export const SESSION_TARGETING_TOOLS = ["send_prompt", "abort"] as const;

export type SessionTargetingTool = (typeof SESSION_TARGETING_TOOLS)[number];

export type SelfTargetVerdict =
  | { allowed: true }
  | {
      allowed: false;
      reason: "self-target";
      /** Resolved server-side, never client-supplied. */
      callerSessionId: string;
      /** As presented by the caller, before normalisation. */
      targetSessionId: string;
      tool: string;
    };

/**
 * Normalise a session identifier for equality only.
 *
 * G7 requires that a target differing from the caller's own id by nothing but
 * case, surrounding whitespace, or surrounding quotes is still refused —
 * otherwise the guard is bypassable by a trivial mutation of the argument.
 *
 * Kept deliberately narrow: it trims, strips ONE matched pair of surrounding
 * quotes, and lowercases. It does not strip inner characters or unmatched
 * quotes, because over-normalisation would collapse genuinely distinct ids and
 * refuse legitimate cross-session control (G3).
 */
function normaliseSessionId(value: string): string {
  let out = value.trim();
  const first = out.at(0);
  const last = out.at(-1);
  if (out.length >= 2 && (first === '"' || first === "'") && last === first) {
    out = out.slice(1, -1).trim();
  }
  return out.toLowerCase();
}

/**
 * Decide whether `caller` may drive `targetSessionId` via `tool`.
 *
 * Note there is no prompt-text parameter. G2's slash-command case is handled by
 * construction: the verdict cannot depend on a payload, so no crafted text can
 * route around it, and the refusal necessarily happens *before* extension-
 * command dispatch is reached.
 *
 * A malformed (non-string) target is **permitted** here on purpose. That is an
 * invalid-params problem belonging to argument validation; refusing it as a
 * self-target would mask the real error and contradict E26.
 */
export function evaluateSelfTarget(
  caller: McpCaller,
  targetSessionId: string,
  tool: string,
): SelfTargetVerdict {
  if (caller.kind !== "session") return { allowed: true };
  if (typeof targetSessionId !== "string") return { allowed: true };

  if (normaliseSessionId(caller.sessionId) !== normaliseSessionId(targetSessionId)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: "self-target",
    callerSessionId: caller.sessionId,
    targetSessionId,
    tool,
  };
}
