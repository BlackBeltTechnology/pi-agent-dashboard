/**
 * The single authorization chokepoint for the team-controls layer.
 *
 * Layered UNDER chat-gateway's L1 allowlist and L2 bind authority: it can only
 * refuse, never admit a principal L1 rejected nor permit a binding L2 refused.
 * It returns a discriminated `Grant | Refusal` — a refusal always carries the
 * specific reason that caused it, so the audit log records *why*, never an
 * undifferentiated absence of permission.
 *
 * Pure over (author, binding, verb, targetCwd, disarmed) — the verb→tier table
 * and command allowlist are injectable purely to make the table-driven tests
 * possible; production uses the shared `GENERATED_TOOLS` table.
 *
 * See change: add-chat-gateway-team-controls (D2).
 */
import type { Tier } from "@blackbelt-technology/pi-dashboard-shared/tiers.js";
import {
  CHAT_COMMAND_ALLOWLIST,
  clampTier,
  isAllowlistedCommand,
  isNonDelegable,
  maxTier,
  type RoleTier,
  tierOfVerb,
  VERB_TIERS,
} from "./tier.js";
import { isWithinWorkspace } from "./workspace.js";

/** Every refusal identifies its cause. */
export type RefusalReason =
  | "non_human_author"
  | "unbound_channel"
  | "no_principal_mapping"
  | "scope_violation"
  | "disarmed"
  | "non_delegable_verb"
  | "verb_not_allowlisted"
  | "verb_unknown_tier"
  | "insufficient_tier";

export interface Author {
  /** Stable platform identifier (Discord snowflake). */
  id: string;
  isBot?: boolean;
  isWebhook?: boolean;
  /** Platform role ids held by the author. */
  roleIds?: string[];
}

/** The per-binding policy snapshot the chokepoint resolves against. */
export interface BindingContext {
  workspaceId: string;
  folders: string[];
  principals: Record<string, Tier>;
  roles: Record<string, RoleTier>;
  /** Maximum tier; defaults to `observe`. */
  ceiling?: Tier;
}

export interface AuthorizeInput {
  author: Author;
  channelId: string;
  /** Absent when the channel is not bound to a workspace. */
  binding?: BindingContext;
  verb: string;
  /** The session cwd a verb would affect; enables scope containment. */
  targetCwd?: string;
  disarmed?: boolean;
  /** Injectable for tests; production defaults to the shared table/allowlist. */
  verbTiers?: ReadonlyMap<string, Tier>;
  allowlist?: readonly string[];
}

export interface Grant {
  kind: "grant";
  tier: Tier;
  verb: string;
  binding: BindingContext;
}

interface Refusal {
  kind: "refusal";
  reason: RefusalReason;
  verb: string;
}

export type AuthorizeResult = Grant | Refusal;

function resolveTier(author: Author, binding: BindingContext): Tier | undefined {
  let tier: Tier | undefined;
  const byIdentifier = binding.principals[author.id];
  if (byIdentifier) tier = byIdentifier;

  for (const roleId of author.roleIds ?? []) {
    const roleTier = binding.roles[roleId];
    if (!roleTier) continue;
    tier = tier === undefined ? roleTier : maxTier(tier, roleTier);
  }
  return tier;
}

const refuse = (reason: RefusalReason, verb: string): Refusal => ({ kind: "refusal", reason, verb });

export function authorize(input: AuthorizeInput): AuthorizeResult {
  const { author, binding, verb } = input;

  // 1. Bot/webhook authors are refused FIRST, ahead of every other check — a
  //    webhook has no human behind it to hold accountable, and a bot whose id
  //    matches a configured principal must still never act.
  if (author.isBot === true || author.isWebhook === true) {
    return refuse("non_human_author", verb);
  }

  // 2. An unbound channel grants nothing.
  if (!binding) return refuse("unbound_channel", verb);

  // 3. Resolve the tier: identifier first, roles second, highest wins. No
  //    matching entry -> refusal (fail closed; no global fallback).
  const rawTier = resolveTier(author, binding);
  if (rawTier === undefined) return refuse("no_principal_mapping", verb);

  // 4. Clamp to the ceiling. Default ceiling is `observe` — an unconfigured
  //    layer grants nobody anything.
  const tier = clampTier(rawTier, binding.ceiling ?? "observe");

  // 5. Scope containment INSIDE the chokepoint: a request may only affect a
  //    session whose cwd lies within this binding's workspace.
  if (input.targetCwd !== undefined && !isWithinWorkspace(input.targetCwd, binding.folders)) {
    return refuse("scope_violation", verb);
  }

  // 6. Disarm halts every action-bearing request (mirroring is handled apart).
  if (input.disarmed === true) return refuse("disarmed", verb);

  // 7. Non-delegable verbs are refused regardless of tier or ceiling.
  if (isNonDelegable(verb)) return refuse("non_delegable_verb", verb);

  // 8. A verb outside the curated allowlist is refused even at sufficient tier.
  const allowlist = input.allowlist ?? CHAT_COMMAND_ALLOWLIST;
  if (!isAllowlistedCommand(verb, allowlist)) return refuse("verb_not_allowlisted", verb);

  // 9. A verb with no row in the shared table has NO inferred tier.
  const required = tierOfVerb(verb, input.verbTiers ?? VERB_TIERS);
  if (required === undefined) return refuse("verb_unknown_tier", verb);

  // 10. Sufficient tier for the requested verb (`max(tier, required) === tier`).
  if (maxTier(tier, required) !== tier) return refuse("insufficient_tier", verb);

  return { kind: "grant", tier, verb, binding };
}
