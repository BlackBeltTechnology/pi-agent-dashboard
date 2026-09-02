/**
 * Pure, dependency-free role-schema core shared by every role read surface:
 * the bridge extension (`role-manager.ts`), the roles-plugin server route
 * (`/api/roles`), and the roles-plugin React client. One definition, so the
 * surfaces cannot drift about which roles the effective schema contains or the
 * value assigned to each.
 *
 * MUST NOT import `node:fs` (or any Node builtin): the client bundles this
 * module. Filesystem access lives per-side; only normalization + schema
 * computation live here.
 *
 * Contract (spec: dashboard-roles-ownership, agent-role-introspection):
 *   - `parseRoleConfig` is TOTAL: any input yields a well-formed RoleConfig,
 *     never throws. Structurally invalid preset entries are discarded;
 *     duplicate preset names collapse first-wins; non-string assigned values
 *     are dropped and survivors trimmed.
 *   - `overlayRoles` excludes every removed role name even when an assignment
 *     exists for it (an assignment never reintroduces a removed name).
 *   - `splitRef` never throws: `ref` is emitted verbatim by callers; only the
 *     derived parts are omitted when undeterminable.
 *
 * See change: add-roles-read-api.
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
   */
  roleNames?: string[];
  /**
   * Removal markers for DEFAULT role names the user removed, so the read-time
   * overlay does NOT re-inject them.
   */
  removedRoles?: string[];
}

// -- Default roles --------------------------------------------------------
//
// Dashboard-owned canonical role-name set. Roles ownership moved off pi-flows
// (change: adopt-model-resolve-handler-and-roles-ownership), so the dashboard
// owns the default names too. Mirrors pi-flows' `KNOWN_MODEL_ROLES`.
export const DEFAULT_ROLE_NAMES = [
  "planning",
  "coding",
  "compact",
  "fast",
  "vision",
  "research",
  // Auto session naming resolves `@naming` first and falls back to `@fast`, so
  // making naming work does not force a global downgrade of the shared `fast`
  // slot. See change: fix-auto-naming-reasoning-model (design D1).
  "naming",
] as const;

// -- Effective schema + overlay -------------------------------------------

/**
 * Effective role-name schema = (defaults ∪ added ∪ assigned) − removed,
 * order-stable (defaults first, then adds, then any assigned extras).
 * A removed default is NOT re-injected.
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
 * Read-time overlay keyed off the EFFECTIVE schema (defaults ∪ added − removed).
 * Every effective name appears (empty when unassigned); assigned values win.
 *
 * Correction over the historical `{ ...out, ...cfg.roles }` spread: a removed
 * role name is NEVER reintroduced by its assignment, because values are read
 * only for names already on the effective axis. Used by `roles:get-all`.
 */
export function overlayRoles(
  cfg: Pick<RoleConfig, "roles" | "roleNames" | "removedRoles">,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of effectiveRoleNames(cfg)) out[name] = cfg.roles[name] ?? "";
  return out;
}

// -- Ref / thinking-level split -------------------------------------------

export interface RefParts {
  /** The ref with any thinking-level suffix removed; omitted when empty. */
  model?: string;
  /** Segment preceding the first `/`; omitted when empty or when no `/`. */
  provider?: string;
  /** Segment following the LAST colon; omitted when empty. */
  thinkingLevel?: string;
}

/**
 * Decompose a stored role ref into its parts by splitting on the LAST colon
 * (model|thinkingLevel) and the FIRST slash (provider). Never throws — a
 * degenerate ref yields omitted parts rather than empty strings. Callers emit
 * the composite `ref` verbatim; this only derives the optional metadata.
 */
export function splitRef(ref: string): RefParts {
  const out: RefParts = {};
  let model = ref;
  const lastColon = ref.lastIndexOf(":");
  if (lastColon !== -1) {
    const level = ref.slice(lastColon + 1);
    if (level !== "") out.thinkingLevel = level;
    model = ref.slice(0, lastColon);
  }
  if (model !== "") out.model = model;
  const slash = ref.indexOf("/");
  if (slash > 0) out.provider = ref.slice(0, slash);
  return out;
}

/** Inverse of {@link splitRef}: rejoin a model with an optional thinking level. */
export function joinRef(model: string, level?: string): string {
  return level ? `${model}:${level}` : model;
}

// -- Total normalizer -----------------------------------------------------

/**
 * Normalize already-parsed configuration data into a well-formed RoleConfig.
 * TOTAL: any input — missing, empty, or structurally malformed — yields a
 * valid config rather than throwing. Performs NO filesystem access, so the
 * client can import it.
 *
 * Rules:
 *   - `roles`: keep entries whose value is a non-empty string, trimmed.
 *   - `rolePresets`: keep entries that are objects carrying a string `name`
 *     and an object `roles`; collapse duplicate names first-wins; drop the
 *     rest. Preset `roles` values are preserved verbatim (the projection
 *     guards non-string values) so `roles:get-all` stays byte-identical.
 *   - `activePreset`: a non-string coerces to null.
 */
export function parseRoleConfig(raw: unknown): RoleConfig {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    roles: parseRoles(obj.roles),
    rolePresets: parsePresets(obj.rolePresets),
    activePreset: typeof obj.activePreset === "string" ? obj.activePreset : null,
    roleNames: parseStringArray(obj.roleNames),
    removedRoles: parseStringArray(obj.removedRoles),
  };
}

/** Keep entries whose value is a non-empty string, trimmed. */
function parseRoles(raw: unknown): Record<string, string> {
  const roles: Record<string, string> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === "string" && v.trim() !== "") roles[k] = v.trim();
    }
  }
  return roles;
}

/** True when `entry` is a well-formed preset (object name + object roles). */
function isValidPreset(entry: unknown): entry is RolePreset {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
  const e = entry as Record<string, unknown>;
  return typeof e.name === "string" && !!e.roles && typeof e.roles === "object" && !Array.isArray(e.roles);
}

/** Keep well-formed preset entries; collapse duplicate names first-wins. */
function parsePresets(raw: unknown): RolePreset[] {
  if (!Array.isArray(raw)) return [];
  const out: RolePreset[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!isValidPreset(entry) || seen.has(entry.name)) continue;
    seen.add(entry.name);
    out.push({ name: entry.name, roles: entry.roles });
  }
  return out;
}

/** Filter an array to its string members; undefined when not an array. */
function parseStringArray(raw: unknown): string[] | undefined {
  return Array.isArray(raw) ? raw.filter((n): n is string => typeof n === "string") : undefined;
}
