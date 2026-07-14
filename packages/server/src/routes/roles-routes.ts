/**
 * Roles REST API route: session-less, READ-ONLY `GET /api/roles`.
 *
 * Exposes the role slice of `~/.pi/agent/providers.json` (`roles` /
 * `rolePresets` / `activePreset`) so a browser client with no active pi session
 * can see which model each role uses. The assigned map is overlaid with the
 * canonical `DEFAULT_ROLE_NAMES` (assigned wins; unconfigured defaults appear
 * as empty strings), and `builtinRoleNames` carries that default set for parity
 * with the in-session `roles:get-all` payload.
 *
 * READ-ONLY: this route never creates, mutates, or writes the file, and this
 * module registers NO `PUT`/mutating `/api/roles` route. The file read mirrors
 * the self-contained, tolerant read `provider-routes.ts` uses; the overlay
 * primitives are the single-source `role-overlay` module in `shared`.
 */
import type { FastifyInstance } from "fastify";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_ROLE_NAMES,
  overlayDefaultRoles,
  type RolePreset,
} from "@blackbelt-technology/pi-dashboard-shared/role-overlay.js";
import type { NetworkGuard } from "./route-deps.js";

// Resolved lazily so HOME can be changed in tests.
function configPath(): string {
  return join(homedir(), ".pi", "agent", "providers.json");
}

interface RoleSlice {
  roles: Record<string, string>;
  rolePresets: RolePreset[];
  activePreset: string | null;
}

/**
 * Read the role slice of providers.json. Tolerant of a missing file and
 * malformed JSON (both yield an empty slice). Never creates or writes the file.
 */
function readRoleSlice(): RoleSlice {
  const path = configPath();
  if (!existsSync(path)) return { roles: {}, rolePresets: [], activePreset: null };
  let raw: Record<string, unknown>;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    raw = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return { roles: {}, rolePresets: [], activePreset: null };
  }
  const roles: Record<string, string> = {};
  if (raw.roles && typeof raw.roles === "object") {
    for (const [k, v] of Object.entries(raw.roles as Record<string, unknown>)) {
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

export function registerRolesRoutes(
  fastify: FastifyInstance,
  deps: { networkGuard: NetworkGuard },
): void {
  const { networkGuard } = deps;
  fastify.get("/api/roles", { preHandler: networkGuard }, async () => {
    const slice = readRoleSlice();
    return {
      roles: overlayDefaultRoles(slice.roles),
      rolePresets: slice.rolePresets,
      activePreset: slice.activePreset,
      builtinRoleNames: [...DEFAULT_ROLE_NAMES],
    };
  });
}
