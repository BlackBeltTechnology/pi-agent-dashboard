/**
 * Plugin configuration reader. Limits are read PER OPERATION (never cached) so a
 * change applies without a restart; the host `getPluginConfig` does not apply
 * schema defaults, so they are merged here from the shipped `configSchema.json`
 * (single source). `maxTeammates` is clamped into 1–10 with one log line per
 * distinct out-of-range value.
 * See change: add-agent-teams-core (D13, runtime spec "Limits are clamped").
 */
import fs from "node:fs";
import { MAX_TEAMMATES_RANGE, PLAN_MAX_LINES } from "../shared/constants.js";
import type { Logger } from "./types.js";

export interface TeamsConfig {
  maxTeammates: number;
  maxActiveTeams: number;
  maxTasks: number;
  maxMessageChars: number;
  maxResultChars: number;
  maxFinalTextChars: number;
  mailRatePerMin: number;
  pairExchangeLimit: number;
  maxMailLogBytes: number;
  closedRetentionDays: number;
  wakeConfirmMs: number;
  urgentSettleWaitMs: number;
  notifyCoalesceMs: number;
  spawnTimeoutMs: number;
  shutdownGraceMs: number;
  reconcileGraceMs: number;
  orphanTtlMs: number;
  opGateBudgetMs: number;
  autoDispatch: boolean;
  /** Teammate `tool_call` guard refuses `bash sleep N` (N ≥ 10 s total). */
  blockSleepPolling: boolean;
  /** Teammate `tool_call` guard refuses git writes while the committer is the lead. */
  blockGitWrite: boolean;
  extraCwdRoots: string[];
  /** Unset resolves to `session`. */
  teammateMode?: string;
  /** In-process mode (add-agent-teams-in-process): absent = idle children stay alive until stopped. */
  inProcessIdleTtlSec?: number;
  /** In-process mode: children load no discovered extensions. */
  inProcessLeanChildren: boolean;
  /** In-process mode: command ack deadline, 1000-120000 ms. */
  inProcessCmdTimeoutMs: number;
  /** In-process mode, opt-in: queue-wait deadline; absent = unlimited. */
  inProcessQueueTimeoutMs?: number;
  /** Template file size cap in bytes (templates-hooks change). */
  maxTemplateBytes: number;
  /** Default per-command hook timeout (use `effectiveHookTimeoutMs` for the budget-capped value). */
  hookTimeoutMs: number;
  /** Consecutive idle-hook blocks before the idle is accepted; 0 = idle hooks never block. */
  hookMaxRetries: number;
  /** Configured plan cap (use `effectivePlanMaxChars` for the enforced value). */
  planMaxChars: number;
  /** Sanitised read-only tool names kept while a plan is pending (never bash/edit/write/unknown). */
  planModeTools: string[];
}

/** Mail text headroom kept free when a plan or playbook rides one core mail (design D3/D8). */
const PLAN_MAIL_HEADROOM_CHARS = 500;

/** Built-in tools a plan-mode member may keep; every other entry is dropped. */
export const PLAN_MODE_ALLOWED_TOOLS: readonly string[] = ["read", "grep", "find", "ls"];
/** Built-in tools that are never read-only; named separately only for the warning text. */
const PLAN_MODE_DENIED_TOOLS: readonly string[] = ["bash", "edit", "write"];

/** Enforced plan / decision-feedback character cap: `min(planMaxChars, maxMessageChars − 500)`, at least 1. */
export function effectivePlanMaxChars(cfg: Pick<TeamsConfig, "planMaxChars" | "maxMessageChars">): number {
  return Math.max(1, Math.min(cfg.planMaxChars, cfg.maxMessageChars - PLAN_MAIL_HEADROOM_CHARS));
}

/** The lead-notice coalescing window of a team (`overrides.notifyCoalesceMs`, else config `notifyCoalesceMs`). */
export function effectiveCoalesceWindowMs(team: { overrides?: { notifyCoalesceMs?: number } }, cfg: Pick<TeamsConfig, "notifyCoalesceMs">): number {
  return team.overrides?.notifyCoalesceMs ?? cfg.notifyCoalesceMs;
}

/** Enforced plan / playbook line cap (shared with core's mail framing). */
export const effectivePlanMaxLines = (): number => PLAN_MAX_LINES;

/** Per-command hook timeout default, never above the core op-gate budget. */
export function effectiveHookTimeoutMs(cfg: Pick<TeamsConfig, "hookTimeoutMs" | "opGateBudgetMs">): number {
  return Math.max(1, Math.min(cfg.hookTimeoutMs, cfg.opGateBudgetMs));
}

let schemaDefaults: Record<string, unknown> | undefined;

/** Defaults declared by the shipped schema (`properties.<key>.default`). */
function schemaConfigDefaults(): Record<string, unknown> {
  if (schemaDefaults) return schemaDefaults;
  const schemaPath = new URL("../configSchema.json", import.meta.url);
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8")) as {
    properties?: Record<string, { default?: unknown }>;
  };
  const out: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(schema.properties ?? {})) {
    if (def.default !== undefined) out[key] = def.default;
  }
  schemaDefaults = out;
  return out;
}

const NUMBER_KEYS = [
  "maxTeammates",
  "maxActiveTeams",
  "maxTasks",
  "maxMessageChars",
  "maxResultChars",
  "maxFinalTextChars",
  "mailRatePerMin",
  "pairExchangeLimit",
  "maxMailLogBytes",
  "closedRetentionDays",
  "wakeConfirmMs",
  "urgentSettleWaitMs",
  "notifyCoalesceMs",
  "spawnTimeoutMs",
  "shutdownGraceMs",
  "reconcileGraceMs",
  "orphanTtlMs",
  "opGateBudgetMs",
] as const;

/** Integer knobs of this change: key → inclusive minimum; an invalid value falls back to the default with one warning. */
const STRICT_INT_KEYS = { maxTemplateBytes: 1, hookTimeoutMs: 1, hookMaxRetries: 0, planMaxChars: 1 } as const;

/** Valid `inProcessCmdTimeoutMs` range (also the schema `minimum`/`maximum`). */
const IN_PROCESS_CMD_TIMEOUT_RANGE = { min: 1000, max: 120_000 } as const;

export type ConfigReader = () => TeamsConfig;

export function createConfigReader(
  getRaw: () => Record<string, unknown> | undefined,
  logger: Logger,
): ConfigReader {
  const clampLogged = new Set<number>();
  const warned = new Set<string>();
  const warnOnce = (key: string, message: string) => {
    if (warned.has(key)) return;
    warned.add(key);
    logger.warn(`agent-teams: ${message}`);
  };
  return () => {
    const raw = getRaw() ?? {};
    const defaults = schemaConfigDefaults();
    const merged: Record<string, unknown> = { ...defaults };
    for (const key of NUMBER_KEYS) {
      const v = raw[key];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) merged[key] = Math.floor(v);
    }
    if (typeof raw.autoDispatch === "boolean") merged.autoDispatch = raw.autoDispatch;
    if (typeof raw.blockSleepPolling === "boolean") merged.blockSleepPolling = raw.blockSleepPolling;
    if (typeof raw.blockGitWrite === "boolean") merged.blockGitWrite = raw.blockGitWrite;
    if (Array.isArray(raw.extraCwdRoots)) {
      merged.extraCwdRoots = raw.extraCwdRoots.filter((r): r is string => typeof r === "string" && r.length > 0);
    }
    if (typeof raw.teammateMode === "string" && raw.teammateMode.length > 0) merged.teammateMode = raw.teammateMode;

    const requested = merged.maxTeammates as number;
    const clamped = Math.min(MAX_TEAMMATES_RANGE.max, Math.max(MAX_TEAMMATES_RANGE.min, requested));
    if (clamped !== requested && !clampLogged.has(requested)) {
      clampLogged.add(requested);
      logger.warn(`agent-teams: maxTeammates ${requested} is outside ${MAX_TEAMMATES_RANGE.min}-${MAX_TEAMMATES_RANGE.max}; using ${clamped}`);
    }
    merged.maxTeammates = clamped;
    for (const [key, min] of Object.entries(STRICT_INT_KEYS)) {
      const v = raw[key];
      if (v === undefined) continue;
      if (typeof v === "number" && Number.isInteger(v) && v >= min) merged[key] = v;
      else {
        merged[key] = defaults[key];
        warnOnce(`${key}=${String(v)}`, `${key} ${JSON.stringify(v)} is not an integer ≥ ${min}; using ${String(defaults[key])}`);
      }
    }
    // In-process knobs: the schema rejects bad writes; a bad stored value falls back (never clamped) with one warning.
    const cmd = raw.inProcessCmdTimeoutMs;
    if (cmd !== undefined) {
      if (typeof cmd === "number" && Number.isInteger(cmd) && cmd >= IN_PROCESS_CMD_TIMEOUT_RANGE.min && cmd <= IN_PROCESS_CMD_TIMEOUT_RANGE.max) merged.inProcessCmdTimeoutMs = cmd;
      else warnOnce(`inProcessCmdTimeoutMs=${String(cmd)}`, `inProcessCmdTimeoutMs ${JSON.stringify(cmd)} is not an integer in ${IN_PROCESS_CMD_TIMEOUT_RANGE.min}-${IN_PROCESS_CMD_TIMEOUT_RANGE.max}; using ${String(defaults.inProcessCmdTimeoutMs)}`);
    }
    for (const key of ["inProcessIdleTtlSec", "inProcessQueueTimeoutMs"] as const) {
      const v = raw[key];
      if (v === undefined) continue;
      if (typeof v === "number" && Number.isInteger(v) && v >= 1) merged[key] = v;
      else warnOnce(`${key}=${String(v)}`, `${key} ${JSON.stringify(v)} is not an integer ≥ 1; ignoring it`);
    }
    if (typeof raw.inProcessLeanChildren === "boolean") merged.inProcessLeanChildren = raw.inProcessLeanChildren;
    merged.planModeTools = sanitizePlanModeTools(raw.planModeTools, defaults.planModeTools as string[], warnOnce);
    // Positive-only knobs: 0 would disable the limit it guards.
    for (const key of ["maxActiveTeams", "maxTasks", "maxMessageChars", "maxResultChars", "maxFinalTextChars", "mailRatePerMin", "pairExchangeLimit"] as const) {
      if ((merged[key] as number) < 1) merged[key] = defaults[key];
    }
    return merged as unknown as TeamsConfig;
  };
}

/** Keep only read-only built-ins; every dropped entry is named in one warning per distinct raw value. */
function sanitizePlanModeTools(
  raw: unknown,
  fallback: string[],
  warnOnce: (key: string, message: string) => void,
): string[] {
  if (raw === undefined) return [...fallback];
  if (!Array.isArray(raw)) {
    warnOnce(`planModeTools=${JSON.stringify(raw)}`, "planModeTools is not an array; using the default");
    return [...fallback];
  }
  const names = raw.map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)));
  const kept = [...new Set(raw.filter((e): e is string => typeof e === "string" && PLAN_MODE_ALLOWED_TOOLS.includes(e)))];
  const dropped = names.filter((n) => !PLAN_MODE_ALLOWED_TOOLS.includes(n));
  if (dropped.length > 0) {
    const denied = dropped.filter((d) => PLAN_MODE_DENIED_TOOLS.includes(d));
    const why = denied.length > 0 ? ` (${denied.join(", ")} can change state)` : "";
    warnOnce(`planModeTools=${JSON.stringify(raw)}`, `planModeTools drops ${dropped.join(", ")}${why}; allowed: ${PLAN_MODE_ALLOWED_TOOLS.join(", ")}`);
  }
  return kept;
}
