/**
 * Shared role-name validation — the single trust boundary for a custom role
 * name, enforced identically on the client (inline ✓/✗ hint) and the bridge
 * (defense-in-depth reject before writing global providers.json).
 *
 * Rules (design D4):
 *   - non-empty after trim;
 *   - matches `^[A-Za-z0-9][A-Za-z0-9_-]*$` — starts alnum; letters/digits/
 *     `-`/`_` only; NO `/`, whitespace, `@`, `.`;
 *   - not already in `existing` (built-in or custom; case-sensitive to match
 *     the on-disk keys).
 *
 * `/` is reserved because role values are `provider/id`; `@` is reserved
 * because refs are `@role`.
 *
 * See change: add-custom-roles-ui.
 */

const ROLE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export interface RoleNameValidation {
  ok: boolean;
  reason?: string;
}

export function isValidRoleName(name: string, existing: string[]): RoleNameValidation {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (trimmed === "") return { ok: false, reason: "Name cannot be empty" };
  if (!ROLE_NAME_RE.test(trimmed)) {
    return {
      ok: false,
      reason: "Use letters, digits, - or _ only; must start with a letter or digit",
    };
  }
  if (existing.includes(trimmed)) {
    return { ok: false, reason: `Role "${trimmed}" already exists` };
  }
  return { ok: true };
}
