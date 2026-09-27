/**
 * Read/write ~/.pi/agent/auth.json for pi provider credentials.
 * Uses lockfile + atomic write to avoid race conditions with running pi sessions.
 *
 * The OAuth provider list derives from the pi runtime's provider registry
 * (`getOAuthRegistry()`), unioned with any id that already holds a stored
 * `{ type: "oauth" }` credential — so a credential pi wrote for a provider the
 * dashboard has no flow for is still visible and removable. The API-key list
 * derives from the bridge-pushed catalogue (provider-catalogue-cache.ts).
 * See changes: replace-hardcoded-provider-lists, delegate-provider-oauth-to-pi-ai.
 */

import os from "node:os";
import path from "node:path";

import type { ProviderAuthStatus } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type { ProviderInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { getLatestCatalogue } from "../package/provider-catalogue-cache.js";
import {
  getOAuthRegistry,
  type OAuthRegistryEntry,
} from "./provider-auth-handlers.js";
import {
  type CheckedJsonRead,
  corruptUnbackedRefusal as corruptUnbackedRefusal_,
  _resetQuarantineDedupForTests as _resetLockedJsonQuarantineDedup,
  readJsonChecked,
  withLockedJsonFile,
  writeJsonAtomic,
} from "./locked-json-file.js";

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

// ── Locked file I/O ──────────────────────────────────────────────────────────
//
// Lock, checked read, quarantine and atomic write live in locked-json-file.ts,
// shared with the plugin credential store. auth.json behaviour is unchanged.
// See changes: fix-provider-auth-lock-contention, fix-corrupt-auth-json-500,
// expose-plugin-credential-and-oauth-seams (D1).

const LOG_TAG = "provider-auth";

/** Test seam: clear the quarantine dedup between assertions. */
export function _resetQuarantineDedupForTests(): void {
  _resetLockedJsonQuarantineDedup();
}

function withLock<T>(fn: () => T | Promise<T>): Promise<T> {
  return withLockedJsonFile(AUTH_PATH, fn);
}

function readAuthJsonChecked(): CheckedJsonRead<AuthData> {
  return readJsonChecked<AuthData>(AUTH_PATH, LOG_TAG);
}

export function readAuthJson(): AuthData {
  return readAuthJsonChecked().data;
}

function corruptUnbackedRefusal(): Error {
  return corruptUnbackedRefusal_(AUTH_PATH);
}

function writeAuthJson(data: AuthData, forceMode?: number): void {
  writeJsonAtomic(AUTH_PATH, data, forceMode);
}

// ── Public API: write/remove ─────────────────────────────────────────────────

/**
 * Thrown when a credential write would replace a stored credential of a
 * DIFFERENT `type` under the same auth.json key (D2): an api-key save over a
 * stored OAuth login, or a completed OAuth sign-in over a stored api key.
 * Throws rather than returning because `writeCredential` is `void` and every
 * call site ignores return values — a return-valued refusal would be silent.
 * `code` is the stable machine code the client translates; `storedType` names
 * the STORED credential's type (what the caller must remove first).
 * See change: redesign-providers-settings-page (D2).
 */
export class CredentialTypeConflictError extends Error {
  readonly code = "provider_auth.credential_type_conflict";
  readonly provider: string;
  readonly storedType: AuthCredential["type"];

  constructor(provider: string, storedType: AuthCredential["type"], attemptedKind: AuthCredential["type"]) {
    super(
      `"${provider}" already holds a ${storedType} credential. ` +
      `Remove it before writing a ${attemptedKind} credential.`,
    );
    this.name = "CredentialTypeConflictError";
    this.provider = provider;
    this.storedType = storedType;
  }
}

/**
 * Persist one provider credential.
 *
 * Async: the lock wait must not block the server's event loop, so a caller has
 * to await it or the write stops being ordered before whatever follows.
 * See change: fix-provider-auth-lock-contention.
 */
export async function writeCredential(provider: string, credential: AuthCredential): Promise<void> {
  await withLock(() => {
    const checked = readAuthJsonChecked();
    if (checked.corrupt && !checked.quarantined) throw corruptUnbackedRefusal();
    const data = checked.data;
    // D2 — refuse the cross-type clobber. Several UI rows resolve to ONE
    // storage key (`anthropic-api` → `anthropic`), so a different-type write
    // here would silently destroy a stored subscription login or key. Same-type
    // writes (api-key overwrite, OAuth token refresh) are unaffected.
    // See change: redesign-providers-settings-page (D2).
    const stored = data[provider];
    if (stored && stored.type !== credential.type) {
      throw new CredentialTypeConflictError(provider, stored.type, credential.type);
    }
    data[provider] = credential;
    writeAuthJson(data, checked.corrupt ? 0o600 : undefined);
  });
}

/** Remove one provider credential. Async — see `writeCredential`.
 *
 *  `expectedKind` carries the kind of the UI row the removal was addressed to
 *  ("oauth" for a handler id, "api_key" otherwise — including an `<id>-api`
 *  twin). A stored credential of a DIFFERENT type refuses the same way a write
 *  does (D2/X2): a delete addressed to the api-key row must not revoke the
 *  sibling's OAuth login. Removing the credential the row owns — or removing
 *  when nothing is stored — succeeds. Omitting `expectedKind` keeps the
 *  unguarded legacy behavior for any caller that has no row kind.
 */
export async function removeCredential(provider: string, expectedKind?: AuthCredential["type"]): Promise<void> {
  await withLock(() => {
    const checked = readAuthJsonChecked();
    if (checked.corrupt && !checked.quarantined) throw corruptUnbackedRefusal();
    const data = checked.data;
    const stored = data[provider];
    if (stored && expectedKind && stored.type !== expectedKind) {
      throw new CredentialTypeConflictError(provider, stored.type, expectedKind);
    }
    delete data[provider];
    writeAuthJson(data, checked.corrupt ? 0o600 : undefined);
  });
}

// ── Pure status builder (testable) ───────────────────────────────────────────

/**
 * Every id treated as an OAuth row: the runtime registry ∪ any id already
 * holding a stored `{ type: "oauth" }` credential.
 *
 * `_buildAuthStatus`, `resolveAuthJsonKey` and the DELETE route's row-kind
 * check all read THIS ONE union, so a row's kind cannot differ between "what
 * the list shows" and "what a removal addresses". A credential pi wrote for a
 * provider the dashboard has no flow for is therefore visible and removable,
 * not invisible-and-stuck.
 * See change: delegate-provider-oauth-to-pi-ai (D1).
 */
export function oauthIdSet(authData: AuthData = readAuthJson()): Set<string> {
  return oauthIdsFrom(getOAuthRegistry(), authData);
}

/**
 * The same union, from an EXPLICIT registry — keeps `_buildAuthStatus` pure and
 * testable while the production call site ({@link oauthIdSet}) reads the live
 * one. The two must agree: in production `oauthEntries` IS the live registry.
 */
export function oauthIdsFrom(
  entries: readonly OAuthRegistryEntry[],
  authData: AuthData,
): Set<string> {
  const ids = new Set(entries.map((e) => e.id));
  for (const [id, cred] of Object.entries(authData)) {
    if (cred?.type === "oauth") ids.add(id);
  }
  return ids;
}

/**
 * A permanent key obtained through an OAuth handshake (what OpenRouter issues)
 * stores `refresh: ""` and a meaningless `expires`. Emit `null` so clients
 * apply ONE null-check instead of provider-specific knowledge.
 * See change: delegate-provider-oauth-to-pi-ai (D4).
 */
function oauthRowExpires(cred: OAuthCredential): number | null {
  return cred.refresh ? cred.expires : null;
}

/**
 * Pure derivation of `ProviderAuthStatus[]` from auth.json data, the
 * bridge-pushed provider catalogue, and the OAuth registry.
 * No I/O. See change: replace-hardcoded-provider-lists.
 */
export function _buildAuthStatus(
  catalogue: ProviderInfo[],
  authData: AuthData,
  oauthEntries: OAuthRegistryEntry[],
): ProviderAuthStatus[] {
  const statuses: ProviderAuthStatus[] = [];
  const oauthIds = oauthIdsFrom(oauthEntries, authData);

  const pushOAuthRow = (
    id: string,
    name: string,
    flowType: "auth_code" | "device_code",
  ): void => {
    const cred = authData[id];
    if (cred?.type === "oauth") {
      statuses.push({
        id,
        name,
        flowType,
        authenticated: true,
        expires: oauthRowExpires(cred),
        configured: true,
        source: "stored",
      });
    } else {
      statuses.push({ id, name, flowType, authenticated: false, configured: false });
    }
  };

  // OAuth rows from the runtime registry.
  const registryIds = new Set<string>();
  for (const entry of oauthEntries) {
    registryIds.add(entry.id);
    pushOAuthRow(entry.id, entry.name, entry.flowType);
  }

  // Stored OAuth credentials the registry does not list: written by pi (or an
  // older dashboard) for a provider with no dashboard flow. Still connected —
  // and still removable — just not re-loginable from here.
  for (const [id, cred] of Object.entries(authData)) {
    if (cred?.type !== "oauth" || registryIds.has(id)) continue;
    pushOAuthRow(id, id, "device_code");
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
    // D1 — one rule for EVERY api-key row, twin or not.
    //
    // `source: "stored"` is excluded as catalogue evidence because a stored
    // credential of ANY kind sets `entry.configured` with `source: "stored"`.
    // Without the exclusion, an OAuth credential on a catalogue id with no
    // dashboard handler emits a phantom `api_key` row — `configured: true`, no
    // `maskedKey` — whose Remove would delete that OAuth credential.
    // `hasStoredKey` already covers every stored api-*key* credential, so the
    // exclusion loses nothing.
    //
    // `source == null` is likewise not evidence: the bridge's fallback branch
    // sets `configured` with no `source`, and treating `undefined !== "stored"`
    // as evidence would reopen the clobber against an older pi.
    const rowConfigured =
      hasStoredKey ||
      !!entry.ambient ||
      (entry.configured && entry.source != null && entry.source !== "stored");

    const row: ProviderAuthStatus = {
      id: uiId,
      name: displayName,
      flowType: "api_key",
      authenticated: hasStoredKey || !!entry.ambient,
      configured: rowConfigured,
    };
    // `source` mirrors the catalogue's evidence whenever the row is configured
    // by it; `stored` evidence sets it through `hasStoredKey` instead.
    //
    // A STORED key outranks the catalogue's own `source`. pi-ai reports
    // `source: "environment"` whenever the env var is also set, so a provider
    // with BOTH a key in auth.json and the env var exported would otherwise be
    // labelled `environment` while carrying a `maskedKey` — contradicting the
    // status contract, which reserves `stored` for auth.json-backed rows.
    if (hasStoredKey) row.source = "stored";
    else if (rowConfigured && entry.source != null) row.source = entry.source;
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
  return _buildAuthStatus(getLatestCatalogue(), readAuthJson(), getOAuthRegistry());
}

export function getOAuthProvidersMeta(
  entries: readonly OAuthRegistryEntry[] = getOAuthRegistry(),
): OAuthProviderMeta[] {
  return entries.map((e) => ({
    id: e.id,
    name: e.name,
    flowType: e.flowType,
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
  // <id>-api suffix → strip suffix iff the bare id is an OAuth id.
  if (providerId.endsWith("-api")) {
    const bare = providerId.slice(0, -"-api".length);
    if (oauthIdSet().has(bare)) return bare;
  }
  return providerId;
}
