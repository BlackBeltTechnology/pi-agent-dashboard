/**
 * Brief policy (D4): when is the agent's context message the brief, when do we
 * generate, when is generation disabled. Pure.
 * A provided brief is the agent's raw message: it is capped, then redacted,
 * because it is persisted to `questions/<id>.json` and shown in the UI.
 * See change: add-pending-question-stack.
 */
import { redactSecrets } from "@blackbelt-technology/pi-dashboard-shared/redaction.js";

/** Cap applied before redaction so regex work on an agent-supplied message is bounded. */
export const PROVIDED_BRIEF_MAX_CHARS = 32_768;

export type BriefPolicyDecision =
  | { kind: "provided"; brief: string }
  | { kind: "generate" }
  | { kind: "disabled" };

export interface BriefPolicyInput {
  /** `prompt.metadata.message` — the ask's context message (any type). */
  message: unknown;
  autoBrief: boolean;
  minBriefChars: number;
}

/** The message as usable brief text, or undefined (absent / non-string / blank). */
export function contextMessageOf(message: unknown): string | undefined {
  return typeof message === "string" && message.trim() !== "" ? message : undefined;
}

export function decideBriefPolicy(input: BriefPolicyInput): BriefPolicyDecision {
  const message = contextMessageOf(input.message);
  if (message !== undefined && message.length >= input.minBriefChars) return { kind: "provided", brief: redactSecrets(message.slice(0, PROVIDED_BRIEF_MAX_CHARS)) };
  return input.autoBrief ? { kind: "generate" } : { kind: "disabled" };
}
