/**
 * Role Manager Extension (Dashboard)
 *
 * Owns the `roles`, `rolePresets`, and `activePreset` keys of
 * `~/.pi/agent/providers.json`. Registers the `flow:role-*` event handlers
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
 * Event API (relocated bit-for-bit from pi-flows; names preserved with
 * `flow:` prefix for one release):
 *   flow:role-get-all
 *   flow:role-set
 *   flow:role-preset-load
 *   flow:role-preset-save
 *   flow:role-preset-delete
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
  return { roles, rolePresets, activePreset };
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
  // Atomic tmp+rename so readers never observe a partial file.
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(full, null, 2));
  renameSync(tmp, path);
}

// -- In-memory cache ------------------------------------------------------
//
// Mirrors pi-flows' behaviour: a module-level snapshot of the current roles
// map populated at activate() and updated by `flow:role-set` /
// `flow:role-preset-load`. Used by `getModelRole(role)` for in-process callers
// (specifically `model:resolve` in provider-register.ts) that want to avoid
// a disk read in the hot path. The handlers themselves still re-read from
// disk per spec.

let currentRoles: Record<string, string> = {};

/** Look up the model literal assigned to `role`. Returns undefined if unset. */
export function getModelRole(role: string): string | undefined {
  // Re-read from disk so callers see cross-session updates without restart.
  // Cheap: typically one small JSON file. Tests rely on this.
  const cfg = loadRoleConfig();
  currentRoles = cfg.roles;
  return currentRoles[role];
}

// -- Extension entry point ------------------------------------------------

/**
 * Register the five `flow:role-*` event handlers. Idempotency note: during
 * the partial-upgrade window where pi-flows still hosts its own listeners,
 * both packages run the same handler logic. Per design Decision 8 this is
 * safe because writes are atomic tmp+rename — concurrent writers leave the
 * file in a single consistent state (last writer wins).
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
  pi.events.on("role:resolve-model", (probe: any) => {
    if (!probe || typeof probe.ref !== "string") return;
    const ref = probe.ref.trim();
    const roleName = ref.startsWith("@") ? ref.slice(1) : ref;
    if (!roleName) return;
    const cfg = loadRoleConfig();
    currentRoles = cfg.roles;
    probe.available = cfg.roles;
    const mapped = cfg.roles[roleName];
    if (typeof mapped === "string" && mapped.trim() !== "") {
      probe.resolved = mapped.trim();
    }
  });

  pi.events.on("flow:role-get-all", (data: any) => {
    const cfg = loadRoleConfig();
    data.roles = { ...cfg.roles };
    data.presets = cfg.rolePresets;
    data.activePreset = cfg.activePreset;
  });

  pi.events.on("flow:role-set", (data: any) => {
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

  pi.events.on("flow:role-preset-load", (data: any) => {
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

  pi.events.on("flow:role-preset-save", (data: any) => {
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

  pi.events.on("flow:role-preset-delete", (data: any) => {
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
