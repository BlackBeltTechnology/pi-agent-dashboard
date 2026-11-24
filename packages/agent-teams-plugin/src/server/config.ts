/**
 * Plugin configuration reader. Limits are read PER OPERATION (never cached) so a
 * change applies without a restart; the host `getPluginConfig` does not apply
 * schema defaults, so they are merged here from the shipped `configSchema.json`
 * (single source). `maxTeammates` is clamped into 1–10 with one log line per
 * distinct out-of-range value.
 * See change: add-agent-teams-core (D13, runtime spec "Limits are clamped").
 */
import fs from "node:fs";
import { MAX_TEAMMATES_RANGE } from "../shared/constants.js";
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
  extraCwdRoots: string[];
  /** Unset resolves to `session`. */
  teammateMode?: string;
}

let schemaDefaults: Record<string, unknown> | undefined;

/** Defaults declared by the shipped schema (`properties.<key>.default`). */
export function schemaConfigDefaults(): Record<string, unknown> {
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

export type ConfigReader = () => TeamsConfig;

export function createConfigReader(
  getRaw: () => Record<string, unknown> | undefined,
  logger: Logger,
): ConfigReader {
  const clampLogged = new Set<number>();
  return () => {
    const raw = getRaw() ?? {};
    const defaults = schemaConfigDefaults();
    const merged: Record<string, unknown> = { ...defaults };
    for (const key of NUMBER_KEYS) {
      const v = raw[key];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) merged[key] = Math.floor(v);
    }
    if (typeof raw.autoDispatch === "boolean") merged.autoDispatch = raw.autoDispatch;
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
    // Positive-only knobs: 0 would disable the limit it guards.
    for (const key of ["maxActiveTeams", "maxTasks", "maxMessageChars", "maxResultChars", "maxFinalTextChars", "mailRatePerMin", "pairExchangeLimit"] as const) {
      if ((merged[key] as number) < 1) merged[key] = defaults[key];
    }
    return merged as unknown as TeamsConfig;
  };
}
