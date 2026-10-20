/**
 * Supervised-mode policy builder + tool classification sets.
 *
 * Supervised = allow-first: only the configured set is gated
 * (`{ approval: tools, defaultAction: "allow" }`). Matching is
 * case-insensitive (`"Agent"` is capitalised at the fan-out gate) and is done
 * HERE — both sides are lower-cased before the shared exact-match
 * `decideToolCall`, so chat-gateway decisions never change.
 *
 * `readFamily` / `wrapperTools` are classification inputs for the drift test
 * and the unclassified-tool log line only; they never exempt a configured tool.
 * See change: add-supervised-tool-approval (design D2).
 */
import { decideToolCall, type ToolDecision, type ToolPolicy } from "./policy.js";

/** Default risky set (`supervisedMode.tools` when unset). */
export const DEFAULT_SUPERVISED_TOOLS: readonly string[] = ["bash", "powershell", "write", "edit", "Agent"];

/** Pinned pi built-ins that only read. */
export const readFamily: readonly string[] = ["read", "grep", "find", "ls"];

/** Tools the default set gates (the "risky" classification). */
export const riskySet: readonly string[] = [...DEFAULT_SUPERVISED_TOOLS];

/** Wrapper tools whose nested calls traverse `tool_call` individually. */
export const wrapperTools: readonly string[] = ["codemode", "tool_search"];

/** Build the supervised policy for a configured tool set (default set when omitted). */
export function buildSupervisedPolicy(tools: readonly string[] = DEFAULT_SUPERVISED_TOOLS): ToolPolicy {
  return { approval: [...tools], defaultAction: "allow" };
}

function fold(list: string[] | undefined): string[] | undefined {
  return Array.isArray(list) ? list.map((t) => (typeof t === "string" ? t.toLowerCase() : t)) : list;
}

/** Case-insensitive decision: lower-cases the name and the policy lists, then defers to `decideToolCall`. */
export function decideSupervisedTool(toolName: string, policy: ToolPolicy): ToolDecision {
  const name = typeof toolName === "string" ? toolName.toLowerCase() : toolName;
  return decideToolCall(name, { ...policy, allow: fold(policy.allow), approval: fold(policy.approval) });
}
