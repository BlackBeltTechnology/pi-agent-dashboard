/**
 * Shared tool-call policy — the PURE decision engine behind every in-session
 * `tool_call` gate (chat-gateway guard, supervised-mode bridge gate).
 *
 * Deny-first by default: a tool is denied unless the policy explicitly allows
 * it or routes it to interactive approval. `defaultAction: "allow"` is an
 * explicit, surface-opt-in widening (supervised mode only; the chat-gateway
 * parses its policy with `allowedDefaults: ["deny","approve"]`).
 *
 * Exact-match only: this engine never case-folds (case-insensitive matching is
 * the supervised policy builder's job, `supervised-policy.ts`).
 * Imports no dashboard protocol types.
 *
 * Moved from `packages/chat-gateway/src/guard/policy.ts`.
 * See change: add-chat-gateway, add-supervised-tool-approval.
 */

export type ToolDefaultAction = "deny" | "approve" | "allow";

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
  switch (policy.defaultAction ?? "deny") {
    case "allow":
      return { action: "allow" };
    case "approve":
      return { action: "approve", reason: "default_requires_approval" };
    default:
      return { action: "deny", reason: "denied_by_default" };
  }
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((v): v is string => typeof v === "string");
}

/**
 * Validate an untrusted (already JSON-parsed) policy. Pure; fails CLOSED:
 * a non-object is deny-all, a `defaultAction` outside `allowedDefaults`
 * (including a raw `"allow"` for a surface that does not permit it) resolves
 * to `"deny"`, malformed lists are dropped. An absent `defaultAction` stays
 * absent (the engine resolves it to `"deny"`).
 */
export function parseToolPolicy(
  raw: unknown,
  opts: { allowedDefaults: readonly ToolDefaultAction[] },
): ToolPolicy {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { defaultAction: "deny" };
  }
  const r = raw as Record<string, unknown>;
  const allow = stringList(r.allow);
  const approval = stringList(r.approval);
  const policy: ToolPolicy = {};
  if (allow) policy.allow = allow;
  if (approval) policy.approval = approval;
  if (r.defaultAction !== undefined) {
    const d = r.defaultAction;
    policy.defaultAction =
      (d === "deny" || d === "approve" || d === "allow") && opts.allowedDefaults.includes(d) ? d : "deny";
  }
  return policy;
}
