/**
 * Validation and clamping of the seven `openspec*` config keys (design D2/D3/D6, spec "Configuration keys"
 * and "Configuration value domains"). Numeric keys are integers only (a non-integer / non-numeric value falls
 * back to the default with one warning); out-of-range integers clamp with one log line. Names match
 * `^[a-z0-9][a-z0-9-]{0,63}$`; refs pass `git check-ref-format --branch` and never start with `-`, else the
 * reader answers `invalid_config` (the start refuses before anything is created).
 * See change: add-agent-teams-openspec.
 */
import { execFileSync } from "node:child_process";
import os from "node:os";
import type { Logger } from "../types.js";

export interface OpenspecConfig {
  groupParallel: number;
  shipSkill: string;
  reviewSkill: string;
  worktreeBase: string;
  mergeBase: string;
  lockTtlMs: number;
  fetchTimeoutMs: number;
}

export type OpenspecConfigResult = { ok: true; config: OpenspecConfig } | { ok: false; key: string; message: string };

export const OPENSPEC_DEFAULTS: Readonly<OpenspecConfig> = Object.freeze({
  groupParallel: 2,
  shipSkill: "ship-it",
  reviewSkill: "review-code",
  worktreeBase: "develop",
  mergeBase: "develop",
  lockTtlMs: 1_800_000,
  fetchTimeoutMs: 8000,
});

export const LOCK_TTL_RANGE = Object.freeze({ min: 60_000, max: 86_400_000 });
export const FETCH_TIMEOUT_MAX_MS = 10_000;

/** Skill / change-style name (also the `os-<change>` source): lowercase, digits, dashes; at most 64 characters. */
const OPENSPEC_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

const refCache = new Map<string, boolean>();
const REF_CACHE_MAX = 200;

/**
 * `git check-ref-format --branch` verdict for an untrusted ref. Option-like (`-…`), control characters, `@{`
 * (reflog expansion needs a repository) and over-long values are rejected before git runs; git runs with
 * a fixed argv in a neutral cwd and never receives the value as an option. Cached per value.
 */
export function isValidBranchRef(ref: unknown): ref is string {
  if (typeof ref !== "string" || ref === "" || ref.length > 255 || ref.startsWith("-") || ref.includes("@{")) return false;
  for (const ch of ref) {
    const c = ch.codePointAt(0) as number;
    if (c <= 0x20 || c === 0x7f) return false;
  }
  const cached = refCache.get(ref);
  if (cached !== undefined) return cached;
  let ok: boolean;
  try {
    execFileSync("git", ["check-ref-format", "--branch", ref], { cwd: os.tmpdir(), stdio: "ignore", timeout: 5000 });
    ok = true;
  } catch {
    ok = false;
  }
  if (refCache.size >= REF_CACHE_MAX) refCache.clear();
  refCache.set(ref, ok);
  return ok;
}

export type OpenspecConfigReader = (opts?: { effectiveMaxTeammates?: number }) => OpenspecConfigResult;

/**
 * `getRaw` returns the raw `openspec*` values (`TeamsConfig.openspecRaw`); read PER CALL so a change applies
 * without a restart. Warnings and clamp lines are logged once per distinct value.
 */
export function createOpenspecConfigReader(getRaw: () => Readonly<Record<string, unknown>> | undefined, logger: Logger): OpenspecConfigReader {
  const logged = new Set<string>();
  const once = (key: string, level: "warn", message: string): void => {
    if (logged.has(key)) return;
    logged.add(key);
    logger[level](`agent-teams: ${message}`);
  };

  /** Integer in `[min, max]`; clamps integers, defaults non-integers (and values below `defaultBelow`, when given). */
  const intKey = (raw: Readonly<Record<string, unknown>>, key: string, def: number, min: number, max: number, defaultBelow?: number): number => {
    const v = raw[key];
    if (v === undefined) return def;
    if (typeof v !== "number" || !Number.isInteger(v) || (defaultBelow !== undefined && v < defaultBelow)) {
      once(`${key}=${typeof v}:${String(v)}`, "warn", `${key} ${JSON.stringify(v) ?? String(v)} is not a valid integer; using ${def}`);
      return def;
    }
    const clamped = Math.min(max, Math.max(min, v));
    if (clamped !== v) once(`${key}=${v}:${max}`, "warn", `${key} ${v} is outside ${min}-${max}; using ${clamped}`);
    return clamped;
  };

  return (opts = {}) => {
    const raw = getRaw() ?? {};
    const maxTeammates = Math.max(1, opts.effectiveMaxTeammates ?? 5);
    const name = (key: string, def: string): { v: string } | { error: string } => {
      const v = raw[key] === undefined ? def : raw[key];
      return typeof v === "string" && OPENSPEC_NAME_RE.test(v) ? { v } : { error: key };
    };
    const ref = (key: string, def: string): { v: string } | { error: string } => {
      const v = raw[key] === undefined ? def : raw[key];
      return isValidBranchRef(v) ? { v } : { error: key };
    };
    const shipSkill = name("openspecShipSkill", OPENSPEC_DEFAULTS.shipSkill);
    const reviewSkill = name("openspecReviewSkill", OPENSPEC_DEFAULTS.reviewSkill);
    const worktreeBase = ref("openspecWorktreeBase", OPENSPEC_DEFAULTS.worktreeBase);
    const mergeBase = ref("openspecMergeBase", OPENSPEC_DEFAULTS.mergeBase);
    for (const r of [shipSkill, reviewSkill, worktreeBase, mergeBase]) {
      if ("error" in r) return { ok: false, key: r.error, message: `${r.error} is not a valid name or ref` };
    }
    return {
      ok: true,
      config: {
        groupParallel: Math.min(maxTeammates, intKey(raw, "openspecGroupParallel", OPENSPEC_DEFAULTS.groupParallel, 1, maxTeammates)),
        shipSkill: (shipSkill as { v: string }).v,
        reviewSkill: (reviewSkill as { v: string }).v,
        worktreeBase: (worktreeBase as { v: string }).v,
        mergeBase: (mergeBase as { v: string }).v,
        lockTtlMs: intKey(raw, "openspecLockTtlMs", OPENSPEC_DEFAULTS.lockTtlMs, LOCK_TTL_RANGE.min, LOCK_TTL_RANGE.max),
        fetchTimeoutMs: intKey(raw, "openspecFetchTimeoutMs", OPENSPEC_DEFAULTS.fetchTimeoutMs, 1, FETCH_TIMEOUT_MAX_MS, 1),
      },
    };
  };
}
