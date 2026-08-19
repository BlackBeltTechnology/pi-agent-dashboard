/**
 * Tunnel integration ("Gateway" in the UI).
 *
 * This module is now a thin delegation layer: the provider-neutral lifecycle
 * lives in `tunnel-core.ts` (`ChildTunnelRuntime`) and every zrok-specific
 * detail lives in `tunnel-providers/zrok.ts` (`zrokChildSpec` / `ZrokProvider`).
 * The exported functions here preserve the exact pre-abstraction signatures so
 * `server.ts`, `auth.ts`, and the existing `tunnel*.test.ts` are untouched —
 * behaviour is byte-identical. See change: add-tunnel-providers.
 */
import type { TunnelStatus } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import {
  _resetBinaryCache,
  _setBinaryAvailable,
  detectZrokBinary,
  ensureReservedName,
  loadZrokEnv,
  mintReservedName,
  releaseShare,
  type ZrokEnv,
  zrokRuntime,
} from "../tunnel-providers/zrok.js";
import { getTunnelWatchdogStatus } from "./tunnel-watchdog.js";

export type { TunnelStatus, ZrokEnv };
export {
  _resetBinaryCache,
  _setBinaryAvailable,
  detectZrokBinary,
  ensureReservedName,
  loadZrokEnv,
  mintReservedName,
  releaseShare,
};

// ── PID File Helpers (delegated to the zrok runtime) ────────────────
export function writeZrokPid(pid: number): void {
  zrokRuntime.writePid(pid);
}

export function readZrokPid(): number | null {
  return zrokRuntime.readPid();
}

export function removeZrokPid(): void {
  zrokRuntime.removePid();
}

// ── Stale / orphan cleanup ──────────────────────────────────────────
export async function cleanupStaleZrok(): Promise<void> {
  await zrokRuntime.cleanupStale();
}

export function scavengeOrphanZrokProcesses(port: number): number[] {
  return zrokRuntime.scavengeOrphans(port);
}

// ── Tunnel lifecycle ────────────────────────────────────────────────
export function createTunnel(
  port: number,
  reservedToken?: string,
  retriesLeft: number = 1,
): Promise<string | null> {
  return zrokRuntime.createTunnel(port, reservedToken, retriesLeft);
}

export async function deleteTunnel(port?: number): Promise<void> {
  await zrokRuntime.deleteTunnel(port);
}

export function getTunnelUrl(): string | null {
  return zrokRuntime.getTunnelUrl();
}

/**
 * The reserved name a zrok URL actually serves.
 *
 * v2 URLs are `https://<name>.shares.zrok.io`, v1 `https://<t>.share.zrok.io`.
 * A URL we cannot parse yields `null`, which is treated as "unknown", never as
 * "mismatched" — a parse gap must not manufacture a warning banner.
 */
export function effectiveReservedName(url: string): string | null {
  return /^(?:https?:\/\/)?([a-z0-9-]+)\.shares?\.zrok\.io\b/i.exec(url)?.[1] ?? null;
}

/**
 * Reconcile the CONFIGURED reserved name against the one actually being served.
 *
 * This is the safety net for the window set-time validation cannot cover: a
 * name released or hijacked between being set and being connected. It is a pure
 * comparison on every call, so the watchdog recycling a degraded tunnel keeps
 * producing the same signal instead of a new event per cycle (D2).
 *
 * A tunnel that was never configured to be persistent is NOT degraded — serving
 * an ephemeral URL is exactly what was asked for.
 */
export function reconcileDegraded(
  url: string,
  cfg: { reservedName?: string; persistent?: boolean },
): { configuredName: string; effectiveName?: string } | undefined {
  if (cfg.persistent !== true || !cfg.reservedName) return undefined;
  const effective = effectiveReservedName(url);
  if (effective === cfg.reservedName) return undefined;
  return effective
    ? { configuredName: cfg.reservedName, effectiveName: effective }
    : { configuredName: cfg.reservedName };
}

/**
 * Get the current tunnel status for the REST endpoint.
 *
 * `zrokConfig` is passed in rather than read here so this stays a pure
 * projection over runtime + config and remains directly testable.
 */
export function getTunnelStatus(zrokConfig?: { reservedName?: string; persistent?: boolean }): TunnelStatus {
  const serverOs = process.platform;
  const url = zrokRuntime.getTunnelUrl();
  if (url) {
    const wd = getTunnelWatchdogStatus();
    const degraded = zrokConfig ? reconcileDegraded(url, zrokConfig) : undefined;
    return {
      status: "active",
      url,
      serverOs,
      ...(wd ? { watchdog: wd } : {}),
      ...(degraded ? { degraded } : {}),
    };
  }
  if (detectZrokBinary()) {
    return { status: "inactive", serverOs };
  }
  return { status: "unavailable", serverOs };
}
