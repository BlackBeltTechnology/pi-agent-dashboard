/**
 * REST route for the roles-plugin, mounted on the shared Fastify instance.
 *
 *   GET /api/roles → { object: "list", data: RoleGroup[] }
 *
 * A read-only role catalogue: the effective role schema (built-in ∪ user-added
 * ∪ preset-referenced, minus removal markers) projected onto every role group
 * (the live map plus each stored preset). Mirrors `GET /api/models`' envelope
 * and auth posture — registered WITHOUT a `networkGuard` preHandler, subject
 * only to the dashboard's own auth gate (no `pi-proxy-...` key, no live pi
 * session).
 *
 * Reads `~/.pi/agent/providers.json` directly (same path posture as
 * `provider-routes.ts`) and normalizes through the shared, total
 * `parseRoleConfig`. Never 503s, never returns an empty `data`: a missing,
 * unreadable, or malformed config degrades to "no assignments" and the overlay
 * still yields the built-in names with `ref: null`.
 *
 * Credential safety: rows are built field-by-field from the role/preset maps;
 * the parsed config is never serialized or spread into the response, so a
 * credential-bearing sibling key of the same file cannot reach the payload.
 *
 * See change: add-roles-read-api.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_ROLE_NAMES,
  effectiveRoleNames,
  parseRoleConfig,
  type RoleConfig,
  splitRef,
} from "@blackbelt-technology/pi-dashboard-shared/role-schema.js";
import type { FastifyInstance } from "fastify";

export interface RolesRouteDeps {
  /**
   * Absolute path to the roles-bearing config file. Injectable for tests;
   * defaults to `~/.pi/agent/providers.json`.
   */
  configPath?: () => string;
}

const BUILTIN = new Set<string>(DEFAULT_ROLE_NAMES);

function defaultConfigPath(): string {
  return join(homedir(), ".pi", "agent", "providers.json");
}

/**
 * Read + normalize the role config. Every failure mode — missing file,
 * unparseable JSON, permission denied, path-is-a-directory, or removal between
 * the existence check and the read — degrades to an empty (normalized) config
 * rather than propagating. `parseRoleConfig` is total, so the overlay always
 * yields the built-in names.
 */
function readRoleConfig(path: string): RoleConfig {
  try {
    if (!existsSync(path)) return parseRoleConfig({});
    const text = readFileSync(path, "utf-8");
    return parseRoleConfig(JSON.parse(text));
  } catch {
    // ENOENT (TOCTOU), EACCES, EISDIR, or a JSON syntax error all collapse to
    // "no assignments" — the endpoint is always answerable.
    return parseRoleConfig({});
  }
}

interface RoleRow {
  role: string;
  ref: string | null;
  assigned: boolean;
  builtin: boolean;
  model?: string;
  provider?: string;
  thinkingLevel?: string;
}

interface RoleGroup {
  preset: string | null;
  active: boolean;
  roles: RoleRow[];
}

/**
 * Canonical role-name axis shared by every group: the effective schema (in its
 * canonical order — defaults, then user-added, then any remaining assigned
 * names) followed by preset-only names in first-referencing-preset order, with
 * removal markers excluded throughout.
 */
function buildAxis(cfg: RoleConfig): string[] {
  const removed = new Set(cfg.removedRoles ?? []);
  const axis = effectiveRoleNames(cfg);
  const seen = new Set(axis);
  for (const preset of cfg.rolePresets) {
    for (const name of Object.keys(preset.roles)) {
      if (removed.has(name) || seen.has(name)) continue;
      seen.add(name);
      axis.push(name);
    }
  }
  return axis;
}

/** Build one row for `role` from an assigned-roles map (live or a preset). */
function toRow(role: string, roles: Record<string, string>): RoleRow {
  const raw = roles[role];
  const ref = typeof raw === "string" && raw.trim() !== "" ? raw : null;
  if (ref === null) {
    return { role, ref: null, assigned: false, builtin: BUILTIN.has(role) };
  }
  const { model, provider, thinkingLevel } = splitRef(ref);
  return {
    role,
    ref,
    assigned: true,
    builtin: BUILTIN.has(role),
    ...(model !== undefined ? { model } : {}),
    ...(provider !== undefined ? { provider } : {}),
    ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
  };
}

/** Project every group (live + presets) onto the shared axis. */
function buildGroups(cfg: RoleConfig, axis: string[]): RoleGroup[] {
  // Dedupe preset names first-wins (parseRoleConfig already did, but keep the
  // active-resolution logic explicit and self-contained).
  const activeName = cfg.activePreset;
  const activeResolvable = activeName != null && cfg.rolePresets.some((p) => p.name === activeName);

  const groups: RoleGroup[] = [];
  groups.push({
    preset: null,
    // Live group is active unless a stored active preset actually resolves.
    active: !activeResolvable,
    roles: axis.map((role) => toRow(role, cfg.roles)),
  });
  for (const preset of cfg.rolePresets) {
    groups.push({
      preset: preset.name,
      active: activeResolvable && preset.name === activeName,
      roles: axis.map((role) => toRow(role, preset.roles)),
    });
  }
  return groups;
}

export function mountRolesRoutes(fastify: FastifyInstance, deps: RolesRouteDeps = {}): void {
  const resolvePath = deps.configPath ?? defaultConfigPath;
  fastify.get("/api/roles", async () => {
    const cfg = readRoleConfig(resolvePath());
    const axis = buildAxis(cfg);
    return { object: "list", data: buildGroups(cfg, axis) };
  });
}
