/**
 * The one place the spawn recovery window and its ordering margin are defined.
 *
 * `spawnRegisterTimeoutMs` is user-configurable; every TTL that decides what
 * happens AFTER it fires used to be a hardcoded 60s literal, so raising the
 * timeout guaranteed the correlation token was already dead when the watchdog
 * fired. Both the watchdog's `recentlyFired` eviction and every correlation TTL
 * now import these constants and derive from the SAME timeout value that armed
 * the spawn — see design D1.
 *
 * `ORDERING_MARGIN_MS` covers the fact that `record()` and `arm()` have no
 * fixed order (record-then-arm on the spawn path, arm-then-record on the
 * resume/fork and degrade paths): without it the correlation clock and the
 * recovery-window clock start at different instants and the correlation can
 * expire just before the window closes — a banner that clears with no card.
 *
 * See change: fix-spawn-correlation-ttl-coupling.
 */

import { clampSpawnRegisterTimeoutMs } from "@blackbelt-technology/pi-dashboard-shared/config.js";

/** How long after a watchdog fire a late register can still be recovered. */
export const RECOVERY_GRACE_MS = 60_000;

/** Slack covering the unfixed record/arm statement ordering. */
export const ORDERING_MARGIN_MS = 5_000;

/**
 * TTL for state that must outlive the watchdog armed for the SAME spawn.
 *
 * `timeoutMs` MUST be the value used to arm that spawn's watchdog, not a fresh
 * config read — a live Settings change between arm and record would otherwise
 * desynchronize the two.
 */
export function deriveSpawnCorrelationTtlMs(timeoutMs: number): number {
  return clampSpawnRegisterTimeoutMs(timeoutMs) + RECOVERY_GRACE_MS + ORDERING_MARGIN_MS;
}
