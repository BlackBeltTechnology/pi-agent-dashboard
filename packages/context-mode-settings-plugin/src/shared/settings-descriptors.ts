/**
 * Declarative descriptor table for the context-mode settings file.
 *
 * The file stores LOGICAL, engine-neutral keys (`search.windowMs`), never
 * env-var names. The `env` column is the only context-mode-specific part: it is
 * what `projectEnv` emits. Pure module (no node imports) — shared by the
 * server routes, the spawn-env contributor, the bridge entry and the client.
 *
 * See change: add-context-mode-settings-plugin (D1).
 */

type SettingKind = "positiveNumber" | "positiveInteger" | "string" | "path" | "locale" | "timeZone" | "boolean";
export type SettingScope = "storage" | "runtime";
export type SettingGroup = "storage" | "search" | "locale" | "stats" | "network";

export interface SettingDescriptor {
  key: string;
  kind: SettingKind;
  /** Documented context-mode default (undefined = unset / engine decides). */
  default: number | string | boolean | undefined;
  group: SettingGroup;
  /** `storage`: delivered only via dashboard spawn env. `runtime`: also via the bridge. */
  scope: SettingScope;
  label: string;
  help: string;
  /** context-mode environment variable this key projects to. */
  env: string;
}

export const CONTEXT_SETTINGS: readonly SettingDescriptor[] = [
  { key: "storage.dir", kind: "path", default: undefined, group: "storage", scope: "storage", label: "Data directory", help: "Absolute or ~-prefixed directory for context-mode's stores.", env: "CONTEXT_MODE_DIR" },
  { key: "storage.dataDir", kind: "path", default: undefined, group: "storage", scope: "storage", label: "Alternative data directory", help: "Alternative data directory (~ is expanded by context-mode).", env: "CONTEXT_MODE_DATA_DIR" },
  { key: "storage.sessionSuffix", kind: "string", default: undefined, group: "storage", scope: "storage", label: "Session suffix", help: "Suffix appended to session store names.", env: "CONTEXT_MODE_SESSION_SUFFIX" },
  { key: "search.windowMs", kind: "positiveNumber", default: 60000, group: "search", scope: "runtime", label: "Search window (ms)", help: "Time window over which search calls are counted for throttling.", env: "CONTEXT_MODE_SEARCH_WINDOW_MS" },
  { key: "search.maxResultsAfter", kind: "positiveInteger", default: 3, group: "search", scope: "runtime", label: "Search soft cap", help: "Calls within the window after which results are reduced.", env: "CONTEXT_MODE_SEARCH_MAX_RESULTS_AFTER" },
  { key: "search.blockAfter", kind: "positiveInteger", default: 8, group: "search", scope: "runtime", label: "Search hard block", help: "Calls within the window after which searches are blocked.", env: "CONTEXT_MODE_SEARCH_BLOCK_AFTER" },
  { key: "locale.locale", kind: "locale", default: undefined, group: "locale", scope: "runtime", label: "Locale", help: "BCP-47 locale tag, e.g. hu-HU.", env: "CONTEXT_MODE_LOCALE" },
  { key: "locale.timeZone", kind: "timeZone", default: undefined, group: "locale", scope: "runtime", label: "Time zone", help: "IANA time zone, e.g. Europe/Budapest.", env: "CONTEXT_MODE_TZ" },
  { key: "stats.outputPricePerToken", kind: "positiveNumber", default: 0.000005, group: "stats", scope: "runtime", label: "Output price per token", help: "Price used for savings statistics.", env: "PI_CONTEXT_MODE_PRICE_OUTPUT_PER_TOKEN" },
  { key: "stats.modelId", kind: "string", default: undefined, group: "stats", scope: "runtime", label: "Pricing model label", help: "Model label shown next to the pricing statistics.", env: "PI_CONTEXT_MODE_MODEL_ID" },
  { key: "fetch.strict", kind: "boolean", default: false, group: "network", scope: "runtime", label: "Strict fetch", help: "Refuse fetches that do not pass context-mode's strict checks.", env: "CTX_FETCH_STRICT" },
];

export const SETTING_GROUPS: readonly SettingGroup[] = ["storage", "search", "locale", "stats", "network"];

/** Marker env var the bridge fills with the runtime names it projected. */
export const PROJECTED_MARKER_ENV = "PI_CONTEXT_MODE_SETTINGS_PROJECTED";

/** Runtime-scope env names — the only names the host may supersede via the marker. */
export const RUNTIME_ENV_NAMES: readonly string[] = CONTEXT_SETTINGS.filter((d) => d.scope === "runtime").map((d) => d.env);

const BY_KEY = new Map(CONTEXT_SETTINGS.map((d) => [d.key, d]));
function getDescriptor(key: string): SettingDescriptor | undefined {
  return BY_KEY.get(key);
}

export interface SettingError {
  key: string;
  error: string;
}

const MAX_STRING = 256;

function isWindows(): boolean {
  return typeof process !== "undefined" && process.platform === "win32"; // platform-branch-ok: path-shape check only; module is also browser-bundled
}

function isAbsoluteOrHome(v: string): boolean {
  if (v === "~" || v.startsWith("~/") || v.startsWith("~\\")) return true;
  if (v.startsWith("/")) return true;
  return isWindows() && (/^[A-Za-z]:[\\/]/.test(v) || v.startsWith("\\\\"));
}

const isStr = (v: unknown): v is string => typeof v === "string";

function validateLocale(v: unknown): string | null {
  if (!isStr(v) || v === "") return "invalid_locale";
  try {
    return Intl.getCanonicalLocales(v).length === 1 ? null : "invalid_locale";
  } catch {
    return "invalid_locale";
  }
}

function validateTimeZone(v: unknown): string | null {
  if (!isStr(v) || v === "") return "invalid_time_zone";
  try {
    new Intl.DateTimeFormat("en", { timeZone: v });
    return null;
  } catch {
    return "invalid_time_zone";
  }
}

function validatePath(v: unknown): string | null {
  if (!isStr(v) || v.includes("\u0000") || v.length > 1024) return "expected_path";
  return isAbsoluteOrHome(v) ? null : "expected_absolute_path";
}

const KIND_VALIDATORS: Record<SettingKind, (v: unknown) => string | null> = {
  boolean: (v) => (typeof v === "boolean" ? null : "expected_boolean"),
  positiveNumber: (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? null : "expected_positive_number"),
  positiveInteger: (v) => (typeof v === "number" && Number.isInteger(v) && v >= 1 ? null : "expected_positive_integer"),
  string: (v) => (isStr(v) && v.trim() !== "" && v.length <= MAX_STRING && !v.includes("\u0000") ? null : "expected_string"),
  path: validatePath,
  locale: validateLocale,
  timeZone: validateTimeZone,
};

/** Validate one value against its descriptor; returns an error code or null. */
export function validateValue(d: SettingDescriptor, v: unknown): string | null {
  return KIND_VALIDATORS[d.kind](v);
}

/** Validate a full settings object. Unknown keys and invalid values each yield one error. */
export function validateSettings(obj: unknown): { ok: true } | { ok: false; errors: SettingError[] } {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return { ok: false, errors: [{ key: "", error: "expected_object" }] };
  }
  const errors: SettingError[] = [];
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const d = getDescriptor(key);
    if (!d) {
      errors.push({ key, error: "unknown_key" });
      continue;
    }
    const e = validateValue(d, value);
    if (e) errors.push({ key, error: e });
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function expandHome(v: string, home: string | undefined): string {
  if (!home) return v;
  if (v === "~") return home;
  if (v.startsWith("~/") || v.startsWith("~\\")) return `${home.replace(/[\\/]+$/, "")}/${v.slice(2)}`;
  return v;
}

function projectOne(d: SettingDescriptor, v: unknown, home: string | undefined): string | undefined {
  if (d.kind === "boolean") return v === true ? "1" : undefined;
  if (d.key === "storage.dir") return expandHome(v as string, home);
  return String(v);
}

/**
 * Project settings to context-mode env vars for the requested scopes.
 * Invalid entries are dropped individually (reported via `onInvalid`) because
 * the file may be edited outside the dashboard. `false` booleans emit nothing.
 */
export function projectEnv(
  settings: Record<string, unknown>,
  opts: {
    scopes: readonly SettingScope[];
    home?: string;
    onInvalid?: (e: SettingError) => void;
  },
): Record<string, string> {
  const home = opts.home ?? (typeof process !== "undefined" ? (process.env.HOME ?? process.env.USERPROFILE) : undefined);
  const out: Record<string, string> = {};
  for (const d of CONTEXT_SETTINGS) {
    if (!opts.scopes.includes(d.scope) || !Object.hasOwn(settings, d.key)) continue;
    const v = settings[d.key];
    const err = validateValue(d, v);
    if (err) {
      opts.onInvalid?.({ key: d.key, error: err });
      continue;
    }
    const projected = projectOne(d, v, home);
    if (projected !== undefined) out[d.env] = projected;
  }
  return out;
}
