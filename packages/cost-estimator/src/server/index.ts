/**
 * cost-estimator · SERVER entry.
 *
 * Exposes measured delivery telemetry over REST so the client can render a cost
 * view without re-reading the session store in the browser.
 *
 * Scanning ~800 sessions costs real I/O, so results are cached for `CACHE_TTL_MS`
 * and recomputed lazily on the next request. This endpoint is read-only: it never
 * writes to the session store.
 *
 * IMPORTANT: the `cost` recorded per session is a METERED API-price computation.
 * When capacity is bought on a flat subscription that figure is theoretical, so
 * the route returns BOTH the meter-equivalent and the actual seat cost, plus the
 * leverage ratio between them. Never present the meter figure as cash out.
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";

import { DEFAULT_SUBSCRIPTION_PLAN, SUBSCRIPTION_PLANS } from "../engine/defaults.js";
import { aggregateByProject, compareSubscription, measureConstants, scanSessions } from "../telemetry/sessions.js";

export interface CostEstimatorConfig {
  gapCapMinutes: number;
  hoursPerDay: number;
  seatPlan: string;
  seatMonthlyUsd: number;
  seats: number;
}

const CACHE_TTL_MS = 60_000;

/**
 * Schema defaults, applied in code.
 *
 * `getPluginConfig()` returns whatever is stored, and nothing is stored until the
 * user first saves the settings form — so relying on JSON-Schema defaults to be
 * materialized would leave a fresh install reporting the METERED basis. That is
 * the one framing this plugin exists to prevent: the meter is a theoretical
 * pay-as-you-go price nobody on a seat plan actually pays. Defaulting here keeps
 * first render honest.
 */
const CONFIG_DEFAULTS: CostEstimatorConfig = {
  gapCapMinutes: 15,
  hoursPerDay: 8,
  seatPlan: DEFAULT_SUBSCRIPTION_PLAN,
  seatMonthlyUsd: 0,
  seats: 1,
};

export function resolveConfig(stored: Partial<CostEstimatorConfig> | undefined | null): CostEstimatorConfig {
  return {
    gapCapMinutes: stored?.gapCapMinutes ?? CONFIG_DEFAULTS.gapCapMinutes,
    hoursPerDay: stored?.hoursPerDay ?? CONFIG_DEFAULTS.hoursPerDay,
    seatPlan: stored?.seatPlan ?? CONFIG_DEFAULTS.seatPlan,
    seatMonthlyUsd: stored?.seatMonthlyUsd ?? CONFIG_DEFAULTS.seatMonthlyUsd,
    seats: stored?.seats ?? CONFIG_DEFAULTS.seats,
  };
}

interface CachedScan {
  at: number;
  key: string;
  payload: unknown;
}

let cache: CachedScan | null = null;

/** Resolve the monthly seat spend from config, or null when metered. */
export function seatMonthly(config: CostEstimatorConfig): number | null {
  if (config.seatPlan === "metered") return null;
  if (config.seatPlan === "custom") return config.seatMonthlyUsd > 0 ? config.seatMonthlyUsd : null;
  return SUBSCRIPTION_PLANS[config.seatPlan]?.monthly ?? null;
}

export default async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  ctx.fastify.get("/api/cost-estimator/telemetry", async () => {
    const config = resolveConfig(ctx.getPluginConfig<Partial<CostEstimatorConfig>>());
    const { gapCapMinutes: gapCap, hoursPerDay, seats } = config;
    const key = `${gapCap}:${hoursPerDay}:${config.seatPlan}:${config.seatMonthlyUsd}:${seats}`;

    if (cache && cache.key === key && Date.now() - cache.at < CACHE_TTL_MS) {
      return cache.payload;
    }

    let records: ReturnType<typeof scanSessions>;
    try {
      records = scanSessions({ gapCapMinutes: gapCap });
    } catch (error) {
      ctx.logger.error("cost-estimator: session scan failed", error);
      return { ok: false, error: "session scan failed", projects: [], measured: null, subscription: null };
    }

    if (records.length === 0) {
      return { ok: true, empty: true, projects: [], measured: null, subscription: null };
    }

    const measured = measureConstants(records, hoursPerDay);
    const projects = aggregateByProject(records, hoursPerDay);
    const monthly = seatMonthly(config);
    const subscription =
      monthly != null ? compareSubscription(measured, monthly * seats) : null;

    const payload = {
      ok: true,
      empty: false,
      generatedAt: Date.now(),
      measured,
      projects,
      subscription,
      seatPlan: config.seatPlan,
      seats,
      // Stated explicitly so no consumer mistakes the meter for cash.
      costBasisNote:
        subscription != null
          ? "measured.totalCost is a METER-EQUIVALENT. subscription.subscriptionCost is the cash figure."
          : "Metered basis: measured.totalCost is the billed figure.",
    };

    cache = { at: Date.now(), key, payload };
    return payload;
  });

  ctx.logger.info("cost-estimator: telemetry route registered");
}
