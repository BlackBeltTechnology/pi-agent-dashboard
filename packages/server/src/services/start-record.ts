/**
 * `services-run/<id>/start.json` (0600): written on every dashboard start, any
 * driver, and read back on adoption. Holds the start time, a KEYED digest of the
 * secret values delivered to that start (HMAC-SHA256 over the sorted
 * `name=value` pairs, key = random per-installation `services-digest.key`, so a
 * weak secret cannot be brute-forced offline from the digest), the
 * `secretsSavedSinceStart` flag, and the output file's `(dev, ino)`.
 * See change: add-services-settings-ui (D4).
 */
import { createHmac, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DriverName } from "@blackbelt-technology/pi-dashboard-shared/services/schema.js";
import type { FileIdentity } from "./output-capture.js";
import { ensurePrivateDir, readJsonFile, type ServicesPaths, writePrivateFile } from "./paths.js";

export interface StartRecord {
  driver: DriverName;
  /** ISO 8601 — passed to `<runtime> logs --since`. */
  startedAt: string;
  secretsDigest: string;
  /** A secret value was saved while this start's instance ran. */
  secretsSavedSinceStart: boolean;
  /** native / attached only. */
  output?: FileIdentity;
}

/** Load (or create, 0600) the per-installation digest key. */
export function loadDigestKey(paths: ServicesPaths): Buffer {
  try {
    const raw = fs.readFileSync(paths.digestKey);
    if (raw.length >= 32) return raw;
  } catch {
    /* create below */
  }
  ensurePrivateDir(path.dirname(paths.digestKey));
  const key = randomBytes(32);
  const tmp = `${paths.digestKey}.tmp`;
  fs.writeFileSync(tmp, key, { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, paths.digestKey);
  return key;
}

/** HMAC over the sorted `name=value` pairs (NUL-separated so values cannot forge boundaries). */
export function secretsDigest(key: Buffer, values: Record<string, string>): string {
  const h = createHmac("sha256", key);
  for (const name of Object.keys(values).sort()) h.update(`${name}=${values[name]}\0`);
  return h.digest("hex");
}

export function readStartRecord(paths: ServicesPaths, id: string): StartRecord | null {
  const r = readJsonFile<Partial<StartRecord>>(paths.startRecord(id));
  if (!r || typeof r.startedAt !== "string" || typeof r.secretsDigest !== "string" || typeof r.driver !== "string") return null;
  return {
    driver: r.driver,
    startedAt: r.startedAt,
    secretsDigest: r.secretsDigest,
    secretsSavedSinceStart: r.secretsSavedSinceStart === true,
    ...(r.output && Number.isFinite(r.output.dev) && Number.isFinite(r.output.ino) ? { output: r.output } : {}),
  };
}

export function writeStartRecord(paths: ServicesPaths, id: string, rec: StartRecord): void {
  writePrivateFile(paths.startRecord(id), `${JSON.stringify(rec, null, 2)}\n`);
}
