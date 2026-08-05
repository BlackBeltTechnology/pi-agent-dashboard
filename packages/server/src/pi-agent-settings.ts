/**
 * pi-agent-settings — read/write pi's OWN native retry policy in the GLOBAL
 * `~/.pi/agent/settings.json`.
 *
 * This is the write half of the `pi-retry-settings` capability (the bridge has a
 * separate READ-ONLY reader in the extension package). It is intentionally
 * distinct from `config-api.ts`, which writes the DASHBOARD's own
 * `~/.pi/dashboard/config.json` — a different file with different semantics.
 *
 * Covers all six native fields: `retry.{enabled,maxRetries,baseDelayMs}` and
 * `retry.provider.{timeoutMs,maxRetries,maxRetryDelayMs}`.
 *
 * Invariants:
 *   - GLOBAL only. pi has no persisted per-session retry policy
 *     (`AgentSession.setAutoRetryEnabled` delegates to `SettingsManager
 *     .setRetryEnabled`, which writes the global file), so there is no
 *     project-scoped variant. `<cwd>/.pi/settings.json` is NEVER written.
 *   - The write is MERGE-PRESERVING at BOTH levels: every key already in the
 *     file survives byte-for-byte, including unknown keys inside `retry` and
 *     inside `retry.provider`. Only the six known fields are set.
 *   - Values are validated before any write; an invalid policy writes nothing.
 *   - `provider.timeoutMs` is OMITTED (not written as 0/null) when absent, so
 *     pi keeps its SDK default.
 *
 * See change: retry-forever-with-stop-control (design D2/D3, spec
 * `pi-retry-settings`).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { PiRetryPolicy } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";

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

interface FsDeps {
  /** Override for tests. Defaults to `os.homedir()`. */
  home?: string;
  readFile?: (path: string) => string;
  writeFile?: (path: string, data: string) => void;
  fileExists?: (path: string) => boolean;
  mkdirp?: (dir: string) => void;
}

function globalSettingsPath(home: string): string {
  return join(home, ".pi", "agent", "settings.json");
}

/** Parse the settings file into a plain object; `{}` on absent/unreadable. */
function loadRaw(
  path: string,
  deps: Required<Pick<FsDeps, "readFile" | "fileExists">>,
): Record<string, unknown> {
  if (!deps.fileExists(path)) return {};
  try {
    const parsed = JSON.parse(deps.readFile(path));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * Read pi's effective retry policy from the global settings file. Absent file /
 * absent keys → pi's defaults. Never throws.
 */
export function readPiRetryPolicy(deps: FsDeps = {}): PiRetryPolicy {
  const home = deps.home ?? homedir();
  const readFile = deps.readFile ?? ((p: string) => readFileSync(p, "utf-8"));
  const fileExists = deps.fileExists ?? existsSync;
  const raw = loadRaw(globalSettingsPath(home), { readFile, fileExists });
  const retry = asObject(raw.retry);
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

export interface ValidationError {
  field: string;
  message: string;
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
}

/**
 * Merge-preserving write of the `retry` block into the global settings file.
 * Validates first; on any validation error nothing is written. Preserves every
 * other key, including unknown keys inside `retry` and `retry.provider`.
 */
export function writePiRetryPolicy(input: unknown, deps: FsDeps = {}): WriteResult {
  const errors = validatePiRetryPolicy(input);
  if (errors.length > 0) return { ok: false, errors };
  const policy = input as PiRetryPolicy;

  const home = deps.home ?? homedir();
  const readFile = deps.readFile ?? ((p: string) => readFileSync(p, "utf-8"));
  const writeFile = deps.writeFile ?? ((p: string, d: string) => writeFileSync(p, d, "utf-8"));
  const fileExists = deps.fileExists ?? existsSync;
  const mkdirp = deps.mkdirp ?? ((dir: string) => mkdirSync(dir, { recursive: true }));

  const path = globalSettingsPath(home);
  const raw = loadRaw(path, { readFile, fileExists });

  // Preserve unknown keys at BOTH levels; overlay only the six known fields.
  const existingRetry = asObject(raw.retry);
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
    ...raw,
    retry: {
      ...existingRetry,
      enabled: policy.enabled,
      maxRetries: policy.maxRetries,
      baseDelayMs: policy.baseDelayMs,
      provider: nextProvider,
    },
  };

  mkdirp(dirname(path));
  writeFile(path, `${JSON.stringify(next, null, 2)}\n`);
  return { ok: true, policy };
}
