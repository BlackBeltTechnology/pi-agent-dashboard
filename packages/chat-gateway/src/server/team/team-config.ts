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

/**
 * The fail-closed default: ceiling `observe` (no one may act), no bindings (no
 * channel is provisioned), retention at the default. Used when operator config
 * is rejected, so a bad config degrades to "nobody can do anything" rather than
 * to an unconfigured-but-live layer.
 */
export const FAIL_CLOSED_TEAM_CONFIG: ValidatedTeamConfig = {
  ceiling: DEFAULT_CEILING,
  disarmed: false,
  auditRetention: DEFAULT_AUDIT_RETENTION,
  bindings: {},
};

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
  /**
   * Guild a workspace channel is provisioned in. Absent ⇒ provisioning cannot
   * run, so a configured binding is reported as a failure rather than silently
   * producing no channel.
   */
  guildId?: string;
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

/** Generic form of the same result, for the per-section helpers below. */
type Checked<T> = { ok: true; value: T } | ValidationErr;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Keys that must never be used as map keys.
 *
 * `obj["__proto__"] = value` does not add a key — it reassigns the object's
 * PROTOTYPE (silently for objects), so a config keyed `__proto__` would vanish
 * from `Object.keys` while polluting unrelated lookups. These come from JSON, so
 * an own `__proto__` property is reachable.
 */
const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Cardinality caps. A bounded config cannot be used to allocate or serialize
 * without limit from one persisted payload.
 */
export const MAX_BINDINGS = 200;
export const MAX_MAPPINGS_PER_BINDING = 500;

/** Validate an optional identifier→tier map. */
function parsePrincipals(raw: unknown, base: string): Checked<Record<string, Tier>> {
  const out: Record<string, Tier> = {};
  if (raw === undefined) return { ok: true, value: out };
  if (!isObject(raw)) return { ok: false, reason: "invalid_principals", path: `${base}.principals` };
  const entries = Object.entries(raw);
  if (entries.length > MAX_MAPPINGS_PER_BINDING) {
    return { ok: false, reason: "too_many_principals", path: `${base}.principals` };
  }
  for (const [id, tier] of entries) {
    if (RESERVED_KEYS.has(id)) {
      return { ok: false, reason: "reserved_principal_id", path: `${base}.principals.${id}` };
    }
    if (!isTier(tier)) {
      return { ok: false, reason: "invalid_tier", path: `${base}.principals.${id}` };
    }
    out[id] = tier;
  }
  return { ok: true, value: out };
}

/** Validate an optional role→tier map. A role may NEVER grant `operate`. */
function parseRoles(raw: unknown, base: string): Checked<Record<string, RoleTier>> {
  const out: Record<string, RoleTier> = {};
  if (raw === undefined) return { ok: true, value: out };
  if (!isObject(raw)) return { ok: false, reason: "invalid_roles", path: `${base}.roles` };
  const entries = Object.entries(raw);
  if (entries.length > MAX_MAPPINGS_PER_BINDING) {
    return { ok: false, reason: "too_many_roles", path: `${base}.roles` };
  }
  for (const [roleId, roleTier] of entries) {
    if (RESERVED_KEYS.has(roleId)) {
      return { ok: false, reason: "reserved_role_id", path: `${base}.roles.${roleId}` };
    }
    if (roleTier === "operate") {
      // The load-bearing rejection: role membership is held by whoever has
      // Manage Roles, who is not necessarily the operator.
      return {
        ok: false,
        reason: "role_cannot_map_to_operate_requires_explicit_identifier",
        path: `${base}.roles.${roleId}`,
      };
    }
    if (!isRoleTier(roleTier)) {
      return { ok: false, reason: "invalid_role_tier", path: `${base}.roles.${roleId}` };
    }
    out[roleId] = roleTier;
  }
  return { ok: true, value: out };
}

/** Validate the optional audit-retention bound. */
function parseAuditRetention(raw: unknown): Checked<number> {
  if (raw === undefined) return { ok: true, value: DEFAULT_AUDIT_RETENTION };
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > MAX_AUDIT_RETENTION) {
    return { ok: false, reason: "invalid_audit_retention", path: "teamControls.auditRetention" };
  }
  return { ok: true, value: raw };
}

/** Validate the optional provisioning guild id. */
function parseGuildId(raw: unknown): Checked<string | undefined> {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  if (typeof raw !== "string" || raw.trim() === "") {
    return { ok: false, reason: "invalid_guild_id", path: "teamControls.guildId" };
  }
  return { ok: true, value: raw.trim() };
}

/** Validate one workspace's binding, defaulting the per-binding ceiling. */
function parseBinding(rawBinding: unknown, ceiling: Tier, base: string): Checked<ValidatedBinding> {
  const b = isObject(rawBinding) ? rawBinding : {};
  const principals = parsePrincipals(b.principals, base);
  if (!principals.ok) return principals;
  const roles = parseRoles(b.roles, base);
  if (!roles.ok) return roles;
  return {
    ok: true,
    value: {
      principals: principals.value,
      roles: roles.value,
      mirrorLevel: isMirrorLevel(b.mirrorLevel) ? b.mirrorLevel : DEFAULT_MIRROR_LEVEL,
      ceiling: isTier(b.ceiling) ? b.ceiling : ceiling,
    },
  };
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

  const retention = parseAuditRetention(src.auditRetention);
  if (!retention.ok) return retention;

  const guildId = parseGuildId(src.guildId);
  if (!guildId.ok) return guildId;

  const bindings: Record<string, ValidatedBinding> = {};
  const rawBindings = isObject(src.bindings) ? src.bindings : {};
  const bindingEntries = Object.entries(rawBindings);
  if (bindingEntries.length > MAX_BINDINGS) {
    return { ok: false, reason: "too_many_bindings", path: "teamControls.bindings" };
  }
  for (const [workspaceId, rawBinding] of bindingEntries) {
    if (RESERVED_KEYS.has(workspaceId)) {
      return {
        ok: false,
        reason: "reserved_workspace_id",
        path: `teamControls.bindings.${workspaceId}`,
      };
    }
    const parsed = parseBinding(rawBinding, ceiling, `teamControls.bindings.${workspaceId}`);
    if (!parsed.ok) return parsed;
    bindings[workspaceId] = parsed.value;
  }

  return {
    ok: true,
    value: {
      ceiling,
      disarmed,
      auditRetention: retention.value,
      bindings,
      ...(guildId.value ? { guildId: guildId.value } : {}),
    },
  };
}

/**
 * The DASHBOARD WRITE path: same validation, but an absent or malformed payload
 * is REFUSED rather than read as "reset everything to defaults".
 *
 * Startup legitimately sees `undefined` (nothing configured yet) and must
 * default. A LIVE write sees it only from a client bug or a crafted frame — and
 * applying that as defaults would silently wipe every binding and deactivate
 * every provisioned channel. Fail-closed is correct there; SILENT is not.
 */
export function validateTeamControlsWrite(raw: unknown): ValidationResult {
  if (!isObject(raw)) {
    return { ok: false, reason: "team_controls_payload_required", path: "teamControls" };
  }
  return validateTeamControls(raw);
}
