/**
 * Read/write ~/.pi/agent/auth.json for pi provider credentials.
 * Uses lockfile + atomic write to avoid race conditions with running pi sessions.
 *
 * The OAuth provider list derives from the local handler registry
 * (`getAllHandlers()` in provider-auth-handlers.ts). The API-key list
 * derives from the bridge-pushed catalogue (provider-catalogue-cache.ts).
 * See change: replace-hardcoded-provider-lists.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);
const _lockfile = _require("proper-lockfile") as typeof import("proper-lockfile");
import type { ProviderAuthStatus } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type { ProviderInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { getAllHandlers, type ProviderHandler } from "./provider-auth-handlers.js";
import { getLatestCatalogue } from "../package/provider-catalogue-cache.js";

// ── Constants ────────────────────────────────────────────────────────────────

const AUTH_DIR = path.join(os.homedir(), ".pi", "agent");
const AUTH_PATH = path.join(AUTH_DIR, "auth.json");

export type ApiKeyCredential = { type: "api_key"; key: string };
export type OAuthCredential = { type: "oauth"; refresh: string; access: string; expires: number; [k: string]: unknown };
export type AuthCredential = ApiKeyCredential | OAuthCredential;
export type AuthData = Record<string, AuthCredential>;

interface OAuthProviderMeta {
  id: string;
  name: string;
  flowType: "auth_code" | "device_code";
}

// ── Lock helpers (proper-lockfile) ───────────────────────────────────────────
//
// Upgraded from mkdir-based lock to proper-lockfile to match pi-coding-agent's
// AuthStorage lock convention. See change: add-dashboard-model-proxy task 2.5.

/**
 * Run `fn` while holding a proper-lockfile lock on auth.json.
 * Ensures the file exists (lockfile requires the target to exist).
 */
function withLock<T>(fn: () => T): T {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  if (!fs.existsSync(AUTH_PATH)) {
    // Create empty auth file so lockfile can lock it. 0600 explicitly: without
    // it the placeholder lands at 0666 & ~umask (≈0644) and writeAuthJson's
    // permission preservation carries that onto every later write — the
    // credential file would be group/world-readable. See change:
    // fix-corrupt-auth-json-500.
    try { fs.writeFileSync(AUTH_PATH, "{}\n", { flag: "wx", mode: 0o600 }); } catch { /* race-safe */ }
  }

  const release = _lockfile.lockSync(AUTH_PATH, {
    stale: 10_000,
    realpath: false,
  });
  try {
    return fn();
  } finally {
    try { release(); } catch { /* ignore cleanup errors */ }
  }
}

// ── File operations ──────────────────────────────────────────────────────────

// ── Corrupt-content recovery ──────────────────────────────────────────
//
// auth.json is shared with pi processes and can be truncated/emptied by an
// interrupted write. Read tolerance and write safety are SPLIT: a read never
// fails on bad content (it quarantines a copy and returns {}), a write never
// destroys bytes it could not first copy aside. See change:
// fix-corrupt-auth-json-500.

/**
 * Internal carrier of a checked read. `quarantined: true` means a backup of
 * these exact bytes exists on disk — NOT that this call performed the copy.
 */
interface CheckedAuthRead {
  data: AuthData;
  /** Bytes were readable but not a JSON plain object. */
  corrupt: boolean;
  /** A backup of these exact bytes exists on disk (this call, or a dedup hit). */
  quarantined: boolean;
}

/** In-process dedup of quarantined content: sha256 hex → recorded only on a successful copy. */
const quarantinedBackups = new Set<string>();

/** Test seam: clear the quarantine dedup set between assertions. */
export function _resetQuarantineDedupForTests(): void {
  quarantinedBackups.clear();
}

/** `YYYYMMDDTHHMMSSsssZ` — sortable, millisecond precision, and NTFS-safe (no `:`). */
function quarantineStamp(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, "").replace(".", "");
}

/**
 * Copy the bad bytes to `auth.json.corrupt-<stamp>[-N]` and report success.
 *
 * The bytes WRITTEN are the exact bytes that were read and hashed — never a
 * fresh re-read of the file. A `copyFileSync` here would re-read the CURRENT
 * file, and on the unlocked read path pi can replace auth.json in between,
 * yielding a backup of content Y while the dedup set records sha256(X) — the
 * one scenario where the write-path refusal could then destroy X with no real
 * backup of X. Writing the in-memory buffer is byte-exact by construction and
 * is a COPY, never a rename: pi replaces auth.json atomically, so a read→rename
 * is a TOCTOU that can move away a file that became valid between our read and
 * the rename.
 *
 * The `wx` flag means two dashboards (or a crash-looping pi) on one $HOME never
 * overwrite an existing backup; on EEXIST a `-1`, `-2`, … suffix is appended.
 * Mode 0600: truncated credential files usually still contain intact secrets.
 *
 * Returns true also on a DEDUP HIT — the flag means "a backup of these exact
 * bytes was made earlier in this process", not "this call performed the copy"
 * and not "the backup still exists". The hash is recorded only after a
 * successful write so a failed write is retried, never latched.
 */
function quarantineCorruptAuthFile(bytes: Buffer): boolean {
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (quarantinedBackups.has(digest)) return true;

  const base = `${AUTH_PATH}.corrupt-${quarantineStamp()}`;
  let target = base;
  for (let n = 1; ; n++) {
    try {
      fs.writeFileSync(target, bytes, { flag: "wx", mode: 0o600 });
    } catch (err: any) {
      if (err?.code === "EEXIST") { target = `${base}-${n}`; continue; }
      // A failed exclusive create can leave an empty/partial file behind;
      // remove it so the retry reuses the same name instead of stacking -N.
      try { fs.unlinkSync(target); } catch { /* best-effort cleanup */ }
      console.warn(`[provider-auth] Could not quarantine corrupt auth.json: write ${target} failed:`, err?.message ?? err);
      return false;
    }
    quarantinedBackups.add(digest);
    // One announcement: path + reason. Never the file's contents.
    console.warn(`[provider-auth] auth.json is corrupt (unparseable content); quarantined a byte-exact copy to ${target}`);
    return true;
  }
}

/** Parse with BOM tolerance; non-plain-object JSON is corrupt by definition. */
function parseAuthData(raw: string): AuthData {
  const stripped = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const parsed: unknown = JSON.parse(stripped);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SyntaxError("auth.json content is not a JSON object");
  }
  return parsed as AuthData;
}

/**
 * Checked read. Content failures (empty/truncated/non-object) never throw:
 * they quarantine the bytes and return `{}` with `corrupt: true`. Read
 * failures (EACCES, EISDIR, …) are NOT content failures and still throw —
 * an unreadable file is a deployment bug, not corruption. ENOENT keeps its
 * meaning: `{}`, corrupt: false.
 */
function readAuthJsonChecked(): CheckedAuthRead {
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(AUTH_PATH);
  } catch (err: any) {
    if (err.code === "ENOENT") return { data: {}, corrupt: false, quarantined: false };
    throw err;
  }
  try {
    return { data: parseAuthData(bytes.toString("utf-8")), corrupt: false, quarantined: false };
  } catch (err: any) {
    if (!(err instanceof SyntaxError)) throw err;
    const quarantined = quarantineCorruptAuthFile(bytes);
    return { data: {}, corrupt: true, quarantined };
  }
}

export function readAuthJson(): AuthData {
  return readAuthJsonChecked().data;
}

/** Write-path refusal reason. Names the file, never any credential material. */
function corruptUnbackedRefusal(): Error {
  return new Error(
    `Refusing to write credentials: ${AUTH_PATH} is corrupt and could not be backed up. ` +
    `Fix or remove the file manually, then try again.`,
  );
}

function writeAuthJson(data: AuthData, forceMode?: number): void {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const tmp = AUTH_PATH + ".tmp";
  const content = JSON.stringify(data, null, 2) + "\n";

  // Preserve existing permissions or use 0600 for new file. A corrupt-file
  // repair forces 0600: the corrupt file may carry wider bits (e.g. created
  // 0644 by an older build), and the repaired credential file must not
  // inherit them. See change: fix-corrupt-auth-json-500.
  let mode: number;
  if (forceMode !== undefined) {
    mode = forceMode;
  } else {
    mode = 0o600;
    try {
      mode = fs.statSync(AUTH_PATH).mode & 0o777;
    } catch { /* file doesn't exist yet */ }
  }

  fs.writeFileSync(tmp, content, { mode });
  fs.renameSync(tmp, AUTH_PATH);
}

// ── Public API: write/remove ─────────────────────────────────────────────────

export function writeCredential(provider: string, credential: AuthCredential): void {
  withLock(() => {
    const checked = readAuthJsonChecked();
    if (checked.corrupt && !checked.quarantined) throw corruptUnbackedRefusal();
    const data = checked.data;
    data[provider] = credential;
    writeAuthJson(data, checked.corrupt ? 0o600 : undefined);
  });
}

export function removeCredential(provider: string): void {
  withLock(() => {
    const checked = readAuthJsonChecked();
    if (checked.corrupt && !checked.quarantined) throw corruptUnbackedRefusal();
    const data = checked.data;
    delete data[provider];
    writeAuthJson(data, checked.corrupt ? 0o600 : undefined);
  });
}

// ── Pure status builder (testable) ───────────────────────────────────────────

/**
 * Pure derivation of `ProviderAuthStatus[]` from auth.json data, the
 * bridge-pushed provider catalogue, and the local OAuth handler set.
 * No I/O. See change: replace-hardcoded-provider-lists.
 */
export function _buildAuthStatus(
  catalogue: ProviderInfo[],
  authData: AuthData,
  oauthHandlers: ProviderHandler[],
): ProviderAuthStatus[] {
  const statuses: ProviderAuthStatus[] = [];
  const oauthIds = new Set(oauthHandlers.map((h) => h.providerId));

  // OAuth rows from local handler registry.
  for (const h of oauthHandlers) {
    const cred = authData[h.providerId];
    if (cred && cred.type === "oauth") {
      statuses.push({
        id: h.providerId,
        name: h.displayName,
        flowType: h.flowType,
        authenticated: true,
        expires: (cred as OAuthCredential).expires,
      });
    } else {
      statuses.push({
        id: h.providerId,
        name: h.displayName,
        flowType: h.flowType,
        authenticated: false,
      });
    }
  }

  // API-key rows from bridge-pushed catalogue.
  // Skip custom providers (registered via pi.registerProvider() from
  // ~/.pi/agent/providers.json) — those are managed by the dedicated
  // LLM Providers settings section. OAuth rows for custom providers
  // were already emitted above when the OAuth handler registry has
  // a matching id.
  for (const entry of catalogue) {
    if (entry.custom) continue;
    const hasOAuthCollision = oauthIds.has(entry.id);
    const uiId = hasOAuthCollision ? `${entry.id}-api` : entry.id;
    const displayName = hasOAuthCollision
      ? `${entry.displayName} (API Key)`
      : entry.displayName;
    const authJsonKey = entry.id;
    const cred = authData[authJsonKey];
    const hasStoredKey = !!(cred && cred.type === "api_key" && (cred as ApiKeyCredential).key);

    const row: ProviderAuthStatus = {
      id: uiId,
      name: displayName,
      flowType: "api_key",
      authenticated: hasStoredKey || !!entry.ambient,
    };
    if (hasStoredKey) {
      const key = (cred as ApiKeyCredential).key;
      row.maskedKey = key.length >= 12 ? `${key.slice(0, 5)}...${key.slice(-3)}` : "****";
    } else if (entry.ambient) {
      row.maskedKey = "(ambient)";
    }
    if (entry.envVar) row.envVar = entry.envVar;
    if (entry.ambient) row.ambient = true;
    statuses.push(row);
  }

  return statuses;
}

// ── Public API: status / OAuth meta / id resolution ─────────────────────────

export function getAuthStatus(): ProviderAuthStatus[] {
  return _buildAuthStatus(getLatestCatalogue(), readAuthJson(), getAllHandlers());
}

export function getOAuthProvidersMeta(): OAuthProviderMeta[] {
  return getAllHandlers().map((h) => ({
    id: h.providerId,
    name: h.displayName,
    flowType: h.flowType,
  }));
}

/**
 * Resolve a UI provider ID to the auth.json key.
 *
 * The catalogue encodes API-key rows with `<id>-api` suffix when an
 * OAuth handler exists for the same id. This unwraps the suffix back
 * to the underlying auth.json key. OAuth ids pass through unchanged
 * (their UI id == their auth.json key). Unknown ids pass through too,
 * matching the previous behavior.
 */
export function resolveAuthJsonKey(providerId: string): string {
  const oauthIds = new Set(getAllHandlers().map((h) => h.providerId));
  // <id>-api suffix → strip suffix iff the bare id is an OAuth handler.
  if (providerId.endsWith("-api")) {
    const bare = providerId.slice(0, -"-api".length);
    if (oauthIds.has(bare)) return bare;
  }
  return providerId;
}
