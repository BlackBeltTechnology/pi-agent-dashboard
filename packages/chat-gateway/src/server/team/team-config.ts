/**
 * Team-controls configuration: normalization + semantic validation.
 *
 * Config is operator-authored and reaches us as untrusted JSON, so this is
 * TOTAL: it never throws, and an invalid value is REJECTED with a specific
 * reason rather than silently coerced. The one semantic rule that matters most
 * is that a platform ROLE can never grant `operate` — role membership is
 * controlled by whoever holds Manage Roles, who is not necessarily the
 * operator — so `operate` requires an explicit identifier.
 *
 * See change: add-chat-gateway-team-controls (D6).
 */
import { isTier, type Tier } from "@blackbelt-technology/pi-dashboard-shared/tiers.js";
import type { RoleTier } from "./tier.js";

export const MIRROR_LEVELS = ["names-only", "names-and-diffs", "full-transcript"] as const;
export type MirrorLevel = (typeof MIRROR_LEVELS)[number];

export const DEFAULT_MIRROR_LEVEL: MirrorLevel = "names-only";
export const DEFAULT_CEILING: Tier = "observe";
export const DEFAULT_AUDIT_RETENTION = 10_000;
/** A hard upper bound so a typo cannot ask for an unbounded in-memory log. */
export const MAX_AUDIT_RETENTION = 1_000_000;

export interface ValidatedBinding {
  principals: Record<string, Tier>;
  roles: Record<string, RoleTier>;
  mirrorLevel: MirrorLevel;
  ceiling: Tier;
}

export interface ValidatedTeamConfig {
  ceiling: Tier;
  disarmed: boolean;
  auditRetention: number;
  /** Keyed by workspace id — the binding unit. */
  bindings: Record<string, ValidatedBinding>;
}

export interface ValidationOk {
  ok: true;
  value: ValidatedTeamConfig;
}

export interface ValidationErr {
  ok: false;
  /** Stable machine reason. */
  reason: string;
  /** Dotted path to the offending value. */
  path: string;
}

export type ValidationResult = ValidationOk | ValidationErr;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isMirrorLevel(v: unknown): v is MirrorLevel {
  return typeof v === "string" && (MIRROR_LEVELS as readonly string[]).includes(v);
}

const isRoleTier = (v: unknown): v is RoleTier => v === "observe" || v === "control";

/**
 * Validate + normalize the team-controls config. Absent/partial config yields
 * fail-closed defaults (ceiling `observe`, no bindings, retention 10,000).
 */
export function validateTeamControls(raw: unknown): ValidationResult {
  const src = isObject(raw) ? raw : {};

  const ceiling: Tier = isTier(src.ceiling) ? src.ceiling : DEFAULT_CEILING;

  const disarmed = src.disarmed === true;

  let auditRetention = DEFAULT_AUDIT_RETENTION;
  if (src.auditRetention !== undefined) {
    const n = src.auditRetention;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > MAX_AUDIT_RETENTION) {
      return { ok: false, reason: "invalid_audit_retention", path: "teamControls.auditRetention" };
    }
    auditRetention = n;
  }

  const bindings: Record<string, ValidatedBinding> = {};
  const rawBindings = isObject(src.bindings) ? src.bindings : {};
  for (const [workspaceId, rawBinding] of Object.entries(rawBindings)) {
    const base = `teamControls.bindings.${workspaceId}`;
    const b = isObject(rawBinding) ? rawBinding : {};

    const principals: Record<string, Tier> = {};
    if (b.principals !== undefined) {
      if (!isObject(b.principals)) {
        return { ok: false, reason: "invalid_principals", path: `${base}.principals` };
      }
      for (const [id, tier] of Object.entries(b.principals)) {
        if (!isTier(tier)) {
          return { ok: false, reason: "invalid_tier", path: `${base}.principals.${id}` };
        }
        principals[id] = tier;
      }
    }

    const roles: Record<string, RoleTier> = {};
    if (b.roles !== undefined) {
      if (!isObject(b.roles)) {
        return { ok: false, reason: "invalid_roles", path: `${base}.roles` };
      }
      for (const [roleId, roleTier] of Object.entries(b.roles)) {
        if (roleTier === "operate") {
          // The load-bearing rejection: a role must never grant operate.
          return {
            ok: false,
            reason: "role_cannot_map_to_operate_requires_explicit_identifier",
            path: `${base}.roles.${roleId}`,
          };
        }
        if (!isRoleTier(roleTier)) {
          return { ok: false, reason: "invalid_role_tier", path: `${base}.roles.${roleId}` };
        }
        roles[roleId] = roleTier;
      }
    }

    const mirrorLevel: MirrorLevel = isMirrorLevel(b.mirrorLevel) ? b.mirrorLevel : DEFAULT_MIRROR_LEVEL;
    const bindingCeiling: Tier = isTier(b.ceiling) ? b.ceiling : ceiling;

    bindings[workspaceId] = { principals, roles, mirrorLevel, ceiling: bindingCeiling };
  }

  return { ok: true, value: { ceiling, disarmed, auditRetention, bindings } };
}
