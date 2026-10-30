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
 * (editor, lock, mirror; design D1–D6); stop-flows-edit-mode-project-writes
 * (lock primitive moved to pi-dashboard-shared/pi-agent-settings-lock, D3).
 */
import {
  asObject,
  type FsDeps,
  formatJson,
  isPlainObject,
  type LockedResult,
  type PiSettingsState,
  parseText,
  readPiSettings,
  sortKeys,
  withPiSettingsLock,
} from "@blackbelt-technology/pi-dashboard-shared/pi-agent-settings-lock.js";
import { PI_MANAGED_SETTINGS_KEYS } from "@blackbelt-technology/pi-dashboard-shared/pi-settings-keys.js";
import {
  checkPiSettingValue,
  getPiSettingDef,
  PI_SETTINGS_BLOCKS,
} from "@blackbelt-technology/pi-dashboard-shared/pi-settings-schema.js";
import type { PiMirrorResult, PiRetryPolicy, PiSettingsPatch } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { THINKING_LEVELS } from "@blackbelt-technology/pi-dashboard-shared/role-schema.js";

// Lock primitive lives in pi-dashboard-shared (node-only) so plugin servers
// reuse pi's lock; re-exported here with unchanged names.
// See change: stop-flows-edit-mode-project-writes (D3).
export {
  computePiSettingsEtag,
  type FsDeps,
  formatJson,
  type PiSettingsState,
  readPiSettings,
  withPiSettingsLock,
} from "@blackbelt-technology/pi-dashboard-shared/pi-agent-settings-lock.js";

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

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export interface ValidationError {
  field: string;
  message: string;
}

// ── Typed form patch (design D3) ─────────────────────────────────────

const isManaged = (k: string): boolean => (PI_MANAGED_SETTINGS_KEYS as readonly string[]).includes(k);

const isBlock = (k: string): boolean => PI_SETTINGS_BLOCKS.includes(k);

const JSON_HINT = "use the JSON editor for this key";

const fieldError = (field: string, message: string): ValidationError => ({ field, message });

/** Check one dotted schema leaf (`block.leaf`, or a top-level key). `null` deletes and is always valid. */
function checkLeaf(key: string, value: unknown): ValidationError[] {
  const def = getPiSettingDef(key);
  if (!def) return [fieldError(key, `${key} is not a form field; ${JSON_HINT}`)];
  const msg = value === null ? null : checkPiSettingValue(def, value);
  return msg ? [fieldError(key, `${key} ${msg}`)] : [];
}

function checkPatchBlock(key: string, value: unknown): ValidationError[] {
  if (value === null) return [fieldError(key, `${key} cannot be removed as a whole block; clear its fields instead`)];
  if (!isPlainObject(value)) return [fieldError(key, `${key} must be an object`)];
  return Object.entries(value)
    .filter(([, lv]) => lv !== undefined)
    .flatMap(([leaf, lv]) => checkLeaf(`${key}.${leaf}`, lv));
}

function checkPatchKey(key: string, value: unknown): ValidationError[] {
  if (isManaged(key)) {
    return [fieldError(key, `${key} is managed by the Default model control and cannot be edited here`)];
  }
  if (isBlock(key)) return checkPatchBlock(key, value);
  // A dotted top-level key would write a literal "a.b" property: blocks hold leaves.
  if (key.includes(".")) return [fieldError(key, `${key} is not a form field; ${JSON_HINT}`)];
  return checkLeaf(key, value);
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
    if (isBlock(key)) {
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
const isNonNeg = (v: unknown): boolean => typeof v === "number" && Number.isInteger(v) && v >= 0;

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

/**
 * The 10 typed keys checked in raw mode, FROZEN at their pre-change set. The
 * schema mirrors pi's docs at one point in time, so a strict raw check over it
 * would block saving a file a newer pi accepts; the form stays strict because it
 * only writes values it offers. See change: pi-settings-full-coverage (D2).
 */
export const RAW_LEGACY_TYPED: readonly string[] = Object.freeze([
  "compaction.enabled",
  "compaction.reserveTokens",
  "compaction.keepRecentTokens",
  "branchSummary.reserveTokens",
  "branchSummary.skipPrompt",
  "steeringMode",
  "followUpMode",
  "defaultProjectTrust",
  "hideThinkingBlock",
  "quietStartup",
]);

/** Blocks whose raw value must be an object when present (their legacy leaves are checked inside). */
const RAW_LEGACY_BLOCKS: readonly string[] = ["compaction", "branchSummary"];

/** The frozen legacy typed keys, checked in raw mode. */
function validateLegacyTyped(obj: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const block of RAW_LEGACY_BLOCKS) {
    if (obj[block] !== undefined && !isPlainObject(obj[block])) errors.push(fieldError(block, `${block} must be an object`));
  }
  for (const key of RAW_LEGACY_TYPED) {
    const [head, leaf] = key.split(".");
    const v = leaf === undefined ? obj[head] : asObject(obj[head])[leaf];
    const def = getPiSettingDef(key);
    const msg = v === undefined || !def ? null : checkPiSettingValue(def, v);
    if (msg) errors.push(fieldError(key, `${key} ${msg}`));
  }
  return errors;
}

function validateRawKeys(obj: Record<string, unknown>): ValidationError[] {
  const errors = validateLegacyTyped(obj);
  for (const [key, check] of Object.entries(RAW_KEY_RULES)) {
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
