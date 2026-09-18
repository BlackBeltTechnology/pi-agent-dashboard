/**
 * L3 tool-call policy — the PURE decision engine the in-session guard runs.
 *
 * Deny-first: a tool is denied unless the policy explicitly allows it or
 * explicitly routes it to interactive approval. There is no "unknown tool"
 * allow path — an unrecognised tool name is denied, which is what makes the
 * default fail closed rather than fail open.
 *
 * This is deliberately NOT gamalan's prompt-injection guard: that shape can be
 * talked out of a decision by model output. Enforcement here is a hard
 * `{ block: true }` returned from pi's `tool_call` event, which pi documents as
 * a permission gate.
 *
 * Pure + side-effect free so the whole decision table is unit-testable.
 * See change: add-chat-gateway.
 */

type ToolDefaultAction = "deny" | "approve";

export interface ToolPolicy {
  /** Tools permitted without any prompt. */
  allow?: string[];
  /** Tools that require interactive approval before running. */
  approval?: string[];
  /**
   * What to do with a tool named by neither list. Defaults to `"deny"` — the
   * deny-first posture. Only an operator may widen this.
   */
  defaultAction?: ToolDefaultAction;
}

export type ToolDecision =
  | { action: "allow" }
  | { action: "deny"; reason: string }
  | { action: "approve"; reason: string };

function has(list: string[] | undefined, name: string): boolean {
  return Array.isArray(list) && list.includes(name);
}

/**
 * Decide one tool call. Precedence: explicit allow > explicit approval >
 * default. An entry in BOTH lists is allowed — the operator's explicit
 * allow is the narrower, more deliberate statement.
 */
export function decideToolCall(toolName: string, policy: ToolPolicy): ToolDecision {
  if (typeof toolName !== "string" || toolName === "") {
    return { action: "deny", reason: "unnamed_tool" };
  }
  if (has(policy.allow, toolName)) return { action: "allow" };
  if (has(policy.approval, toolName)) {
    return { action: "approve", reason: "requires_approval" };
  }
  return (policy.defaultAction ?? "deny") === "approve"
    ? { action: "approve", reason: "default_requires_approval" }
    : { action: "deny", reason: "denied_by_default" };
}
