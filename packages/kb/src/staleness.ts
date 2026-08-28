// Acknowledgement records for documented DOX rows (the staleness sidecar).
// Leaf module: imported by dox.ts (lint), dox-triage.ts (triage), verdict.ts
// (query-time freshness) and kb-extension (ack-on-edit) — deliberately
// dependency-free so lint and query time can never disagree through divergent
// copies. See change: add-kb-trust-verdicts-and-search-guard (sidecar v2).
import { existsSync, readFileSync } from "node:fs";

/** An acknowledgement record for one documented file. v2 records the stat
 *  baseline beside the hash so query-time freshness can skip the read; a v1
 *  (hash-only) record reads back with `size`/`mtimeMs` unknown — never zero. */
export interface AckRecord {
  sha256: string;
  size?: number;
  mtimeMs?: number;
}

/** Sidecar version. v1 = bare `Record<path, sha256>` (legacy, no version key);
 *  v2 = `{ version: 2, files: Record<path, AckRecord> }`. A FUTURE version is
 *  rejected by readers so its records can never silently misread as v2. */
export const STALENESS_VERSION = 2;

export interface StalenessFile {
  version: number;
  files: Record<string, AckRecord>;
}

/** Read a staleness sidecar, tolerant of v1 (sha-only strings) and v2 (records
 *  with the stat baseline). Unknown/corrupt shapes read as empty — never a
 *  crash, never a guessed record. Consumed by lint, triage, ack-on-edit, and
 *  query-time verdicts so all four agree on what "acknowledged" means. */
export function readStaleness(stalenessFile: string): Record<string, AckRecord> {
  if (!existsSync(stalenessFile)) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(stalenessFile, "utf8"));
  } catch {
    return {};
  }
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return {};
  if (!("version" in raw)) {
    // v1: Record<path, sha256-string>
    const out: Record<string, AckRecord> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = { sha256: v };
    }
    return out;
  }
  if ((raw as { version?: unknown }).version !== STALENESS_VERSION) return {};
  const files = (raw as { files?: unknown }).files;
  if (files == null || typeof files !== "object" || Array.isArray(files)) return {};
  const out: Record<string, AckRecord> = {};
  for (const [k, rec] of Object.entries(files as Record<string, unknown>)) {
    if (rec == null || typeof rec !== "object") continue;
    const r = rec as { sha256?: unknown; size?: unknown; mtimeMs?: unknown };
    if (typeof r.sha256 !== "string") continue;
    out[k] = {
      sha256: r.sha256,
      size: typeof r.size === "number" ? r.size : undefined,
      mtimeMs: typeof r.mtimeMs === "number" ? r.mtimeMs : undefined,
    };
  }
  return out;
}
