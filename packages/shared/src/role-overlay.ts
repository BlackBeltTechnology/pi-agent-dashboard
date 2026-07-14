/**
 * Shared role-overlay primitives — the single source of truth for the
 * canonical default role names and the display-time default overlay.
 *
 * These are the drift-prone pieces of the role framework: the constant list of
 * built-in role names and the overlay that turns an assigned-roles map into a
 * display map where every default name appears (empty when unassigned). Both
 * the extension's `role-manager.ts` (the `roles:*` handlers) and the server's
 * read-only `GET /api/roles` route import them here so there is exactly one
 * copy of `DEFAULT_ROLE_NAMES`, closing the default-role-name drift class.
 *
 * The fs reader (`loadRoleConfig`) and the mutating helpers stay in the
 * extension — `shared` carries no `homedir`/fs config-path responsibilities.
 */

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
 * Used by `roles:get-all` and the read-only `GET /api/roles` route so the
 * Roles table is never an empty dead end on a fresh install. NOT used by
 * `role:resolve-model` (which reports the raw assigned map as `probe.available`).
 */
export function overlayDefaultRoles(
  roles: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of DEFAULT_ROLE_NAMES) out[name] = "";
  return { ...out, ...roles };
}
