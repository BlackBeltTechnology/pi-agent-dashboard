/**
 * chat-gateway config resolution.
 *
 * TOTAL by construction: `resolveConfig` never throws on malformed input and
 * never mutates its argument — a bad value falls back to the schema default
 * rather than failing the plugin load. `token` is a SECRET: `redactToken`
 * returns a fixed placeholder, never a prefix/suffix of the value (E14).
 *
 * See change: add-chat-gateway.
 */

import {
  type ChatGatewayConfig,
  CONFIG_DEFAULTS,
  type ResolvedConfig,
} from "../shared/types.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keep strings only, drop empties, de-dupe, preserve first-seen order. */
function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (trimmed === "") continue;
    if (out.includes(trimmed)) continue;
    out.push(trimmed);
  }
  return out;
}

/** `channelKey -> cwd`; any non-string value is dropped. */
function normalizeStringMap(value: unknown): Record<string, string> {
  if (!isObject(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string" || entry === "") continue;
    out[key] = entry;
  }
  return out;
}

function normalizeThrottle(value: unknown): number {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? n : CONFIG_DEFAULTS.editThrottleMs;
}

export function resolveConfig(raw: ChatGatewayConfig | undefined): ResolvedConfig {
  const src: Record<string, unknown> = isObject(raw) ? (raw as Record<string, unknown>) : {};

  const defaultCwd = typeof src.defaultCwd === "string" && src.defaultCwd !== ""
    ? src.defaultCwd
    : undefined;
  // A prefix must be non-empty to be matchable; anything else -> the default.
  const steerPrefix =
    typeof src.steerPrefix === "string" && src.steerPrefix !== ""
      ? src.steerPrefix
      : CONFIG_DEFAULTS.steerPrefix;

  return {
    enabled: typeof src.enabled === "boolean" ? src.enabled : CONFIG_DEFAULTS.enabled,
    token: typeof src.token === "string" ? src.token : "",
    allowedRoots: normalizeStringArray(src.allowedRoots),
    fixedMap: normalizeStringMap(src.fixedMap),
    ...(defaultCwd === undefined ? {} : { defaultCwd }),
    allowlist: normalizeStringArray(src.allowlist),
    admins: normalizeStringArray(src.admins),
    groupChannels: normalizeStringArray(src.groupChannels),
    steerPrefix,
    editThrottleMs: normalizeThrottle(src.editThrottleMs),
    ...(normalizeToolPolicy(src.toolPolicy) === undefined
      ? {}
      : { toolPolicy: normalizeToolPolicy(src.toolPolicy) }),
    ...(typeof src.guardExtension === "string" && src.guardExtension !== ""
      ? { guardExtension: src.guardExtension }
      : {}),
  };
}

/** Normalize the L3 policy; absent/malformed -> undefined (guard not loaded). */
function normalizeToolPolicy(
  raw: unknown,
): { allow?: string[]; approval?: string[]; defaultAction?: "deny" | "approve" } | undefined {
  if (!isObject(raw)) return undefined;
  const p = raw as Record<string, unknown>;
  const allow = normalizeStringArray(p.allow);
  const approval = normalizeStringArray(p.approval);
  const defaultAction =
    p.defaultAction === "approve" || p.defaultAction === "deny" ? p.defaultAction : "deny";
  return {
    ...(allow.length > 0 ? { allow } : {}),
    ...(approval.length > 0 ? { approval } : {}),
    defaultAction,
  };
}

/** With no token the whole gateway is INERT, regardless of `enabled`. */
export function isConfigured(cfg: ResolvedConfig): boolean {
  return cfg.enabled === true && typeof cfg.token === "string" && cfg.token.trim() !== "";
}

/** Fixed placeholder — never derived from the secret (E14). */
export function redactToken(value: string): string {
  return typeof value === "string" && value !== "" ? "***" : "";
}
