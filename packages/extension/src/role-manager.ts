/**
 * Role Manager Extension (Dashboard)
 *
 * Owns the `roles`, `rolePresets`, and `activePreset` keys of
 * `~/.pi/agent/providers.json`. Registers the `roles:*` event handlers
 * that back the dashboard's Settings → Roles UI. Previously hosted in
 * pi-flows; ownership relocated here per OpenSpec change
 * `adopt-model-resolve-handler-and-roles-ownership` (capabilities
 * `dashboard-roles-ownership` and `dashboard-model-resolution`).
 *
 * Contract (spec: dashboard-roles-ownership):
 *   - Single source of truth on disk is `~/.pi/agent/providers.json`.
 *   - Reads tolerate missing file / malformed JSON (return empty config).
 *   - Writes use atomic tmp+rename, preserve unrelated keys (notably
 *     `providers` and pi-flows-owned `autonomousMode`).
 *   - Handlers re-read the file on every event so cross-session updates
 *     are visible without restart.
 *
 * Event API (dashboard-owned; the legacy `flow:` prefix was dropped — the
 * compatibility window expired and pi-flows has zero role code):
 *   roles:get-all
 *   roles:set
 *   roles:preset-load
 *   roles:preset-save
 *   roles:preset-delete
 * See change: add-agent-role-model-tools (design D11).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// -- Types ----------------------------------------------------------------

export interface RolePreset {
  name: string;
  roles: Record<string, string>;
}

export interface RoleConfig {
  roles: Record<string, string>;
  rolePresets: RolePreset[];
  activePreset: string | null;
  /**
   * User-added role names beyond DEFAULT_ROLE_NAMES. Persisted so an added
   * role surfaces as an empty slot everywhere even before a model is assigned.
   * See change: add-agent-role-model-tools (design D5, task 3.1).
   */
  roleNames?: string[];
  /**
   * Removal markers for DEFAULT role names the user removed, so the read-time
   * overlay does NOT re-inject them. User-added names need no marker (dropping
   * them from `roleNames` removes them from the effective schema).
   */
  removedRoles?: string[];
}

// -- Config path ----------------------------------------------------------

// Resolved lazily so HOME can be changed in tests.
function configPath(): string {
  return join(homedir(), ".pi", "agent", "providers.json");
}

// -- Config I/O -----------------------------------------------------------

function loadFullConfig(): Record<string, unknown> {
  const path = configPath();
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch (err: any) {
    console.warn(
      `[dashboard] providers.json parse failed at ${path}: ${err?.message ?? String(err)}`,
    );
    return {};
  }
}

/**
 * Read the role-relevant slice of `providers.json`. Tolerant of missing file
 * and malformed JSON; both produce `{ roles: {}, rolePresets: [], activePreset: null }`.
 *
 * Re-read on every call — handlers depend on this to see cross-session updates.
 */
export function loadRoleConfig(): RoleConfig {
  const raw = loadFullConfig();
  const roles: Record<string, string> = {};
  const rawRoles = raw.roles;
  if (rawRoles && typeof rawRoles === "object") {
    for (const [k, v] of Object.entries(rawRoles)) {
      if (typeof v === "string" && v.trim() !== "") roles[k] = v.trim();
    }
  }
  const rolePresets: RolePreset[] = Array.isArray(raw.rolePresets)
    ? (raw.rolePresets as RolePreset[])
    : [];
  const activePreset: string | null =
    typeof raw.activePreset === "string" ? (raw.activePreset as string) : null;
  const roleNames: string[] | undefined = Array.isArray(raw.roleNames)
    ? (raw.roleNames as unknown[]).filter((n): n is string => typeof n === "string")
    : undefined;
  const removedRoles: string[] | undefined = Array.isArray(raw.removedRoles)
    ? (raw.removedRoles as unknown[]).filter((n): n is string => typeof n === "string")
    : undefined;
  return { roles, rolePresets, activePreset, roleNames, removedRoles };
}

/**
 * Atomic write of the role slice of `providers.json`. Preserves every other
 * top-level key (notably `providers` — owned by provider-register.ts — and
 * `autonomousMode` — owned by pi-flows).
 */
export function saveRoleConfig(roleConfig: RoleConfig): void {
  const path = configPath();
  mkdirSync(join(homedir(), ".pi", "agent"), { recursive: true });
  const full = loadFullConfig();
  full.roles = roleConfig.roles;
  full.rolePresets = roleConfig.rolePresets;
  full.activePreset = roleConfig.activePreset;
  // Persist the editable schema markers when present; drop empty arrays so we
  // don't accrete empty keys on every write.
  if (roleConfig.roleNames && roleConfig.roleNames.length > 0) full.roleNames = roleConfig.roleNames;
  else delete full.roleNames;
  if (roleConfig.removedRoles && roleConfig.removedRoles.length > 0) full.removedRoles = roleConfig.removedRoles;
  else delete full.removedRoles;
  // Atomic tmp+rename so readers never observe a partial file.
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(full, null, 2));
  renameSync(tmp, path);
}

// -- Default roles --------------------------------------------------------
//
// Dashboard-owned canonical role-name set. Roles ownership moved off
// pi-flows (change: adopt-model-resolve-handler-and-roles-ownership), so the
// dashboard owns the default names too rather than depending on pi-flows
// being installed. Mirrors pi-flows' `KNOWN_MODEL_ROLES`.
//
// See change: roles-standalone-defaults-and-local-install-detection.
export const DEFAULT_ROLE_NAMES = [
  "planning",
  "coding",
  "compact",
  "fast",
  "vision",
  "research",
] as const;

/**
 * Overlay the default role names onto an assigned-roles map for DISPLAY.
 * Assigned values win; default names absent from `roles` appear with an
 * empty (unconfigured) value. Non-default assigned roles are preserved.
 *
 * Used by `roles:get-all` so the Roles table is never an empty dead
 * end on a fresh install. NOT used by `role:resolve-model` (which reports
 * the raw assigned map as `probe.available`).
 */
export function overlayDefaultRoles(
  roles: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of DEFAULT_ROLE_NAMES) out[name] = "";
  return { ...out, ...roles };
}

/**
 * Effective role-name schema = (defaults ∪ added ∪ assigned) − removed,
 * order-stable (defaults first, then adds, then any assigned extras).
 * A removed default is NOT re-injected. See change: add-agent-role-model-tools.
 */
export function effectiveRoleNames(
  cfg: Pick<RoleConfig, "roles" | "roleNames" | "removedRoles">,
): string[] {
  const removed = new Set(cfg.removedRoles ?? []);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const n of [...DEFAULT_ROLE_NAMES, ...(cfg.roleNames ?? []), ...Object.keys(cfg.roles)]) {
    if (removed.has(n) || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/**
 * Read-time overlay keyed off the EFFECTIVE schema (defaults ∪ added − removed)
 * instead of the hardcoded const. Every effective name appears (empty when
 * unassigned); assigned values win. Used by roles:get-all.
 */
export function overlayRoles(
  cfg: Pick<RoleConfig, "roles" | "roleNames" | "removedRoles">,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of effectiveRoleNames(cfg)) out[name] = "";
  return { ...out, ...cfg.roles };
}

/**
 * Register a role name in the editable schema. Clears any removal marker and
 * (for non-defaults) records it in `roleNames`. Mutates `cfg` in place; the
 * caller persists via saveRoleConfig. See change: add-agent-role-model-tools.
 */
export function addRoleName(cfg: RoleConfig, role: string): void {
  if (cfg.removedRoles) cfg.removedRoles = cfg.removedRoles.filter((r) => r !== role);
  const isDefault = (DEFAULT_ROLE_NAMES as readonly string[]).includes(role);
  if (!isDefault) {
    cfg.roleNames = cfg.roleNames ?? [];
    if (!cfg.roleNames.includes(role)) cfg.roleNames.push(role);
  }
}

/**
 * Purge a role from the schema, the active roles map, and EVERY preset, in a
 * single mutation. A removed DEFAULT gains a removal marker so the overlay
 * does not re-inject it. Mutates `cfg` in place; the caller persists atomically.
 * See change: add-agent-role-model-tools (design D6, task 3.3).
 */
export function removeRoleFromSchema(cfg: RoleConfig, role: string): void {
  delete cfg.roles[role];
  for (const p of cfg.rolePresets) delete p.roles[role];
  if (cfg.roleNames) cfg.roleNames = cfg.roleNames.filter((r) => r !== role);
  const isDefault = (DEFAULT_ROLE_NAMES as readonly string[]).includes(role);
  if (isDefault) {
    cfg.removedRoles = cfg.removedRoles ?? [];
    if (!cfg.removedRoles.includes(role)) cfg.removedRoles.push(role);
  }
}

// Persistence note (change: roles-standalone-defaults-and-local-install-detection):
// default role names are NOT auto-written to providers.json. The read-time
// overlay (`overlayDefaultRoles`) populates the Roles table without touching
// disk; a role reaches disk only when the user assigns a model via the
// existing `roles:set` handler. This avoids an uninvited write to the
// shared global providers.json on every session.

// -- In-memory cache ------------------------------------------------------
//
// Mirrors pi-flows' behaviour: a module-level snapshot of the current roles
// map populated at activate() and updated by `roles:set` /
// `roles:preset-load`. Used by `getModelRole(role)` for in-process callers
// (specifically `model:resolve` in provider-register.ts) that want to avoid
// a disk read in the hot path. The handlers themselves still re-read from
// disk per spec.

let currentRoles: Record<string, string> = {};

/**
 * Single role-slice accessor. Strips a leading `@`, re-reads disk (so callers
 * see cross-session edits without restart), and returns either the mapped
 * literal `"provider/modelId"` or a structured not-configured `reason`.
 *
 * The one source of truth for `@role` → literal resolution, consumed by
 * `model:resolve` (provider-register.ts), the deprecated `role:resolve-model`
 * alias, and the `list_roles`/`update_roles` tools — no fourth independent
 * reader. See change: add-agent-role-model-tools (design D10).
 */
export function lookupRole(ref: string): { literal?: string; reason?: string } {
  const roleName = ref.startsWith("@") ? ref.slice(1) : ref;
  if (!roleName) return { reason: "empty role name" };
  const cfg = loadRoleConfig();
  currentRoles = cfg.roles;
  const mapped = cfg.roles[roleName];
  if (typeof mapped === "string" && mapped.trim() !== "") {
    return { literal: mapped.trim() };
  }
  return { reason: `role '${roleName}' not configured yet` };
}

/** Look up the model literal assigned to `role`. Returns undefined if unset. */
export function getModelRole(role: string): string | undefined {
  return lookupRole(role).literal;
}

// -- Extension entry point ------------------------------------------------

/**
 * Register the five `roles:*` event handlers. No `flow:`-prefixed alias is
 * retained — roles are 100% dashboard-owned and pi-flows has no role code.
 * Writes are atomic tmp+rename so any concurrent writer leaves the file in a
 * single consistent state (last writer wins). See change:
 * add-agent-role-model-tools (design D11).
 */
export function activate(pi: ExtensionAPI): void {
  const initial = loadRoleConfig();
  currentRoles = initial.roles;

  // Resolve `@role` aliases for the subagents harness. pi-dashboard-subagents
  // (>=0.2.0) emits `role:resolve-model` with probe `{ ref, resolved?,
  // available? }` and reads back `probe.resolved` (a literal
  // "provider/modelId"). The bridge's own `model:resolve` handler
  // (provider-register.ts) uses a different probe shape, so the subagent
  // spawn path never reached it — `@role` model fields hard-failed. This
  // adapter maps the role name to its assigned model via providers.json#roles.
  // DEPRECATED → model:resolve. Kept ONE release as an alias for legacy
  // subagents-harness builds that read `probe.resolved` (a literal string)
  // rather than `probe.model`. Delegates its `@role` → literal lookup to the
  // shared lookupRole() accessor; preserves its probe.resolved/available/
  // reason contract. Removed at next major.
  // See change: add-agent-role-model-tools (design D9).
  pi.events.on("role:resolve-model", (probe: any) => {
    if (!probe || typeof probe.ref !== "string") return;
    const ref = probe.ref.trim();
    const roleName = ref.startsWith("@") ? ref.slice(1) : ref;
    if (!roleName) return;
    const cfg = loadRoleConfig();
    currentRoles = cfg.roles;
    probe.available = cfg.roles;
    const { literal, reason } = lookupRole(ref);
    if (literal) {
      probe.resolved = literal;
    } else {
      // Shadow-disabled: role exists by name (default-seeded) or is unknown,
      // but has no assigned model. Signal a structured "not configured yet"
      // reason so the subagents harness surfaces an actionable spawn-time
      // error instead of an opaque resolution failure.
      probe.reason = reason;
    }
  });

  pi.events.on("roles:get-all", (data: any) => {
    const cfg = loadRoleConfig();
    // Overlay the EFFECTIVE role-name schema (defaults ∪ added − removed) so
    // the Roles table is never empty and tracks user edits. Assigned values
    // win; unassigned effective names appear with an empty value.
    data.roles = overlayRoles(cfg);
    data.presets = cfg.rolePresets;
    data.activePreset = cfg.activePreset;
  });

  pi.events.on("roles:set", (data: any) => {
    const { role, modelId } = data ?? {};
    if (!role || !modelId) {
      data.success = false;
      return;
    }
    const cfg = loadRoleConfig();
    cfg.roles[role] = modelId;

    // If a preset is active, update its roles map in-place too.
    if (cfg.activePreset) {
      const preset = cfg.rolePresets.find((p) => p.name === cfg.activePreset);
      if (preset) preset.roles = { ...cfg.roles };
    }

    saveRoleConfig(cfg);
    currentRoles = cfg.roles;
    data.success = true;
  });

  pi.events.on("roles:preset-load", (data: any) => {
    const { name } = data ?? {};
    if (!name) {
      data.success = false;
      return;
    }
    const cfg = loadRoleConfig();
    const preset = cfg.rolePresets.find((p) => p.name === name);
    if (!preset) {
      data.success = false;
      return;
    }
    // Wholesale replacement (spec scenario "load replaces roles wholesale").
    cfg.roles = { ...preset.roles };
    cfg.activePreset = name;
    saveRoleConfig(cfg);
    currentRoles = cfg.roles;
    data.success = true;
  });

  pi.events.on("roles:preset-save", (data: any) => {
    const { name } = data ?? {};
    if (!name) {
      data.success = false;
      return;
    }
    const cfg = loadRoleConfig();
    const idx = cfg.rolePresets.findIndex((p) => p.name === name);
    const preset: RolePreset = { name, roles: { ...cfg.roles } };
    if (idx >= 0) cfg.rolePresets[idx] = preset;
    else cfg.rolePresets.push(preset);
    saveRoleConfig(cfg);
    data.success = true;
  });

  pi.events.on("roles:preset-delete", (data: any) => {
    const { name } = data ?? {};
    if (!name) {
      data.success = false;
      return;
    }
    const cfg = loadRoleConfig();
    const before = cfg.rolePresets.length;
    cfg.rolePresets = cfg.rolePresets.filter((p) => p.name !== name);
    if (cfg.rolePresets.length === before) {
      data.success = false;
      return;
    }
    if (cfg.activePreset === name) cfg.activePreset = null;
    saveRoleConfig(cfg);
    data.success = true;
  });
}
