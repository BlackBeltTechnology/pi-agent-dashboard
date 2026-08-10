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

/** Get the current tunnel status for the REST endpoint. */
export function getTunnelStatus(): TunnelStatus {
  const serverOs = process.platform;
  const url = zrokRuntime.getTunnelUrl();
  if (url) {
    const wd = getTunnelWatchdogStatus();
    return wd
      ? { status: "active", url, serverOs, watchdog: wd }
      : { status: "active", url, serverOs };
  }
  if (detectZrokBinary()) {
    return { status: "inactive", serverOs };
  }
  return { status: "unavailable", serverOs };
}
