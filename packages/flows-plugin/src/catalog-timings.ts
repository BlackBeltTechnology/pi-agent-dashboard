/**
 * Flow catalog timings stored in the flows plugin config (`configSchema.json`).
 * One table drives defaults, ranges, validation messages and the reader used
 * by the plugin server and client. Import-free leaf.
 * See change: flows-dock-chip-and-panel-actions (D11).
 */

export type CatalogTimingKey =
  | "catalogAskLimitSec"
  | "catalogReaskIntervalSec"
  | "catalogReaskAttempts"
  | "catalogServerStartIntervalSec"
  | "catalogServerStartWindowSec";

export interface CatalogTimingSpec {
  key: CatalogTimingKey;
  default: number;
  min: number;
  max: number;
  /** Unit shown in the range message ("s" or ""). */
  unit: "s" | "";
  /** Whole numbers only. */
  integer: boolean;
}

export const CATALOG_TIMING_SPECS: readonly CatalogTimingSpec[] = [
  { key: "catalogAskLimitSec", default: 2, min: 0.5, max: 60, unit: "s", integer: false },
  { key: "catalogReaskIntervalSec", default: 5, min: 1, max: 60, unit: "s", integer: false },
  { key: "catalogReaskAttempts", default: 12, min: 1, max: 60, unit: "", integer: true },
  { key: "catalogServerStartIntervalSec", default: 5, min: 1, max: 60, unit: "s", integer: false },
  { key: "catalogServerStartWindowSec", default: 60, min: 10, max: 600, unit: "s", integer: false },
];

export interface CatalogTimings {
  askLimitMs: number;
  reaskIntervalMs: number;
  reaskAttempts: number;
  serverStartIntervalMs: number;
  serverStartWindowMs: number;
}

/** Range label, e.g. "0.5–60 s" or "1–60". */
export function rangeLabel(spec: CatalogTimingSpec): string {
  return `${spec.min}–${spec.max}${spec.unit ? ` ${spec.unit}` : ""}`;
}

/** Null when valid, else the range label the value violates. */
export function validateTiming(spec: CatalogTimingSpec, value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return rangeLabel(spec);
  if (spec.integer && !Number.isInteger(value)) return rangeLabel(spec);
  if (value < spec.min || value > spec.max) return rangeLabel(spec);
  return null;
}

function pick(cfg: Record<string, unknown> | undefined, spec: CatalogTimingSpec): number {
  const v = cfg?.[spec.key];
  return validateTiming(spec, v) === null ? (v as number) : spec.default;
}

/** Effective timings; a missing or out-of-range stored value falls back to its default. */
export function readCatalogTimings(cfg: Record<string, unknown> | undefined): CatalogTimings {
  const [ask, reask, attempts, ssInterval, ssWindow] = CATALOG_TIMING_SPECS.map((s) => pick(cfg, s));
  return {
    askLimitMs: ask * 1000,
    reaskIntervalMs: reask * 1000,
    reaskAttempts: attempts,
    serverStartIntervalMs: ssInterval * 1000,
    serverStartWindowMs: ssWindow * 1000,
  };
}
