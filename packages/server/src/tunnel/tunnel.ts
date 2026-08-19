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
import type {
  ProviderReadiness,
  TunnelProvider,
} from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import { NgrokProvider } from "../tunnel-providers/ngrok.js";
import { TailscaleProvider } from "../tunnel-providers/tailscale.js";
import { ZeroTierProvider } from "../tunnel-providers/zerotier.js";
import { ZrokProvider } from "../tunnel-providers/zrok.js";
import { evaluateReadiness } from "./tunnel-readiness.js";
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

// ── Provider registry (concurrency + readiness) ─────────────────────

/**
 * One runtime per provider, keyed by id.
 *
 * `tunnel.ts` previously delegated to zrok BY NAME (`getTunnelUrl()` →
 * `zrokRuntime.getTunnelUrl()`) and `ChildTunnelRuntime` cached a single
 * `tunnelUrl`, so running two providers at once was not a config change but an
 * unfinished abstraction. This registry finishes it.
 *
 * Only `kind: "child"` providers get a `ChildTunnelRuntime`: the shipped
 * "child vs daemon lifecycle" requirement already states that daemon providers
 * skip the PID-file and watchdog paths entirely, being driven by idempotent
 * commands against a daemon the server does not own.
 *
 * See change: add-zrok-custom-reserved-name (D5).
 */
export function knownProviders(opts?: { zerotierNetworkId?: string }): TunnelProvider[] {
  return [
    new ZrokProvider(),
    new NgrokProvider(),
    new TailscaleProvider(),
    new ZeroTierProvider({ networkId: opts?.zerotierNetworkId }),
  ];
}

/**
 * Readiness for every known provider.
 *
 * Costs a subprocess per provider, so it is invoked only from the dialog-bound
 * poll — never as a background service.
 */
export async function getProviderReadiness(opts?: {
  zerotierNetworkId?: string;
  timeoutMs?: number;
}): Promise<ProviderReadiness[]> {
  return evaluateReadiness(knownProviders(opts), { timeoutMs: opts?.timeoutMs });
}

/**
 * Origins of every CURRENTLY connected tunnel, across all providers.
 *
 * Feeds the CORS allowlist and nothing else. Emphatically NOT a redirect-base
 * resolver: `resolveRedirectBase()` must keep returning a single origin (the
 * primary's), or the minted OAuth URI and the session cookie's `Secure` flag
 * could describe different origins — the invariant `auth.ts` exists to hold.
 *
 * Recomputed per call so the allowance follows tunnels as they come and go.
 * See change: add-zrok-custom-reserved-name (D4).
 */
export function liveTunnelOrigins(): string[] {
  const out: string[] = [];
  for (const provider of activeProviders.values()) {
    try {
      const status = provider.status();
      if (!status.active) continue;
      for (const e of status.endpoints) out.push(e.url);
    } catch {
      // A throwing provider must not deny every other provider's origin.
    }
  }
  const primary = zrokRuntime.getTunnelUrl();
  if (primary) out.push(primary);
  return out;
}

/**
 * Providers this process has actually connected, keyed by id.
 *
 * Registered on connect and removed on disconnect, so `liveTunnelOrigins()`
 * reflects reality rather than configuration: a provider that is enabled but
 * not running contributes no origin.
 */
const activeProviders = new Map<string, TunnelProvider>();

export function registerActiveProvider(p: TunnelProvider): void {
  activeProviders.set(p.id, p);
}

export function unregisterActiveProvider(id: string): void {
  activeProviders.delete(id);
}

/** Test seam — drops every registration without touching provider state. */
export function _resetActiveProviders(): void {
  activeProviders.clear();
}
