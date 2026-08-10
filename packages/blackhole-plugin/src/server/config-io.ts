/**
 * Read + read-modify-write of the blackhole config file.
 *
 * `readConfig` FAILS CLOSED (design D6): an unparseable file yields a
 * `parse-error` result carrying the parser message and NO config object — never
 * a fallback to defaults, which would misreport what the user's sessions run.
 *
 * `saveConfig` is a read-modify-write (design D5): it re-reads the file WITHIN
 * the request, layers only the managed keys over the on-disk object (so unknown
 * and annotation keys survive with their values AND their relative order), and
 * writes temp-then-rename so a concurrent reader never observes a partial file.
 *
 * The cross-process race is narrowed, not closed: blackhole writes this same
 * file. `saveConfig` re-stats immediately before the rename and reports
 * `externalWriteDetected`, and its `preservedUnmanagedKeys` list names only the
 * keys observed at the REQUEST'S read — so an interleaved external write is
 * never reported as having been merged.
 *
 * See change: add-blackhole-plugin.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { DEFAULTS, KNOWN_KEYS } from "../shared/blackhole-config.js";

export interface FieldView {
  value: unknown;
  default: unknown;
  isDefault: boolean;
}

export interface ConfigOk {
  status: "ok";
  filePath: string;
  /** False when the file does not exist — every field reads its default. */
  exists: boolean;
  fields: Record<string, FieldView>;
  /** Keys present in the file that this plugin does not manage. */
  unmanagedKeys: string[];
}

export interface ConfigParseError {
  status: "parse-error";
  filePath: string;
  /** The parser's own message, surfaced verbatim to the recovery UI. */
  message: string;
}

export type ConfigResult = ConfigOk | ConfigParseError;

interface RawRead {
  exists: boolean;
  parsed: Record<string, unknown>;
  parseError: string | null;
}

/** Parse the on-disk file. Absence is fine; malformed content is NOT. */
function readRaw(filePath: string): RawRead {
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { exists: false, parsed: {}, parseError: null };
    }
    throw e;
  }
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { exists: true, parsed: {}, parseError: "config root must be a JSON object" };
    }
    return { exists: true, parsed: parsed as Record<string, unknown>, parseError: null };
  } catch (e) {
    return { exists: true, parsed: {}, parseError: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Build the effective-config view. Per managed key: present on disk →
 * `{ value: onDisk, isDefault: false }`; absent → `{ value: default,
 * isDefault: true }`. Never creates the file.
 */
export function readConfig(filePath: string): ConfigResult {
  const { exists, parsed, parseError } = readRaw(filePath);
  if (parseError !== null) return { status: "parse-error", filePath, message: parseError };

  const fields: Record<string, FieldView> = {};
  for (const key of KNOWN_KEYS) {
    const def = (DEFAULTS as Record<string, unknown>)[key];
    const present = Object.hasOwn(parsed, key);
    fields[key] = { value: present ? parsed[key] : def, default: def, isDefault: !present };
  }
  const managed = new Set<string>(KNOWN_KEYS as string[]);
  const unmanagedKeys = Object.keys(parsed).filter((k) => !managed.has(k));
  return { status: "ok", filePath, exists, fields, unmanagedKeys };
}

export interface SaveResult {
  /**
   * Keys carried over from the content read WITHIN this request. A key an
   * external process added after that read is deliberately absent — the report
   * never claims to have merged a change it did not observe.
   */
  preservedUnmanagedKeys: string[];
  /** True when the file changed on disk between this request's read and write. */
  externalWriteDetected: boolean;
}

export class ConfigParseErrorOnWrite extends Error {
  readonly parserMessage: string;
  constructor(parserMessage: string) {
    super(`config file cannot be parsed: ${parserMessage}`);
    this.name = "ConfigParseErrorOnWrite";
    this.parserMessage = parserMessage;
  }
}

function fingerprint(filePath: string): string | null {
  try {
    const s = fs.statSync(filePath);
    return `${s.size}:${s.mtimeMs}`;
  } catch {
    return null;
  }
}

/**
 * Apply `managed` over the file's current content and write the merged object
 * atomically. A key set to `undefined` or `null` is REMOVED (the user cleared an
 * optional model or chain — `null` is the only spelling that survives
 * `JSON.stringify` on the wire); every other on-disk key keeps its value and its
 * position, so keys the plugin does not manage survive and newly set keys are
 * appended.
 *
 * Throws `ConfigParseErrorOnWrite` without touching the file when the current
 * content cannot be parsed (design D6 — a write would clobber model chains the
 * user can still recover by hand).
 */
export function saveConfig(filePath: string, managed: Record<string, unknown>): SaveResult {
  // Fingerprint BEFORE the read so the pre-write comparison spans the whole
  // merge window. It over-reports rather than under-reports: a write landing
  // during the read itself is flagged even though it made it into `parsed`.
  const before = fingerprint(filePath);
  const { parsed, parseError } = readRaw(filePath);
  if (parseError !== null) throw new ConfigParseErrorOnWrite(parseError);

  const managedKeys = new Set<string>(KNOWN_KEYS as string[]);
  const preservedUnmanagedKeys = Object.keys(parsed).filter((k) => !managedKeys.has(k));

  const merged: Record<string, unknown> = { ...parsed };
  for (const [key, value] of Object.entries(managed)) {
    if (value === undefined || value === null) delete merged[key];
    else merged[key] = value;
  }

  // Re-stat immediately BEFORE the write: a change since this request's read
  // means an external process (blackhole itself, `/blackhole configure`) wrote
  // in the interval, and that change is about to be lost. Narrowed, not closed.
  const externalWriteDetected = fingerprint(filePath) !== before;

  writeAtomic(filePath, merged);
  return { preservedUnmanagedKeys, externalWriteDetected };
}

/**
 * Write pretty (2-space) JSON atomically: temp file in the SAME directory, then
 * `fs.rename`. A failed write (ENOSPC / EACCES) leaves no temp file behind.
 */
export function writeAtomic(filePath: string, obj: Record<string, unknown>): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, "utf-8");
    fs.renameSync(tmp, filePath);
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // ignore cleanup failure — surface the original error
    }
    throw e;
  }
}
