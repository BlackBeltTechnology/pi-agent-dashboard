/**
 * Verb→tier resolution for the chat team-controls layer.
 *
 * The tier required by a verb is READ from the dashboard's shared effective
 * table (`GENERATED_TOOLS` re-exported from the mcp-server plugin's `./manifest`
 * entry), never re-declared here — so the chat surface and the MCP surface
 * cannot drift apart. A curated command allowlist narrows what chat may invoke
 * at all, and a non-configurable deny-list carves credential/state-minting
 * verbs out of `operate`.
 *
 * See change: add-chat-gateway-team-controls (D3).
 */
import { GENERATED_TOOLS } from "@blackbelt-technology/pi-dashboard-mcp-server-plugin/manifest";
import { type Tier, minTier, rank } from "@blackbelt-technology/pi-dashboard-shared/tiers.js";

/** Roles may never grant `operate` — see `authorize.ts` / `tier-config.ts`. */
export type RoleTier = "observe" | "control";

/**
 * Verbs that mint credentials or alter provider/package/tunnel state. Refused
 * regardless of tier or ceiling; NOT configurable, because the grant these
 * verbs hand out outlives the grantee's chat membership.
 */
export const NON_DELEGABLE: readonly string[] = [
  "mint_device_token",
  "set_providers",
  "install_package",
  "tunnel_connect",
];

/**
 * Curated allowlist of verbs the chat surface may invoke. A verb absent here is
 * refused even when the principal's tier would otherwise permit it — e.g. a
 * chat-driven `shutdown_server` would take the audit log and the disarm switch
 * down with it.
 */
export const CHAT_COMMAND_ALLOWLIST: readonly string[] = [
  "list_sessions",
  "send_prompt",
  "abort",
  "spawn_session",
  "resume_session",
  "prompt_response",
  "get_session_diff",
  "get_session_file",
  "get_transcript",
  "get_tool_result",
];

/** The effective per-verb tier table, read from the shared generated manifest. */
export const VERB_TIERS: ReadonlyMap<string, Tier> = new Map(
  GENERATED_TOOLS.map((t) => [t.name, t.tier] as const),
);

/** `undefined` means the verb has no row in the shared table — never infer one. */
export function tierOfVerb(
  verb: string,
  table: ReadonlyMap<string, Tier> = VERB_TIERS,
): Tier | undefined {
  return table.get(verb);
}

export function isNonDelegable(verb: string): boolean {
  return NON_DELEGABLE.includes(verb);
}

export function isAllowlistedCommand(
  verb: string,
  allowlist: readonly string[] = CHAT_COMMAND_ALLOWLIST,
): boolean {
  return allowlist.includes(verb);
}

/** The stronger of two tiers. */
export function maxTier(a: Tier, b: Tier): Tier {
  return rank(a) >= rank(b) ? a : b;
}

/** Clamp a resolved tier to the configured ceiling (never raises it). */
export function clampTier(tier: Tier, ceiling: Tier): Tier {
  return minTier(tier, ceiling);
}
