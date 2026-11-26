/**
 * Canonical hooks hash (trust identity). SHA-256 over canonical JSON of events (sorted), command text,
 * command order and effective timeoutMs. Key order, comments and whitespace in the source YAML do not matter.
 * See change: add-agent-teams-templates-hooks.
 */
import { createHash } from "node:crypto";
import type { TeamHooks } from "../shared/types.js";

/**
 * `defaultTimeoutMs` is the effective default used for commands without their own `timeoutMs`
 * (callers pass `effectiveHookTimeoutMs(config())`), so a config change alters the hash.
 */
export function hashHooks(hooks: TeamHooks, defaultTimeoutMs = 0): string {
  const rec = hooks as Record<string, Array<{ command: string; timeoutMs?: number }> | undefined>;
  const canonical = Object.keys(rec)
    .filter((event) => (rec[event]?.length ?? 0) > 0)
    .sort()
    .map((event) => [event, (rec[event] ?? []).map((h) => [h.command, h.timeoutMs ?? defaultTimeoutMs])]);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
