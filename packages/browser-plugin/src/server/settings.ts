/**
 * "Agent browsing" settings: effective values + `PUT /api/browser/settings`
 * validation (change: add-dedicated-agent-browser, D6/D11, task 4.3).
 *
 * Pure. `effectiveSettings(config)` is what `GET /status` returns as `settings`
 * (defaults filled in, so the UI never guesses); `validateSettingsPatch` accepts a
 * PARTIAL body and returns the config keys to persist or a 400 message. Nothing is
 * stored when validation fails (the route writes only on `ok`).
 */
import type { RelayConfig } from "./relay/relay-manager.js";

const IDLE_MINUTES_CHOICES: readonly number[] = [0, 5, 30, 120];
const ON_UNAVAILABLE_CHOICES: readonly string[] = ["ask", "next", "stop"];
/** Built-in `defaultBrowser` targets; every other value must be an installed profile. */
const BUILTIN_TARGETS: readonly string[] = ["@dedicated", "@headless"];
const MAX_DOMAINS = 200;
const MAX_DOMAIN_LENGTH = 253;
const MAX_PROFILE_KEY = 128;

export interface EffectiveSettings {
  defaultBrowser: string;
  realProfile?: string;
  onUnavailable: "ask" | "next" | "stop";
  idleDisconnectMinutes: 0 | 5 | 30 | 120;
  allowMultipleInstancesPerProfile: boolean;
  openLiveViewOnConnect: boolean;
  allowedDomains: string[];
}

/** Stored config → effective values with the schema defaults applied. */
export function effectiveSettings(config: RelayConfig): EffectiveSettings {
  const idle = config.idleDisconnectMinutes;
  const onUnavailable = config.onUnavailable;
  return {
    defaultBrowser: typeof config.defaultBrowser === "string" && config.defaultBrowser !== "" ? config.defaultBrowser : "@dedicated",
    ...(typeof config.realProfile === "string" && config.realProfile !== "" ? { realProfile: config.realProfile } : {}),
    onUnavailable: onUnavailable === "next" || onUnavailable === "stop" ? onUnavailable : "ask",
    idleDisconnectMinutes: (typeof idle === "number" && IDLE_MINUTES_CHOICES.includes(idle) ? idle : 30) as EffectiveSettings["idleDisconnectMinutes"],
    allowMultipleInstancesPerProfile: config.allowMultipleInstancesPerProfile === true,
    openLiveViewOnConnect: config.openLiveViewOnConnect !== false,
    allowedDomains: Array.isArray(config.allowedDomains) ? config.allowedDomains.filter((d): d is string => typeof d === "string") : [],
  };
}

export type SettingsPatchResult = { ok: true; patch: Partial<RelayConfig> } | { ok: false; error: string };


function profileKey(value: unknown, installed: ReadonlySet<string>, field: string, allowBuiltin: boolean): string | { error: string } {
  if (typeof value !== "string" || value === "" || value.length > MAX_PROFILE_KEY) return { error: `${field} must be a non-empty string` };
  if (allowBuiltin && BUILTIN_TARGETS.includes(value)) return value;
  if (value.startsWith("@")) return { error: `${field}: "@" is reserved for built-in targets` };
  if (!installed.has(value)) return { error: `${field}: profile "${value.slice(0, 64)}" is not installed` };
  return value;
}

type Checked = { value: unknown } | { error: string };

const bool = (key: string) => (v: unknown): Checked => (typeof v === "boolean" ? { value: v } : { error: `${key} must be a boolean` });

function checkDomains(v: unknown): Checked {
  if (!Array.isArray(v) || v.length > MAX_DOMAINS) return { error: `allowedDomains must be an array of at most ${MAX_DOMAINS} strings` };
  const out: string[] = [];
  for (const d of v) {
    if (typeof d !== "string") return { error: "allowedDomains entries must be strings" };
    const t = d.trim();
    if (t === "" || t.length > MAX_DOMAIN_LENGTH) return { error: "allowedDomains entries must be 1-253 characters" };
    out.push(t);
  }
  return { value: out };
}

/** One validator per known key; profile keys need the installed set, so they close over it. */
function validators(installed: ReadonlySet<string>): Record<string, (v: unknown) => Checked> {
  const profile = (field: string, allowBuiltin: boolean) => (v: unknown): Checked => {
    const r = profileKey(v, installed, field, allowBuiltin);
    return typeof r === "string" ? { value: r } : r;
  };
  return {
    defaultBrowser: profile("defaultBrowser", true),
    realProfile: profile("realProfile", false),
    onUnavailable: (v) =>
      typeof v === "string" && ON_UNAVAILABLE_CHOICES.includes(v) ? { value: v } : { error: "onUnavailable must be ask, next or stop" },
    idleDisconnectMinutes: (v) =>
      typeof v === "number" && IDLE_MINUTES_CHOICES.includes(v) ? { value: v } : { error: "idleDisconnectMinutes must be 0, 5, 30 or 120" },
    allowMultipleInstancesPerProfile: bool("allowMultipleInstancesPerProfile"),
    openLiveViewOnConnect: bool("openLiveViewOnConnect"),
    allowedDomains: checkDomains,
  };
}

/**
 * Validate a partial settings body. `installedProfiles` = `profileDirectory` of
 * every installed Chrome profile. Unknown key, wrong type, out-of-range value or
 * an uninstalled profile → `{ok:false}` and NOTHING is applied.
 */
export function validateSettingsPatch(body: unknown, installedProfiles: ReadonlySet<string>): SettingsPatchResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "body must be an object" };
  const input = body as Record<string, unknown>;
  const check = validators(installedProfiles);
  const patch: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(input)) {
    const validate = Object.hasOwn(check, key) ? check[key] : undefined;
    if (!validate) return { ok: false, error: `unknown setting: ${key.slice(0, 64)}` };
    if (raw === undefined) continue;
    const r = validate(raw);
    if ("error" in r) return { ok: false, error: r.error };
    patch[key] = r.value;
  }
  return { ok: true, patch: patch as Partial<RelayConfig> };
}
