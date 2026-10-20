/**
 * Read + compose + atomic-write of the hermes config file.
 *
 * The file is owned by the `pi-hermes-memory` extension (it only reads it);
 * the dashboard must never delete content it does not understand.
 *
 * - `readDisk` — ONE strict read for GET and PUT (design D3): ENOENT → `{}`;
 *   any other read error → `HermesConfigError` (route → 500, no write);
 *   readable but not a JSON plain object → `malformed` (GET tolerant, PUT
 *   quarantines the bytes it already read). A BOM is NOT stripped — the
 *   dashboard's view must equal hermes's (`loadConfig` falls back to defaults).
 * - `readEffectiveConfig` — per known field `{ value, default, isDefault }`,
 *   upstream-equivalent derivations (strategy ⇄ autoConsolidate, array-form
 *   `llmModelOverride` + legacy fallback aliases; design D1/D9), and `raw` =
 *   preserved unknown keys + resolved known values (design D4, display-only).
 * - `composeWritten` — PURE: preserved unknown on-disk keys + non-default body
 *   fields, strategy always kept, empty fallbacks dropped, one-time legacy
 *   `consolidationTimeoutMs` heal (design D1/D6).
 * - `writeResolvedConfig` — read → (quarantine) → compose → atomic write
 *   (tmp in same dir + rename). Synchronous end to end: no `await` between
 *   the disk read and the rename, so in-process PUTs cannot interleave.
 *
 * Prototype safety (design D2): objects that may carry on-disk keys are built
 * with `Object.fromEntries` + spread (CreateDataProperty), never `out[k] = v`,
 * so an on-disk `"__proto__"` key round-trips as data and pollutes nothing.
 *
 * See change: add-hermes-memory-settings-plugin, resync-hermes-memory-config-0-9.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  DEFAULTS,
  FIELD_DESCRIPTORS,
  KNOWN_KEYS,
  LEGACY_0_8_1_DEFAULTED_KEYS,
  LEGACY_CONSOLIDATION_TIMEOUT_MS,
} from "../shared/hermes-config.js";

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

/** Typed failure the route maps to HTTP 500 `{ error, code }` (design D3). */
export class HermesConfigError extends Error {
  readonly error: "hermes config file unreadable" | "hermes config quarantine failed";
  readonly code: string;
  constructor(error: HermesConfigError["error"], code: string) {
    super(`${error} (${code})`);
    this.name = "HermesConfigError";
    this.error = error;
    this.code = code;
  }
}

type DiskRead =
  | { kind: "absent" }
  | { kind: "object"; disk: Record<string, unknown> }
  | { kind: "malformed"; bytes: Buffer; reason: "unparseable" | "not-an-object" };

const KNOWN = new Set<string>(KNOWN_KEYS as string[]);
const DEFAULTS_MAP = DEFAULTS as Record<string, unknown>;

function errnoCode(e: unknown): string {
  const code = (e as NodeJS.ErrnoException)?.code;
  return typeof code === "string" ? code : "EUNKNOWN";
}

/** Strict read (design D3). No `existsSync` pre-check — one syscall decides. */
function readDisk(filePath: string): DiskRead {
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(filePath);
  } catch (e) {
    const code = errnoCode(e);
    if (code === "ENOENT") return { kind: "absent" };
    throw new HermesConfigError("hermes config file unreadable", code);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf-8"));
  } catch {
    return { kind: "malformed", bytes, reason: "unparseable" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { kind: "malformed", bytes, reason: "not-an-object" };
  }
  return { kind: "object", disk: parsed as Record<string, unknown> };
}

/** Own on-disk entries whose key the plugin does not mirror (prototype-safe). */
function unknownEntriesOf(disk: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(disk).filter(([key]) => !KNOWN.has(key)));
}

const STRATEGIES = (FIELD_DESCRIPTORS.memoryOverflowStrategy as { values: readonly string[] }).values;

function cleanStrings(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) return null;
  return (value as string[]).map((s) => s.trim()).filter(Boolean);
}

/**
 * Strategy ⇄ `autoConsolidate` (upstream config.ts:234-237; design D1): a valid
 * on-disk strategy decides `autoConsolidate`; without one, a boolean
 * `autoConsolidate` decides the strategy. An out-of-enum strategy is reported
 * verbatim, no derivation (R4).
 */
function deriveStrategy(disk: Record<string, unknown>, fields: Record<string, FieldView>): void {
  const strategy = disk.memoryOverflowStrategy;
  if (Object.hasOwn(disk, "memoryOverflowStrategy")) {
    if (typeof strategy !== "string" || !STRATEGIES.includes(strategy)) return;
    const derived = strategy === "auto-consolidate";
    // Absent on disk AND derived == default → still "default" (nothing to pin; test-plan E14).
    const isDefault = !Object.hasOwn(disk, "autoConsolidate") && derived === DEFAULTS_MAP.autoConsolidate;
    fields.autoConsolidate = { ...fields.autoConsolidate, value: derived, isDefault };
  } else if (typeof disk.autoConsolidate === "boolean") {
    fields.memoryOverflowStrategy = {
      ...fields.memoryOverflowStrategy,
      value: disk.autoConsolidate ? "auto-consolidate" : "reject",
      isDefault: false,
    };
  }
}

/**
 * Array-form `llmModelOverride` → string primary + fallback tail, and the
 * legacy `llmModelFallbacks` / `fallbackModels` aliases unioned into
 * `llmFallbackModels` in upstream order (config.ts:205-226; design D9). A plain
 * on-disk `llmFallbackModels` with no array override / alias keeps its
 * verbatim view.
 */
function deriveModelOverride(disk: Record<string, unknown>, fields: Record<string, FieldView>): void {
  const overrideArray = cleanStrings(disk.llmModelOverride);
  const hasAlias = Object.hasOwn(disk, "llmModelFallbacks") || Object.hasOwn(disk, "fallbackModels");
  if (!overrideArray && !hasAlias) return;

  let fallbacks: string[] = [];
  if (overrideArray) {
    const [primary, ...tail] = overrideArray;
    fields.llmModelOverride =
      primary === undefined
        ? { ...fields.llmModelOverride, value: DEFAULTS_MAP.llmModelOverride, isDefault: true }
        : { ...fields.llmModelOverride, value: primary, isDefault: false };
    fallbacks = tail;
  }
  for (const key of ["llmFallbackModels", "llmModelFallbacks", "fallbackModels"]) {
    fallbacks = [...new Set([...fallbacks, ...(cleanStrings(disk[key]) ?? [])])];
  }
  if (fallbacks.length > 0) {
    fields.llmFallbackModels = { ...fields.llmFallbackModels, value: fallbacks, isDefault: false };
  }
}

/**
 * Build the effective-config view. For each known key: present on disk →
 * `{ value: onDisk, isDefault: false }`; absent → `{ value: default,
 * isDefault: true }`; then upstream-equivalent derivations. `raw` = preserved
 * unknown keys + resolved known values — display-only, NOT a valid PUT body.
 * Throws `HermesConfigError` when the file exists but cannot be read.
 */
export function readEffectiveConfig(filePath: string): EffectiveConfig {
  const read = readDisk(filePath);
  const disk = read.kind === "object" ? read.disk : {};
  const fields: Record<string, FieldView> = {};
  for (const key of KNOWN_KEYS) {
    const def = DEFAULTS_MAP[key];
    const present = Object.hasOwn(disk, key);
    fields[key] = { value: present ? disk[key] : def, default: def, isDefault: !present };
  }
  deriveStrategy(disk, fields);
  deriveModelOverride(disk, fields);
  const resolvedKnown = Object.fromEntries(
    Object.entries(fields)
      .filter(([, view]) => view.value !== undefined)
      .map(([key, view]) => [key, view.value]),
  );
  const raw = { ...unknownEntriesOf(disk), ...resolvedKnown };
  return { filePath, exists: read.kind !== "absent", raw, fields };
}

function jsonEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isLegacyWriteAll(disk: Record<string, unknown>): boolean {
  return LEGACY_0_8_1_DEFAULTED_KEYS.every((key) => Object.hasOwn(disk, key));
}

/**
 * PURE compose of the object to write (design D1/D6):
 * 1. preserved = own on-disk entries outside `KNOWN_KEYS` (verbatim);
 * 2. known = body entries, minus default-valued ones and an empty
 *    `llmFallbackModels` — except `memoryOverflowStrategy`, always kept so the
 *    upstream `autoConsolidate` derivation can never flip the strategy;
 * 3. legacy heal: drop `consolidationTimeoutMs` iff `disk` carries the 0.8.1
 *    write-all signature and both disk and body hold the old 60000;
 * 4. written = `{ ...preserved, ...known }`.
 * Known keys come ONLY from the body — a key the body omits is never carried
 * over from disk (keeps clear-to-inherit + per-field reset working).
 */
function composeWritten(
  disk: Record<string, unknown>,
  body: Record<string, unknown>,
): Record<string, unknown> {
  const heal =
    isLegacyWriteAll(disk) &&
    disk.consolidationTimeoutMs === LEGACY_CONSOLIDATION_TIMEOUT_MS &&
    body.consolidationTimeoutMs === LEGACY_CONSOLIDATION_TIMEOUT_MS;
  const known = Object.fromEntries(
    Object.entries(body).filter(([key, value]) => {
      if (key === "memoryOverflowStrategy") return true;
      if (heal && key === "consolidationTimeoutMs") return false;
      if (key === "llmFallbackModels" && Array.isArray(value) && value.length === 0) return false;
      return !(Object.hasOwn(DEFAULTS_MAP, key) && jsonEquals(value, DEFAULTS_MAP[key]));
    }),
  );
  return { ...unknownEntriesOf(disk), ...known };
}

/** `YYYYMMDDTHHMMSSsssZ` — colon-free so the backup name is valid on Windows. */
function quarantineStamp(now: Date): string {
  return now.toISOString().replace(/[-:.]/g, "");
}

export interface WriteDeps {
  /** Injected clock for the quarantine stamp (tests). */
  now?: () => Date;
  /** One log line per quarantine: path + reason, never values. */
  log?: (message: string) => void;
  /** Exclusive-create write of the quarantine copy (seam for fault injection). */
  writeQuarantine?: (dest: string, bytes: Buffer) => void;
}

const defaultWriteQuarantine = (dest: string, bytes: Buffer): void => {
  fs.writeFileSync(dest, bytes, { flag: "wx", mode: 0o600 });
};

/**
 * Copy the already-read malformed bytes (never re-read: no read→copy TOCTOU)
 * to `<file>.corrupt-<stamp>[-N]`, exclusive-create, mode 0600. Never renames
 * or overwrites. Mirrors the provider-auth corrupt-content recovery, minus its
 * BOM strip and SHA-256 dedup (design D3, R8).
 */
function quarantine(filePath: string, bytes: Buffer, reason: string, deps: WriteDeps): void {
  const base = `${filePath}.corrupt-${quarantineStamp((deps.now ?? (() => new Date()))())}`;
  const write = deps.writeQuarantine ?? defaultWriteQuarantine;
  for (let n = 0; ; n++) {
    const dest = n === 0 ? base : `${base}-${n}`;
    try {
      write(dest, bytes);
      deps.log?.(`hermes-memory config quarantined path=${dest} reason=${reason}`);
      return;
    } catch (e) {
      const code = errnoCode(e);
      if (code === "EEXIST") continue;
      throw new HermesConfigError("hermes config quarantine failed", code);
    }
  }
}

/**
 * Read the on-disk file, quarantine it when malformed, compose (design D1/D6)
 * and write pretty (2-space) JSON atomically: tmp file in the SAME directory,
 * then rename (the final file never appears partially written). Creates the
 * parent directory if missing. Throws `HermesConfigError` (no write) when the
 * file is unreadable or the quarantine copy fails. Returns the written object.
 */
export function writeResolvedConfig(
  filePath: string,
  body: Record<string, unknown>,
  deps: WriteDeps = {},
): Record<string, unknown> {
  const read = readDisk(filePath);
  if (read.kind === "malformed") quarantine(filePath, read.bytes, read.reason, deps);
  const disk = read.kind === "object" ? read.disk : {};
  const written = composeWritten(disk, body);

  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(written, null, 2)}\n`, "utf-8");
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
  return written;
}
