/**
 * Per-provider cache of the last successful `/v1/models` discovery, read at
 * bridge activation so a custom-provider `--model` resolves at pi startup
 * without network access.
 *
 * File per provider: `~/.pi/dashboard/custom-provider-models/<encoded-name>.json`,
 * mode 0600, written as `<file>.<pid>.tmp` + rename (complete file, so
 * concurrent writers for different providers never touch each other and
 * same-provider writers are last-writer-wins with equally valid content).
 *
 * Holds NO credentials: only a one-way `keyFingerprint` (first 16 hex chars of
 * SHA-256 over `name + "\0" + resolvedKey`). A `!command` key is hashed by its
 * raw reference (the command is never executed for fingerprinting).
 *
 * See change: register-custom-provider-models-at-activation (design D3).
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AdvertisedModelMetadata } from "@blackbelt-technology/pi-dashboard-shared/provider-model-metadata.js";

export interface CachedModel {
  id: string;
  owned_by?: string;
  advertised: AdvertisedModelMetadata;
}

interface CacheFile {
  version: 1;
  baseUrl: string;
  keyFingerprint: string;
  discoveredAt: string;
  models: CachedModel[];
}

/** Cache directory, resolved per call so tests can redirect `HOME`. */
export function providerModelCacheDir(): string {
  return join(homedir(), ".pi", "dashboard", "custom-provider-models");
}

export function providerModelCachePath(name: string): string {
  return join(providerModelCacheDir(), `${encodeURIComponent(name)}.json`);
}

/** `$ENV` → env value; anything else (literal or `!command`) → as-is. */
function resolvedKeyForFingerprint(apiKey: string): string {
  if (apiKey.startsWith("$")) return process.env[apiKey.slice(1)] ?? "";
  return apiKey;
}

export function keyFingerprint(name: string, apiKey: string): string {
  return createHash("sha256")
    .update(`${name}\0${resolvedKeyForFingerprint(apiKey)}`)
    .digest("hex")
    .slice(0, 16);
}

function isCachedModel(m: unknown): m is CachedModel {
  if (!m || typeof m !== "object") return false;
  const o = m as Record<string, unknown>;
  return typeof o.id === "string" && o.id.length > 0 && !!o.advertised && typeof o.advertised === "object";
}

/**
 * The cached model list for `name`, or `null` when there is no usable entry:
 * missing/unreadable/malformed file, a different `baseUrl`, a different key
 * fingerprint, or an empty list. Never throws.
 */
export function readProviderModelCache(
  name: string,
  entry: { baseUrl: string; apiKey: string },
): CachedModel[] | null {
  try {
    const raw = JSON.parse(readFileSync(providerModelCachePath(name), "utf-8")) as Partial<CacheFile>;
    if (!raw || typeof raw !== "object" || raw.version !== 1) return null;
    if (raw.baseUrl !== entry.baseUrl) return null;
    if (raw.keyFingerprint !== keyFingerprint(name, entry.apiKey)) return null;
    if (!Array.isArray(raw.models) || raw.models.length === 0) return null;
    if (!raw.models.every(isCachedModel)) return null;
    return raw.models;
  } catch {
    return null;
  }
}

/**
 * Record a successful discovery. A `null` or empty result is a no-op (a failed
 * or empty discovery never poisons the cache). Never throws.
 */
export function recordProviderModelCache(
  name: string,
  entry: { baseUrl: string; apiKey: string },
  models: readonly CachedModel[] | null | undefined,
): void {
  if (!models || models.length === 0) return;
  const file = providerModelCachePath(name);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    mkdirSync(providerModelCacheDir(), { recursive: true, mode: 0o700 });
    const body: CacheFile = {
      version: 1,
      baseUrl: entry.baseUrl,
      keyFingerprint: keyFingerprint(name, entry.apiKey),
      discoveredAt: new Date().toISOString(),
      models: models.map((m) => ({
        id: m.id,
        ...(m.owned_by !== undefined ? { owned_by: m.owned_by } : {}),
        advertised: m.advertised ?? {},
      })),
    };
    writeFileSync(tmp, JSON.stringify(body), { encoding: "utf-8", mode: 0o600 });
    renameSync(tmp, file);
  } catch (err: any) {
    try { rmSync(tmp, { force: true }); } catch { /* best effort */ }
    console.warn(`[dashboard] model cache write for "${name}" failed: ${err?.message ?? String(err)}`);
  }
}
