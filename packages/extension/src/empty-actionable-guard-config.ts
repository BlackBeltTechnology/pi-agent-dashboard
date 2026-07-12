/**
 * Resolve the empty-actionable-turn guard config from the environment.
 *
 * The guard runs inside the child `pi` bridge process, so env vars are the
 * natural config surface. Defaults per spec: `auto-continue` (the bridge always
 * has a continuation channel via `enqueueSystemFollowup`), retry cap 2.
 *
 *   PI_DASHBOARD_EMPTY_TURN_GUARD      = "auto-continue" (default) | "surface-only"
 *   PI_DASHBOARD_EMPTY_TURN_RETRY_CAP  = positive integer (default 2)
 *
 * Pure: env is injected so it is unit-testable.
 *
 * See change: fix-gemini-subagent-silent-tool-schema-failure.
 */

import { DEFAULT_RETRY_CAP, type GuardMode } from "./empty-actionable-guard.js";

export interface GuardConfig {
  mode: GuardMode;
  retryCap: number;
}

export function resolveGuardConfig(env: NodeJS.ProcessEnv = process.env): GuardConfig {
  const rawMode = env.PI_DASHBOARD_EMPTY_TURN_GUARD?.trim();
  const mode: GuardMode = rawMode === "surface-only" ? "surface-only" : "auto-continue";

  const rawCap = env.PI_DASHBOARD_EMPTY_TURN_RETRY_CAP?.trim();
  const parsed = rawCap ? Number.parseInt(rawCap, 10) : Number.NaN;
  const retryCap = Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_RETRY_CAP;

  return { mode, retryCap };
}
