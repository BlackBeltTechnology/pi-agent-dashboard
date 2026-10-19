/**
 * Registry of certificate-source types + the common-field validation of
 * `tls.sources` entries. Per-type fields are delegated to the type's
 * `validate()`. Used by the `PUT /api/config` route (400s) and by reconcile
 * (reports `invalid-source` instead of throwing).
 *
 * See change: add-tailscale-cert-tls (design D3, D7).
 */
import type { TlsSourceEntry } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { CertSourceType } from "./types.js";

const TAILSCALE_SOURCE_ID = "tailscale";
const SOURCE_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

const types = new Map<string, CertSourceType>();

export function registerCertSourceType(t: CertSourceType): void {
  types.set(t.type, t);
}

export function getCertSourceType(type: string): CertSourceType | undefined {
  return types.get(type);
}

/** Test seam: forget a registered type. */
export function unregisterCertSourceType(type: string): void {
  types.delete(type);
}

/** The resolved id of an entry (explicit, else the type's default), or `null` when neither exists. */
export function resolveSourceId(entry: TlsSourceEntry): string | null {
  if (typeof entry.id === "string" && entry.id) return entry.id;
  return getCertSourceType(String(entry.type))?.defaultId ?? null;
}

/**
 * Validate ONE entry's own fields (type registered, id pattern, reserved id,
 * per-type check). Returns the 400 message or `null`. Uniqueness across the
 * list is `validateTlsSources`' job.
 */
export function validateSourceEntry(entry: unknown, index: number): string | null {
  const at = `tls.sources[${index}]`;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return `${at} must be an object`;
  const e = entry as TlsSourceEntry;
  if (typeof e.type !== "string" || !e.type) return `${at}.type is required`;
  const t = getCertSourceType(e.type);
  if (!t) return `${at}.type "${e.type}" is not a known certificate source type`;
  const id = resolveSourceId(e);
  if (id === null) return `${at}.id is required for type "${e.type}"`;
  if (!SOURCE_ID_RE.test(id)) {
    return `${at}.id "${id}" must be lowercase letters, digits and hyphens (max 32, starting with a letter or digit)`;
  }
  if (id === TAILSCALE_SOURCE_ID && e.type !== "tailscale") {
    return `${at}.id "${TAILSCALE_SOURCE_ID}" is reserved for the tailscale source`;
  }
  return t.validate(e);
}

/** Validate a whole `tls.sources` array: per-entry rules, then id uniqueness. First error wins. */
export function validateTlsSources(sources: unknown): string | null {
  if (!Array.isArray(sources)) return "tls.sources must be an array";
  const seen = new Set<string>();
  for (let i = 0; i < sources.length; i++) {
    const err = validateSourceEntry(sources[i], i);
    if (err) return err;
    const id = resolveSourceId(sources[i] as TlsSourceEntry) as string;
    if (seen.has(id)) return `tls.sources[${i}].id "${id}" is a duplicate source id`;
    seen.add(id);
  }
  return null;
}
