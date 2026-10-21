/**
 * The ONE reader and writer of `auth.trustedPlugins` (design D12, R1, X8).
 *
 * Only the trust endpoints (task 6.12) write the list, through `updateTrustedPlugins`: a
 * read-modify-write of `auth.trustedPlugins` ALONE over the raw `config.json`, so every other `auth`
 * key (`capabilityRoutePlugins`, `providers`, `bypassHosts`, secrets, unknown keys) and every other
 * top-level key stays as stored. The generic `PUT /api/config` write (`writeConfigPartial`) never
 * merges `partial.auth.trustedPlugins`.
 *
 * Callers serialise through `withSettingsWriteLock(TRUST_WRITE_LOCK_KEY, …)`; this module does not lock.
 *
 * See change: decouple-plugins-from-core (task 6.5).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadConfig,
  parseTrustedPlugins,
  type TrustedPluginEntry,
  writeConfigFileSecure,
} from "@blackbelt-technology/pi-dashboard-shared/config.js";

export type { TrustedPluginEntry };

/** Lock key a trust write runs under (`withSettingsWriteLock`). */
export const TRUST_WRITE_LOCK_KEY = "plugin-trust";

/** `auth.trustedPlugins` as the typed, normalized config holds it. Live (re-reads `config.json`). */
export function readTrustedPlugins(): readonly TrustedPluginEntry[] {
  return loadConfig().auth?.trustedPlugins ?? [];
}

/** Pure: entry for `pluginId`, if any. */
function findTrustEntry(entries: readonly TrustedPluginEntry[], pluginId: string): TrustedPluginEntry | undefined {
  return entries.find((e) => e.id === pluginId);
}

function configFile(): string {
  return path.join(os.homedir(), ".pi", "dashboard", "config.json");
}

function readRaw(file: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Read-modify-write `auth.trustedPlugins` only. `mutate` receives the current normalized list and
 * returns the next one (re-normalized before it is stored). An empty list removes the key, and an
 * `auth` block left empty is dropped. Returns the lists before / after.
 */
export function updateTrustedPlugins(mutate: (current: readonly TrustedPluginEntry[]) => readonly TrustedPluginEntry[]): {
  before: TrustedPluginEntry[];
  after: TrustedPluginEntry[];
} {
  const file = configFile();
  const raw = readRaw(file);
  const rawAuth = raw.auth;
  const hadAuth = typeof rawAuth === "object" && rawAuth !== null && !Array.isArray(rawAuth);
  const auth: Record<string, unknown> = hadAuth ? { ...(rawAuth as Record<string, unknown>) } : {};
  const before = parseTrustedPlugins(auth.trustedPlugins);
  const after = parseTrustedPlugins(mutate(before));

  if (after.length > 0) auth.trustedPlugins = after;
  else delete auth.trustedPlugins;

  const next: Record<string, unknown> = { ...raw };
  if (Object.keys(auth).length > 0) next.auth = auth;
  else delete next.auth;

  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeConfigFileSecure(file, `${JSON.stringify(next, null, 2)}\n`);
  return { before, after };
}

/** Grant (or re-pin) the client trust of `id`: `clientSha256` set, an existing `server` grant kept. */
export function grantClientTrust(id: string, clientSha256: string) {
  return updateTrustedPlugins((cur) => upsert(cur, id, (e) => ({ ...e, clientSha256 })));
}

/** Grant the `pi-package` server-entry trust of `id`: `server: true`, an existing pin kept. */
export function grantServerTrust(id: string) {
  return updateTrustedPlugins((cur) => upsert(cur, id, (e) => ({ ...e, server: true as const })));
}

/** Remove every trust of `id` (client pin and server grant). */
export function revokeTrust(id: string) {
  return updateTrustedPlugins((cur) => cur.filter((e) => e.id !== id));
}

function upsert(
  cur: readonly TrustedPluginEntry[],
  id: string,
  apply: (e: TrustedPluginEntry) => TrustedPluginEntry,
): TrustedPluginEntry[] {
  const found = cur.some((e) => e.id === id);
  return found ? cur.map((e) => (e.id === id ? apply(e) : e)) : [...cur, apply({ id })];
}
