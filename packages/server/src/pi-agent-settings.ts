/**
 * pi-agent-settings — read/write pi's OWN global `settings.json`
 * (`<agentDir>/settings.json`, agentDir = `$PI_CODING_AGENT_DIR` else
 * `~/.pi/agent`).
 *
 * Two capabilities share this module:
 *   - `pi-retry-settings`: the native retry block (`readPiRetryPolicy` /
 *     `writePiRetryPolicy`).
 *   - `pi-agent-settings-editor`: a typed leaf-patch writer, a validated raw
 *     writer, the concurrency token and the dashboard→pi default-model mirror.
 * It is intentionally distinct from `config-api.ts`, which writes the
 * DASHBOARD's own `~/.pi/dashboard/config.json`.
 *
 * Invariants:
 *   - GLOBAL only. `<cwd>/.pi/settings.json` is NEVER read or written.
 *   - Every write takes the SAME `proper-lockfile` lock pi takes
 *     (`<settings.json>.lock`, `realpath:false`, `stale:10_000`), so dashboard
 *     and pi writes never interleave; tmp-file + `rename` makes the replace
 *     atomic and a failed write leaves the target untouched.
 *   - The critical section is only re-read + token check + pure transform +
 *     replace; callers validate BEFORE taking the lock (pi's own lock budget
 *     is ~200 ms).
 *   - Merge-preserving: keys the dashboard does not edit survive.
 *   - The three mirrored default keys are excluded from the concurrency token.
 *
 * See change: retry-forever-with-stop-control (retry); edit-pi-agent-settings
 * (editor, lock, mirror; design D1–D6).
 */
import { createHash, randomBytes } from "node:crypto";
import { promises as fsp, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { resolvePiAgentDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import { PI_MANAGED_SETTINGS_KEYS } from "@blackbelt-technology/pi-dashboard-shared/pi-settings-keys.js";
import type { PiMirrorResult, PiRetryPolicy, PiSettingsPatch } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { THINKING_LEVELS } from "@blackbelt-technology/pi-dashboard-shared/role-schema.js";

const _require = createRequire(import.meta.url);
const _lockfile = _require("proper-lockfile") as typeof import("proper-lockfile");

/** pi's own defaults, applied when a key is absent. */
export const PI_RETRY_DEFAULTS: PiRetryPolicy = {
  enabled: true,
  maxRetries: 3,
  baseDelayMs: 2000,
  provider: {
    // timeoutMs intentionally absent → pi uses the SDK default.
    maxRetries: 0,
    maxRetryDelayMs: 60000,
  },
};

/** Async fs surface of the locked write path; injectable so failure paths are testable. */
interface PiSettingsFs {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, data: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  chmod: (path: string, mode: number) => Promise<void>;
  stat: (path: string) => Promise<{ mode: number }>;
  lstat: (path: string) => Promise<{ isSymbolicLink(): boolean }>;
  realpath: (path: string) => Promise<string>;
  readlink: (path: string) => Promise<string>;
  mkdir: (path: string) => Promise<void>;
  unlink: (path: string) => Promise<void>;
}

const defaultFs: PiSettingsFs = {
  readFile: (p) => fsp.readFile(p, "utf-8"),
  writeFile: (p, d) => fsp.writeFile(p, d, "utf-8"),
  rename: (a, b) => fsp.rename(a, b),
  chmod: (p, m) => fsp.chmod(p, m),
  stat: (p) => fsp.stat(p),
  lstat: (p) => fsp.lstat(p),
  realpath: (p) => fsp.realpath(p),
  readlink: (p) => fsp.readlink(p),
  mkdir: async (p) => {
    await fsp.mkdir(p, { recursive: true });
  },
  unlink: (p) => fsp.unlink(p),
};

export interface FsDeps {
  /** Override for tests. Defaults to `os.homedir()`. */
  home?: string;
  /** Test seam for `PI_CODING_AGENT_DIR`. */
  agentDirEnv?: string;
  /** Override individual async fs calls (failure-path tests). */
  fs?: Partial<PiSettingsFs>;
}

/** Absolute path of the global pi settings file (UNRESOLVED — also the lock path). */
function piSettingsPath(deps: FsDeps = {}): string {
  return join(resolvePiAgentDir({ homedir: deps.home, agentDirEnv: deps.agentDirEnv }), "settings.json");
}

function asObject(v: unknown): Record<string, unknown> {
  return isPlainObject(v) ? v : {};
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export interface ValidationError {
  field: string;
  message: string;
}

// ── Reading + the concurrency token ──────────────────────────────────

/** Snapshot of the settings file. */
export interface PiSettingsState {
  /** Parsed object; `{}` when absent or unparseable. */
  settings: Record<string, unknown>;
  /** Raw text as on disk (BOM kept); `""` when absent. */
  raw: string;
  /** Concurrency token (design D4). */
  etag: string;
  /** Set when the file exists but is not a valid JSON object. */
  parseError?: string;
  /** False when the file does not exist. */
  exists: boolean;
}

const stripBom = (s: string): string => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (isPlainObject(v)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

function parseText(raw: string): { obj?: Record<string, unknown>; error?: string } {
  try {
    const parsed: unknown = JSON.parse(stripBom(raw));
    if (!isPlainObject(parsed)) return { error: "settings.json must contain a JSON object" };
    return { obj: parsed };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Invalid JSON" };
  }
}

/**
 * Concurrency token: sha256 of the canonical form (BOM stripped, parsed, the
 * mirrored default keys removed, keys sorted recursively). `"absent"` for no
 * file; sha256 of the raw bytes when unparseable. Sorting makes reformatting
 * and key reordering non-conflicts. See change: edit-pi-agent-settings (D4).
 */
export function computePiSettingsEtag(raw: string | null): string {
  if (raw === null) return "absent";
  const { obj } = parseText(raw);
  if (!obj) return createHash("sha256").update(raw).digest("hex");
  const rest = { ...obj };
  for (const k of PI_MANAGED_SETTINGS_KEYS) delete rest[k];
  return createHash("sha256").update(JSON.stringify(sortKeys(rest))).digest("hex");
}

function buildState(raw: string | null): PiSettingsState {
  if (raw === null) return { settings: {}, raw: "", etag: "absent", exists: false };
  const { obj, error } = parseText(raw);
  return {
    settings: obj ?? {},
    raw,
    etag: computePiSettingsEtag(raw),
    ...(error ? { parseError: error } : {}),
    exists: true,
  };
}

function readRawSync(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** Read the global settings file. Never throws on absent/unparseable content. */
export function readPiSettings(deps: FsDeps = {}): PiSettingsState {
  return buildState(readRawSync(piSettingsPath(deps)));
}

// ── Lock-coordinated atomic write (design D5) ────────────────────────

export type LockedStep<T, F> = { fail: F } | { value: T; /** New file text; omit for "no write". */ write?: string };

export type LockedResult<T, F> =
  | { ok: true; value: T; /** Post-write state (or current when nothing was written). */ state: PiSettingsState }
  | { ok: false; error: "busy" }
  | { ok: false; error: "io"; message: string }
  | { ok: false; error: "stale"; state: PiSettingsState }
  | { ok: false; error: "fn"; fail: F };

export interface LockOptions {
  /** Reject with `stale` when the current token differs. */
  baseEtag?: string;
}

const LOCK_OPTIONS = {
  realpath: false,
  stale: 10_000,
  retries: { retries: 10, minTimeout: 20, maxTimeout: 20 },
} as const;

const formatJson = (obj: unknown): string => `${JSON.stringify(obj, null, 2)}\n`;

async function resolveWriteTarget(path: string, fs: PiSettingsFs): Promise<string> {
  try {
    if (!(await fs.lstat(path)).isSymbolicLink()) return path;
  } catch {
    return path; // absent
  }
  try {
    return await fs.realpath(path);
  } catch {
    // Dangling link: write through to where it points, as pi's writeFileSync does.
    return resolve(dirname(path), await fs.readlink(path));
  }
}

const errMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Acquire pi's lock on the settings path; `busy` when held past the retry budget. */
async function acquireLock(
  path: string,
  fs: PiSettingsFs,
): Promise<{ release: () => Promise<void> } | { fail: LockedResult<never, never> }> {
  try {
    await fs.mkdir(dirname(path));
    const release = await _lockfile.lock(path, {
      ...LOCK_OPTIONS,
      onCompromised: (err) => {
        console.warn(`[pi-settings] lock compromised (${(err as { code?: string }).code ?? "unknown"})`);
      },
    });
    return { release };
  } catch (err) {
    if ((err as { code?: unknown } | null)?.code === "ELOCKED") return { fail: { ok: false, error: "busy" } };
    return { fail: { ok: false, error: "io", message: errMessage(err) } };
  }
}

const isEnoent = (err: unknown): boolean => (err as NodeJS.ErrnoException).code === "ENOENT";

async function readCurrent(path: string, fs: PiSettingsFs): Promise<string | null> {
  try {
    return await fs.readFile(path);
  } catch (err) {
    if (isEnoent(err)) return null;
    throw err;
  }
}

/** tmp file in the target's directory + chmod to the target's mode + `rename`. */
async function replaceAtomically(path: string, text: string, existed: boolean, fs: PiSettingsFs): Promise<void> {
  const target = await resolveWriteTarget(path, fs);
  const tmp = join(dirname(target), `.${randomBytes(6).toString("hex")}.settings.tmp`);
  try {
    await fs.writeFile(tmp, text);
    if (existed) {
      try {
        await fs.chmod(tmp, (await fs.stat(target)).mode & 0o7777);
      } catch (err) {
        if (!isEnoent(err)) throw err;
      }
    }
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}

/**
 * Run `fn` under the pi settings lock. `fn` is PURE and synchronous (re-read
 * state in, new text out). Not acquired within the retry budget → `busy`;
 * a failing tmp write → `io` with the target untouched.
 */
export async function withPiSettingsLock<T, F = never>(
  fn: (state: PiSettingsState) => LockedStep<T, F>,
  options: LockOptions = {},
  deps: FsDeps = {},
): Promise<LockedResult<T, F>> {
  const fs: PiSettingsFs = { ...defaultFs, ...deps.fs };
  const path = piSettingsPath(deps);

  const lock = await acquireLock(path, fs);
  if ("fail" in lock) return lock.fail;

  try {
    const state = buildState(await readCurrent(path, fs));
    if (options.baseEtag !== undefined && options.baseEtag !== state.etag) {
      return { ok: false, error: "stale", state };
    }
    const step = fn(state);
    if ("fail" in step) return { ok: false, error: "fn", fail: step.fail };
    if (step.write === undefined) return { ok: true, value: step.value, state };
    await replaceAtomically(path, step.write, state.exists, fs);
    return { ok: true, value: step.value, state: buildState(step.write) };
  } catch (err) {
    return { ok: false, error: "io", message: errMessage(err) };
  } finally {
    await lock.release().catch(() => {});
  }
}

// ── Typed form patch (design D3) ─────────────────────────────────────

type LeafCheck = (v: unknown) => string | null;

const isBool: LeafCheck = (v) => (typeof v === "boolean" ? null : "must be a boolean");
const isNonNegInt: LeafCheck = (v) =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? null : "must be a non-negative integer";
const oneOf =
  (...allowed: readonly string[]): LeafCheck =>
  (v) =>
    typeof v === "string" && allowed.includes(v) ? null : `must be one of ${allowed.map((a) => `"${a}"`).join(", ")}`;

const MODE = oneOf("all", "one-at-a-time");

const TYPED_BLOCKS: Record<string, Record<string, LeafCheck>> = {
  compaction: { enabled: isBool, reserveTokens: isNonNegInt, keepRecentTokens: isNonNegInt },
  branchSummary: { reserveTokens: isNonNegInt, skipPrompt: isBool },
};

const TYPED_TOP: Record<string, LeafCheck> = {
  steeringMode: MODE,
  followUpMode: MODE,
  defaultProjectTrust: oneOf("ask", "always", "never"),
  hideThinkingBlock: isBool,
  quietStartup: (v) => (v === true || v === false || v === "header" ? null : 'must be true, false or "header"'),
};

const isManaged = (k: string): boolean => (PI_MANAGED_SETTINGS_KEYS as readonly string[]).includes(k);

const JSON_HINT = "use the JSON editor for this key";

const fieldError = (field: string, message: string): ValidationError => ({ field, message });

/** Check each leaf of one `compaction`/`branchSummary` block. `strict`: unknown leaves are errors (the form). */
function checkBlockLeaves(
  key: string,
  value: Record<string, unknown>,
  allowNull: boolean,
  strict: boolean,
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const [leaf, lv] of Object.entries(value)) {
    const check = TYPED_BLOCKS[key]?.[leaf];
    if (!check) {
      if (strict) errors.push(fieldError(`${key}.${leaf}`, `${key}.${leaf} is not a form field; ${JSON_HINT}`));
      continue;
    }
    if (lv === undefined || (allowNull && lv === null)) continue;
    const msg = check(lv);
    if (msg) errors.push(fieldError(`${key}.${leaf}`, `${key}.${leaf} ${msg}`));
  }
  return errors;
}

function checkPatchBlock(key: string, value: unknown): ValidationError[] {
  if (value === null) return [fieldError(key, `${key} cannot be removed as a whole block; clear its fields instead`)];
  if (!isPlainObject(value)) return [fieldError(key, `${key} must be an object`)];
  return checkBlockLeaves(key, value, true, true);
}

function checkPatchKey(key: string, value: unknown): ValidationError[] {
  if (isManaged(key)) {
    return [fieldError(key, `${key} is managed by the Default model control and cannot be edited here`)];
  }
  if (key in TYPED_BLOCKS) return checkPatchBlock(key, value);
  const check = TYPED_TOP[key];
  if (!check) return [fieldError(key, `${key} is not a form field; ${JSON_HINT}`)];
  const msg = value === null ? null : check(value);
  return msg ? [fieldError(key, `${key} ${msg}`)] : [];
}

/** Validate a typed leaf patch. Returns `[]` when valid. */
function validatePiSettingsPatch(patch: unknown): ValidationError[] {
  if (!isPlainObject(patch)) return [fieldError("patch", "patch must be an object")];
  return Object.entries(patch)
    .filter(([, value]) => value !== undefined)
    .flatMap(([key, value]) => checkPatchKey(key, value));
}

function applyBlockPatch(
  existing: unknown,
  leaves: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const block: Record<string, unknown> = { ...asObject(existing) };
  for (const [leaf, lv] of Object.entries(leaves)) {
    if (lv === null) delete block[leaf];
    else if (lv !== undefined) block[leaf] = lv;
  }
  // A patch of only deletions must not conjure an empty block.
  return existing === undefined && Object.keys(block).length === 0 ? undefined : block;
}

function applyLeafPatch(current: Record<string, unknown>, patch: PiSettingsPatch): Record<string, unknown> {
  const next: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === undefined) continue;
    if (key in TYPED_BLOCKS) {
      const block = applyBlockPatch(next[key], value as Record<string, unknown>);
      if (block) next[key] = block;
    } else if (value === null) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }
  return next;
}

/** Outcome of a typed/raw write. */
export type PiSettingsWriteResult =
  | { ok: true; state: PiSettingsState; restoredKeys?: string[] }
  | { ok: false; error: "invalid"; errors: ValidationError[] }
  | { ok: false; error: "parse"; parseError: string }
  | { ok: false; error: "stale"; state: PiSettingsState }
  | { ok: false; error: "busy" }
  | { ok: false; error: "io"; message: string };

type ParseFail = { error: "parse"; parseError: string };

function toWriteResult<T>(
  r: LockedResult<T, ParseFail>,
  extra: (value: T) => { restoredKeys?: string[] },
): PiSettingsWriteResult {
  if (r.ok) return { ok: true, state: r.state, ...extra(r.value) };
  if (r.error === "fn") return { ok: false, error: "parse", parseError: r.fail.parseError };
  return r;
}

/**
 * Typed leaf patch (design D3). Validated BEFORE the lock; merge-preserving;
 * refuses an unparseable current file (repair happens in the raw editor).
 */
export async function applyPiSettingsPatch(
  patch: unknown,
  baseEtag: string,
  deps: FsDeps = {},
): Promise<PiSettingsWriteResult> {
  const errors = validatePiSettingsPatch(patch);
  if (errors.length > 0) return { ok: false, error: "invalid", errors };
  const r = await withPiSettingsLock<null, ParseFail>(
    (state) => {
      if (state.parseError) return { fail: { error: "parse", parseError: state.parseError } };
      const next = applyLeafPatch(state.settings, patch as PiSettingsPatch);
      // A patch that changes nothing must not rewrite the file (formatting, mtime, watchers).
      if (sameJson(next, state.settings)) return { value: null };
      return { value: null, write: formatJson(next) };
    },
    { baseEtag },
    deps,
  );
  return toWriteResult(r, () => ({}));
}

// ── Raw editor (design D6) ───────────────────────────────────────────

const isStringArray = (v: unknown): boolean => Array.isArray(v) && v.every((x) => typeof x === "string");
const isPosInt = (v: unknown): boolean => typeof v === "number" && Number.isInteger(v) && v >= 1;
const isNonNeg = (v: unknown): boolean => isNonNegInt(v) === null;

/** A rule returns an error message, or null when the value is fine. */
type Rule = (v: unknown) => string | null;
const rule =
  (ok: (v: unknown) => boolean, message: string): Rule =>
  (v) =>
    ok(v) ? null : message;

/** Raw-editor type rules for non-form keys (design D6). Unlisted keys are NOT checked. */
const RAW_KEY_RULES: Record<string, Rule> = {
  extensions: rule(isStringArray, "must be an array of strings"),
  prompts: rule(isStringArray, "must be an array of strings"),
  themes: rule(isStringArray, "must be an array of strings"),
  enabledModels: rule(isStringArray, "must be an array of strings"),
  defaultTools: rule(isStringArray, "must be an array of strings"),
  npmCommand: rule(isStringArray, "must be an array of strings"),
  skills: rule((v) => isStringArray(v) || isPlainObject(v), "must be an array of strings (or the legacy object form)"),
  packages: rule(
    (v) => Array.isArray(v) && v.every((p) => typeof p === "string" || isPlainObject(p)),
    "must be an array of strings or objects",
  ),
  shellPath: rule((v) => typeof v === "string", "must be a string"),
  shellCommandPrefix: rule((v) => typeof v === "string", "must be a string"),
  modelThinkingLevels: rule(
    (v) => isPlainObject(v) && Object.values(v).every((l) => typeof l === "string" && (THINKING_LEVELS as readonly string[]).includes(l)),
    "must map model ids to valid thinking levels",
  ),
};

/** `retry` fields checked when PRESENT (path under `retry`). Absent/unknown fields pass. */
const RETRY_RULES: ReadonlyArray<readonly [readonly string[], Rule]> = [
  [["enabled"], rule((v) => typeof v === "boolean", "must be a boolean")],
  [["maxRetries"], rule(isNonNeg, "must be a non-negative integer")],
  [["maxAgentDelayMs"], rule(isNonNeg, "must be a non-negative integer")],
  [["baseDelayMs"], rule(isPosInt, "must be a positive integer")],
  [["provider", "timeoutMs"], rule(isPosInt, "must be a positive integer")],
  [["provider", "maxRetries"], rule(isNonNeg, "must be a non-negative integer")],
  [["provider", "maxRetryDelayMs"], rule(isNonNeg, "must be a non-negative integer")],
];

function validateRetryPartial(retry: unknown): ValidationError[] {
  if (!isPlainObject(retry)) return [fieldError("retry", "retry must be an object")];
  if (retry.provider !== undefined && !isPlainObject(retry.provider)) {
    return [fieldError("retry.provider", "retry.provider must be an object")];
  }
  const errors: ValidationError[] = [];
  for (const [path, check] of RETRY_RULES) {
    const [head, leaf] = path;
    const v = leaf === undefined ? retry[head] : asObject(retry[head])[leaf];
    const msg = v === undefined ? null : check(v);
    if (msg) errors.push(fieldError(`retry.${path.join(".")}`, `retry.${path.join(".")} ${msg}`));
  }
  return errors;
}

function validateRawKeys(obj: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const key of Object.keys(TYPED_BLOCKS)) {
    if (obj[key] === undefined) continue;
    if (isPlainObject(obj[key])) errors.push(...checkBlockLeaves(key, obj[key], false, false));
    else errors.push(fieldError(key, `${key} must be an object`));
  }
  for (const [key, check] of [...Object.entries(TYPED_TOP), ...Object.entries(RAW_KEY_RULES)]) {
    const msg = obj[key] === undefined ? null : check(obj[key]);
    if (msg) errors.push(fieldError(key, `${key} ${msg}`));
  }
  if (obj.retry !== undefined) errors.push(...validateRetryPartial(obj.retry));
  return errors;
}

/**
 * Validate raw settings text. Scoped guarantee: the keys listed in design D6
 * are type-checked; any other key passes untouched.
 */
function validatePiSettingsRaw(
  text: unknown,
): { ok: true; obj: Record<string, unknown> } | { ok: false; errors: ValidationError[] } {
  if (typeof text !== "string") return { ok: false, errors: [fieldError("raw", "raw must be a string")] };
  const { obj, error } = parseText(text);
  if (!obj) return { ok: false, errors: [fieldError("raw", error ?? "Invalid JSON")] };
  const errors = validateRawKeys(obj);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, obj };
}

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));

/**
 * Whole-file raw write. Validated BEFORE the lock. Under the lock the three
 * mirrored keys are replaced with the on-disk values (present or absent) and
 * the keys whose submitted value differed are returned as `restoredKeys`.
 * An unparseable CURRENT file does not block the write (the repair path).
 */
export async function writePiSettingsRaw(
  text: unknown,
  baseEtag: string,
  deps: FsDeps = {},
): Promise<PiSettingsWriteResult> {
  const v = validatePiSettingsRaw(text);
  if (!v.ok) return { ok: false, error: "invalid", errors: v.errors };
  const r = await withPiSettingsLock<string[]>(
    (state) => {
      const next: Record<string, unknown> = { ...v.obj };
      const restored: string[] = [];
      if (!state.parseError) {
        for (const k of PI_MANAGED_SETTINGS_KEYS) {
          const had = k in v.obj;
          const onDisk = k in state.settings;
          if (onDisk) next[k] = state.settings[k];
          else delete next[k];
          if (had !== onDisk || (had && !sameJson(v.obj[k], state.settings[k]))) restored.push(k);
        }
      }
      return { value: restored, write: formatJson(next) };
    },
    { baseEtag },
    deps,
  );
  return toWriteResult(r, (restoredKeys) => ({ restoredKeys }));
}

// ── Dashboard → pi default mirror (design D1) ────────────────────────

export type PiMirrorKey = "defaultModel" | "defaultThinkingLevel";

export interface DashboardDefaults {
  defaultModel?: string;
  defaultThinkingLevel?: string;
}

/** pi keys the dashboard defaults derive, plus a `skipped` flag for a separator-less model. */
function deriveMirrorWanted(
  cfg: DashboardDefaults,
  keys: readonly PiMirrorKey[],
): { want: Record<string, string>; skipped?: "no-provider-separator" } {
  const want: Record<string, string> = {};
  let skipped: "no-provider-separator" | undefined;
  const model = keys.includes("defaultModel") ? (cfg.defaultModel ?? "").trim() : "";
  if (model) {
    const slash = model.indexOf("/");
    if (slash > 0 && slash < model.length - 1) {
      want.defaultProvider = model.slice(0, slash);
      want.defaultModel = model.slice(slash + 1);
    } else {
      skipped = "no-provider-separator";
    }
  }
  const level = keys.includes("defaultThinkingLevel") ? (cfg.defaultThinkingLevel ?? "").trim() : "";
  if ((THINKING_LEVELS as readonly string[]).includes(level)) want.defaultThinkingLevel = level;
  return { want, skipped };
}

/**
 * Mirror the dashboard default model / thinking level into pi's settings.
 * Reads the PERSISTED dashboard config INSIDE the lock (overlapping saves
 * converge on the last value) and writes only keys whose pi value differs.
 * Empty dashboard value → pi untouched; model without `provider/` → skipped;
 * unparseable pi file → never written from `{}`.
 */
export async function mirrorDefaultsToPi(
  readDashboardConfig: () => DashboardDefaults,
  keys: readonly PiMirrorKey[],
  deps: FsDeps = {},
): Promise<PiMirrorResult> {
  const r = await withPiSettingsLock<{ skipped?: "no-provider-separator" }, ParseFail>(
    (state) => {
      const { want, skipped } = deriveMirrorWanted(readDashboardConfig(), keys);
      const changed = Object.entries(want).filter(([k, val]) => state.settings[k] !== val);
      if (changed.length === 0) return { value: { skipped } };
      if (state.parseError) return { fail: { error: "parse", parseError: state.parseError } };
      return { value: { skipped }, write: formatJson({ ...state.settings, ...Object.fromEntries(changed) }) };
    },
    {},
    deps,
  );
  if (r.ok) return { ok: true, ...(r.value.skipped ? { skipped: r.value.skipped } : {}) };
  if (r.error === "fn") return { ok: false, error: "parse" };
  if (r.error === "stale") return { ok: false, error: "io" }; // unreachable: no baseEtag
  return { ok: false, error: r.error };
}

// ── Retry policy (pi-retry-settings) ─────────────────────────────────

/**
 * Read pi's effective retry policy from the global settings file. Absent file /
 * absent keys / unparseable file → pi's defaults. Never throws on content.
 */
export function readPiRetryPolicy(deps: FsDeps = {}): PiRetryPolicy {
  // An unreadable file (permissions, EISDIR…) yields pi's defaults, as before.
  let state: PiSettingsState;
  try {
    state = readPiSettings(deps);
  } catch {
    return PI_RETRY_DEFAULTS;
  }
  const retry = asObject(state.settings.retry);
  const provider = asObject(retry.provider);

  const timeoutMs =
    typeof provider.timeoutMs === "number" && Number.isFinite(provider.timeoutMs)
      ? provider.timeoutMs
      : undefined;

  return {
    enabled: typeof retry.enabled === "boolean" ? retry.enabled : PI_RETRY_DEFAULTS.enabled,
    maxRetries: num(retry.maxRetries, PI_RETRY_DEFAULTS.maxRetries),
    baseDelayMs: num(retry.baseDelayMs, PI_RETRY_DEFAULTS.baseDelayMs),
    provider: {
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      maxRetries: num(provider.maxRetries, PI_RETRY_DEFAULTS.provider.maxRetries),
      maxRetryDelayMs: num(provider.maxRetryDelayMs, PI_RETRY_DEFAULTS.provider.maxRetryDelayMs),
    },
  };
}

function requireNonNegativeInt(v: unknown, field: string, errors: ValidationError[]): void {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
    errors.push({ field, message: `${field} must be a non-negative integer` });
  }
}

/** Validate a candidate policy. Returns `[]` when valid. */
export function validatePiRetryPolicy(input: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  const p = asObject(input);

  if (typeof p.enabled !== "boolean") {
    errors.push({ field: "enabled", message: "enabled must be a boolean" });
  }
  requireNonNegativeInt(p.maxRetries, "maxRetries", errors);
  if (typeof p.baseDelayMs !== "number" || !Number.isInteger(p.baseDelayMs) || p.baseDelayMs < 1) {
    errors.push({ field: "baseDelayMs", message: "baseDelayMs must be a positive integer (ms)" });
  }

  // The provider sub-block is required as an object; its timeoutMs is optional.
  if (!p.provider || typeof p.provider !== "object" || Array.isArray(p.provider)) {
    errors.push({ field: "provider", message: "provider must be an object" });
    return errors;
  }
  const prov = asObject(p.provider);
  if (prov.timeoutMs !== undefined) {
    if (typeof prov.timeoutMs !== "number" || !Number.isInteger(prov.timeoutMs) || prov.timeoutMs < 1) {
      errors.push({
        field: "provider.timeoutMs",
        message: "provider.timeoutMs must be a positive integer (ms) or omitted",
      });
    }
  }
  requireNonNegativeInt(prov.maxRetries, "provider.maxRetries", errors);
  requireNonNegativeInt(prov.maxRetryDelayMs, "provider.maxRetryDelayMs", errors);
  return errors;
}

export interface WriteResult {
  ok: boolean;
  policy?: PiRetryPolicy;
  errors?: ValidationError[];
  /** Set when `ok` is false for a non-validation reason. */
  error?: "busy" | "parse" | "io";
}

/**
 * Merge-preserving write of the `retry` block into the global settings file,
 * under the shared pi settings lock. Validates first; on any validation error
 * nothing is written. Preserves every other key, including unknown keys inside
 * `retry` and `retry.provider`. An unparseable file is refused (`parse`), never
 * overwritten from `{}`.
 */
export async function writePiRetryPolicy(input: unknown, deps: FsDeps = {}): Promise<WriteResult> {
  const errors = validatePiRetryPolicy(input);
  if (errors.length > 0) return { ok: false, errors };
  const policy = input as PiRetryPolicy;

  const r = await withPiSettingsLock<null, ParseFail>((state) => {
    if (state.parseError) return { fail: { error: "parse", parseError: state.parseError } };
    // Preserve unknown keys at BOTH levels; overlay only the six known fields.
    const existingRetry = asObject(state.settings.retry);
    const existingProvider = asObject(existingRetry.provider);
    const nextProvider: Record<string, unknown> = {
      ...existingProvider,
      maxRetries: policy.provider.maxRetries,
      maxRetryDelayMs: policy.provider.maxRetryDelayMs,
    };
    if (policy.provider.timeoutMs === undefined) {
      // Absent means "SDK default" — omit rather than writing 0/null.
      delete nextProvider.timeoutMs;
    } else {
      nextProvider.timeoutMs = policy.provider.timeoutMs;
    }
    const next = {
      ...state.settings,
      retry: {
        ...existingRetry,
        enabled: policy.enabled,
        maxRetries: policy.maxRetries,
        baseDelayMs: policy.baseDelayMs,
        provider: nextProvider,
      },
    };
    return { value: null, write: formatJson(next) };
  }, {}, deps);

  if (r.ok) return { ok: true, policy };
  if (r.error === "fn") return { ok: false, error: "parse" };
  if (r.error === "stale") return { ok: false, error: "io" }; // unreachable: no baseEtag
  return { ok: false, error: r.error };
}
