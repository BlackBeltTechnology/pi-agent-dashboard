/**
 * Declared folder project identity: `<cwd>/.pi/dashboard/project.json`
 * `{ "schemaVersion": 1, "id"?: string, "type"?: string }`.
 *
 * The pure parse lives here so the server's reader and the scaffold skill's
 * writer validate with ONE definition. Filesystem hardening (symlink refusal,
 * bounded read) belongs to the callers.
 *
 * See change: add-project-scoped-apps.
 */
import { PROJECT_NAME_RE } from "./project-markers.js";

/** A file larger than this is ignored whole. */
export const IDENTITY_MAX_BYTES = 64 * 1024;

export interface DeclaredIdentity {
  id?: string;
  type?: string;
}

/**
 * Parse an identity file body. `null` ⇒ ignore the whole file (invalid JSON,
 * not a plain object, `schemaVersion` absent or ≠ 1). `id` and `type` validate
 * independently; an invalid field is treated as absent, unknown fields ignored.
 */
export function parseDeclaration(text: string): DeclaredIdentity | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  if (!Object.hasOwn(obj, "schemaVersion") || obj.schemaVersion !== 1) return null;
  const out: DeclaredIdentity = {};
  for (const key of ["id", "type"] as const) {
    const v = Object.hasOwn(obj, key) ? obj[key] : undefined;
    if (typeof v === "string" && PROJECT_NAME_RE.test(v)) out[key] = v;
  }
  return out;
}
