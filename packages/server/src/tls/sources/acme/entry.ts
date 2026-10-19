/**
 * Pure helpers for an `acme` entry of `tls.sources[]`: normalization, validation,
 * directory canonicalization / classification and the account-key hash.
 * One `normalizeAcmeEntry` serves `validate()`, `create()` and the per-entry
 * route (design D5) so all three see the same shape.
 *
 * See change: add-acme-dns01-certs (design D4, D5, D8).
 */
import { createHash } from "node:crypto";

const LETSENCRYPT_STAGING_URL = "https://acme-staging-v02.api.letsencrypt.org/directory";
const LETSENCRYPT_PRODUCTION_URL = "https://acme-v02.api.letsencrypt.org/directory";
const MAX_ACME_DOMAINS = 20;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ZONE_ID_RE = /^[0-9a-f]{32}$/i;

/** Lowercase, strip ONE trailing dot. Non-strings pass through (validation rejects them). */
function normalizeName(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const s = v.trim().toLowerCase();
  return s.endsWith(".") ? s.slice(0, -1) : s;
}

/** A plain hostname: ≤ 253 octets, every label LDH, no leading/trailing hyphen, no `_`, not an IPv4 literal (all-numeric last label). */
function isValidHostname(h: string): boolean {
  if (h.length === 0 || h.length > 253) return false;
  const labels = h.split(".");
  if (/^\d+$/.test(labels[labels.length - 1])) return false;
  return labels.every((l) => LABEL_RE.test(l));
}

/** A name or a single-label wildcard (`*.` + hostname). */
function isValidAcmeDomain(d: string): boolean {
  if (d.startsWith("*.")) return isValidHostname(d.slice(2));
  return isValidHostname(d);
}

export type DirectoryClass = "staging" | "production" | "custom";

/** Canonical directory URL, or `null` when not an acceptable `https://` URL. Keywords map to the Let's Encrypt URLs. */
export function canonicalDirectoryUrl(directory: string): string | null {
  if (directory === "staging") return LETSENCRYPT_STAGING_URL;
  if (directory === "production") return LETSENCRYPT_PRODUCTION_URL;
  let u: URL;
  try {
    u = new URL(directory);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || !u.hostname) return null;
  if (u.hash) return null;
  const path = u.pathname.endsWith("/") ? u.pathname.slice(0, -1) : u.pathname;
  // WHATWG URL already lowercases the host and drops a default port.
  return `https://${u.host}${path}${u.search}`;
}

/** The entry's `directory` as stored: a keyword for the two Let's Encrypt URLs, else the canonical URL. */
export function canonicalDirectory(directory: unknown): string | null {
  if (typeof directory !== "string" || !directory) return null;
  const url = canonicalDirectoryUrl(directory.trim());
  if (url === null) return null;
  if (url === LETSENCRYPT_STAGING_URL) return "staging";
  if (url === LETSENCRYPT_PRODUCTION_URL) return "production";
  return url;
}

export function classifyDirectory(directory: string): DirectoryClass {
  return directory === "staging" ? "staging" : directory === "production" ? "production" : "custom";
}

/** `advertise` after classification: production → true, staging → false, custom → the operator's assertion. */
export function effectiveAdvertise(directory: string, advertise: unknown): boolean {
  const c = classifyDirectory(directory);
  if (c === "production") return true;
  if (c === "staging") return false;
  return advertise === true;
}

/** Hash naming an ACME account key file: (canonical directory URL, lowercase trimmed email). */
export function accountHash(directory: string, email: string): string {
  const url = canonicalDirectoryUrl(directory) ?? directory;
  return createHash("sha256").update(`${url}\n${email.trim().toLowerCase()}`).digest("hex").slice(0, 32);
}

export const ACCOUNT_KEY_FILE_RE = /^acme-account-([0-9a-f]{32})\.key$/;
export const accountKeyFileName = (hash: string): string => `acme-account-${hash}.key`;

/**
 * Normalized copy of an acme entry: lowercase/dot-stripped/deduped domains,
 * trimmed lowercase email, canonical directory, `configured` removed from the
 * solver. Unknown solver keys are KEPT so `validateAcmeEntry` can reject them
 * (unknown top-level keys are stored and ignored).
 */
export function normalizeAcmeEntry(entry: Json): Json {
  const out: Json = { ...entry };
  if (Array.isArray(entry.domains)) {
    const seen = new Set<unknown>();
    const list: unknown[] = [];
    for (const d of entry.domains) {
      const n = normalizeName(d);
      if (seen.has(n)) continue;
      seen.add(n);
      list.push(n);
    }
    out.domains = list;
  }
  if (typeof entry.email === "string") out.email = entry.email.trim().toLowerCase();
  if (typeof entry.directory === "string") out.directory = canonicalDirectory(entry.directory) ?? entry.directory;
  if (isObj(entry.solver)) {
    const { configured: _configured, ...solver } = entry.solver;
    if (typeof solver.server === "string") {
      solver.server = canonicalDirectoryUrl(solver.server) ?? solver.server;
    }
    if (typeof solver.fulldomain === "string") solver.fulldomain = normalizeName(solver.fulldomain);
    // DNS labels are case-insensitive: one key for the same-registration guard and the order lock.
    if (typeof solver.subdomain === "string") solver.subdomain = solver.subdomain.trim().toLowerCase();
    out.solver = solver;
  }
  return out;
}

const SOLVER_KEYS: Record<string, readonly string[]> = {
  cloudflare: ["type", "zoneId"],
  "acme-dns": ["type", "server", "subdomain", "fulldomain"],
};

function validateSolver(at: string, solver: unknown): string | null {
  if (!isObj(solver)) return `${at}.solver must be an object`;
  const type = solver.type;
  if (type !== "cloudflare" && type !== "acme-dns") return `${at}.solver.type must be "cloudflare" or "acme-dns"`;
  for (const k of Object.keys(solver)) {
    if (!SOLVER_KEYS[type].includes(k)) return `${at}.solver.${k} is not allowed (secrets live in the credential vault, not in config)`;
  }
  if (type === "cloudflare") {
    if (solver.zoneId !== undefined && (typeof solver.zoneId !== "string" || !ZONE_ID_RE.test(solver.zoneId))) {
      return `${at}.solver.zoneId must be 32 hex characters`;
    }
    return null;
  }
  const server = solver.server;
  if (typeof server !== "string" || canonicalDirectoryUrl(server) === null) {
    return `${at}.solver.server must be an https:// URL without credentials`;
  }
  if (typeof solver.subdomain !== "string" || !solver.subdomain.trim() || /\s/.test(solver.subdomain)) {
    return `${at}.solver.subdomain is required`;
  }
  const full = solver.fulldomain;
  if (typeof full !== "string" || full.startsWith("*.") || !isValidHostname(full)) {
    return `${at}.solver.fulldomain must be a hostname`;
  }
  return null;
}

/** Validation of one acme entry (id rules / uniqueness belong to the prerequisite). → 400 message or `null`. */
export function validateAcmeEntry(entry: Json): string | null {
  const n = normalizeAcmeEntry(entry);
  const at = typeof n.id === "string" && n.id ? `acme source "${n.id}"` : "acme source";
  if (!Array.isArray(n.domains)) return `${at}: domains must be an array`;
  if (n.domains.length < 1 || n.domains.length > MAX_ACME_DOMAINS) {
    return `${at}: domains must hold 1 to ${MAX_ACME_DOMAINS} names`;
  }
  for (let i = 0; i < n.domains.length; i++) {
    const d = n.domains[i];
    if (typeof d !== "string" || !isValidAcmeDomain(d)) {
      return `${at}: domains[${i}] ${JSON.stringify(d)} is not a valid hostname (letters, digits, hyphens; "*." for one wildcard label; IDNs as xn--)`;
    }
  }
  if (typeof n.email !== "string" || !EMAIL_RE.test(n.email)) return `${at}: email is not a valid address`;
  if (n.agreeTos !== true) return `${at}: agreeTos must be true (accept the CA terms of service)`;
  if (typeof entry.directory !== "string" || canonicalDirectory(entry.directory) === null) {
    return `${at}: directory must be "staging", "production" or an https:// URL without credentials`;
  }
  if (n.advertise !== undefined && typeof n.advertise !== "boolean") return `${at}: advertise must be a boolean`;
  return validateSolver(at, n.solver);
}
