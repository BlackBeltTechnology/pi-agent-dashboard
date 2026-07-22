/**
 * Read + atomic-write of the hermes config file.
 *
 * `readEffectiveConfig` returns, per known field, the effective value (on-disk
 * when present, else the default), the default, and an `isDefault` flag — plus
 * the resolved `raw` object and a file-level `exists` flag (design D4).
 * `writeResolvedConfig` writes pretty JSON atomically (tmp file in the same dir
 * + `fs.rename`), creating the parent dir (design D7).
 *
 * See change: add-hermes-memory-settings-plugin.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { DEFAULTS, KNOWN_KEYS, type MemoryConfig } from "../shared/hermes-config.js";

export interface FieldView {
  value: unknown;
  default: unknown;
  isDefault: boolean;
}

export interface EffectiveConfig {
  filePath: string;
  exists: boolean;
  raw: Record<string, unknown>;
  fields: Record<string, FieldView>;
}

/** Parse the on-disk file, tolerating absence + malformed JSON (→ `{}`). */
function readRaw(filePath: string): { exists: boolean; parsed: Record<string, unknown> } {
  if (!fs.existsSync(filePath)) return { exists: false, parsed: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return { exists: true, parsed: parsed as Record<string, unknown> };
    }
  } catch {
    // Malformed file — treat as present-but-empty; every field reads default.
  }
  return { exists: true, parsed: {} };
}

/**
 * Build the effective-config view. For each known key: present on disk →
 * `{ value: onDisk, isDefault: false }`; absent → `{ value: default,
 * isDefault: true }`. `raw` is the resolved config object (on-disk values
 * layered over defaults) for the raw-JSON view.
 */
export function readEffectiveConfig(filePath: string): EffectiveConfig {
  const { exists, parsed } = readRaw(filePath);
  const fields: Record<string, FieldView> = {};
  const raw: Record<string, unknown> = {};
  for (const key of KNOWN_KEYS) {
    const def = (DEFAULTS as Record<string, unknown>)[key];
    const present = Object.hasOwn(parsed, key);
    const value = present ? parsed[key] : def;
    fields[key] = { value, default: def, isDefault: !present };
    if (value !== undefined) raw[key] = value;
  }
  return { filePath, exists, raw, fields };
}

/**
 * Atomically write the full config object as pretty (2-space) JSON. Creates the
 * parent directory if missing, writes a temp file in the SAME directory, then
 * renames it into place (atomic on POSIX — the final file never appears
 * partially written).
 */
export function writeResolvedConfig(filePath: string, obj: Partial<MemoryConfig>): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, "utf-8");
    fs.renameSync(tmp, filePath);
  } catch (e) {
    // Best-effort cleanup so a failed write (ENOSPC/EACCES) leaves no tmp file.
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // ignore cleanup failure — surface the original error
    }
    throw e;
  }
}
