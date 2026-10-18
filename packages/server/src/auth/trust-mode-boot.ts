/**
 * The one-time boot trust-mode decision (see `trust-mode.ts`). Separate module:
 * it writes config, so it imports the config writer, which the read-only
 * admission path must not drag in.
 *
 * See change: retire-trusted-networks-bypass (design D2).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isLoopbackOnlyEntry } from "@blackbelt-technology/pi-dashboard-shared/bind-reachability.js";
import {
  type DashboardConfig,
  loadConfig,
  resolveTrustMode,
  type TrustMode,
} from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { writeConfigPartial as defaultWriteConfigPartial } from "../config-api.js";
import { setBootTrustFallback } from "./trust-mode.js";

function configFile(): string {
  return path.join(os.homedir(), ".pi", "dashboard", "config.json");
}

export interface BootTrustDecision {
  /** What was decided (or the fallback used); `null` when a recognised/unrecognised value was already stored. */
  mode: TrustMode | null;
  /** True when the decision was persisted. */
  persisted: boolean;
}

/**
 * The one-time boot decision. Call before the server listens (so no operator
 * write can race it). Never re-derives a stored mode; never writes over a
 * `config.json` it cannot parse (a rewrite from `{}` would drop its secrets).
 */
export function decideBootTrustMode(
  deps: {
    write?: (partial: Record<string, unknown>, opts: { trustModeOrigin: "upgrade" }) => { success: boolean; error?: string };
    load?: () => DashboardConfig;
  } = {},
): BootTrustDecision {
  const write = deps.write ?? defaultWriteConfigPartial;
  const load = deps.load ?? loadConfig;

  // A present-but-unparseable file is never decided or written.
  let raw: string | null = null;
  try {
    raw = fs.readFileSync(configFile(), "utf-8");
  } catch { /* absent → a fresh install, decide below */ }
  if (raw !== null && raw.trim() !== "") {
    let parsedOk = false;
    try {
      const parsed: unknown = JSON.parse(raw);
      parsedOk = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
    } catch { /* unparseable */ }
    if (!parsedOk) {
      setBootTrustFallback("legacy");
      console.error(
        '[trusted-networks] config.json is unparseable — not deciding a trust mode; using "legacy" for this process',
      );
      return { mode: "legacy", persisted: false };
    }
  }

  const config = load();
  if (resolveTrustMode(config).mode !== null) return { mode: null, persisted: false };

  const list = config.resolvedTrustedNetworks ?? [];
  const decided: TrustMode = list.every(isLoopbackOnlyEntry) ? "pair" : "legacy";
  let failure: string | null = null;
  try {
    const result = write({ network: { trustMode: decided } }, { trustModeOrigin: "upgrade" });
    if (!result.success) failure = result.error ?? "write failed";
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
  }
  if (failure !== null) {
    setBootTrustFallback(decided);
    console.error(
      `[trusted-networks] could not persist network.trustMode "${decided}" (${failure}) — using it for this process; will decide again on the next boot`,
    );
    return { mode: decided, persisted: false };
  }
  console.log(`[trusted-networks] decided network.trustMode "${decided}" (origin: upgrade)`);
  return { mode: decided, persisted: true };
}
