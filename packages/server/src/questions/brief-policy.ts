/**
 * Brief policy (D4): when is the agent's context message the brief, when do we
 * generate, when is generation disabled. Pure.
 * See change: add-pending-question-stack.
 */
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
  if (message !== undefined && message.length >= input.minBriefChars) return { kind: "provided", brief: message };
  return input.autoBrief ? { kind: "generate" } : { kind: "disabled" };
}
