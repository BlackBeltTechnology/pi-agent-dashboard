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
  TunnelProviderId,
} from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import { NgrokProvider } from "../tunnel-providers/ngrok.js";
import { TailscaleProvider } from "../tunnel-providers/tailscale.js";
import { ZeroTierProvider } from "../tunnel-providers/zerotier.js";
import { ZrokProvider } from "../tunnel-providers/zrok.js";
import { evaluateReadiness } from "./tunnel-readiness.js";
import { resolveTunnelPlan } from "@blackbelt-technology/pi-dashboard-shared/tunnel-concurrency.js";
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

/**
 * The URL OAuth redirect URIs and the session cookie derive from.
 *
 * Resolves the PRIMARY provider's URL. `resolveRedirectBase()`'s invariant is
 * that this is a single resolution, so that the minted URI and the cookie's
 * `Secure` flag can never describe different origins — which is exactly why a
 * concurrent-tunnel design must still answer with ONE url.
 *
 * When the configured primary is zrok (the default, and every pre-concurrency
 * config) this is byte-identical to the old `zrokRuntime.getTunnelUrl()`.
 *
 * When the primary is NOT connected this returns null and the redirect base
 * falls back exactly as it did before this change. It deliberately does NOT
 * promote some other live tunnel: that would move the sign-in origin without
 * the operator asking, through a path that bypasses the confirmation a
 * deliberate primary switch carries.
 *
 * See change: add-zrok-custom-reserved-name (D3).
 */
export function getTunnelUrl(): string | null {
  const primaryId = primaryProviderId;
  if (!primaryId || primaryId === "zrok") return zrokRuntime.getTunnelUrl();
  const provider = providerSingletons?.get(primaryId);
  if (!provider) return null;
  try {
    const status = provider.status();
    return status.active ? (status.endpoints[0]?.url ?? null) : null;
  } catch {
    return null;
  }
}

/**
 * Which provider is primary. Set from config at boot; `undefined` means the
 * pre-concurrency default, zrok.
 */
let primaryProviderId: TunnelProviderId | undefined;

export function setPrimaryProvider(id: TunnelProviderId | undefined): void {
  primaryProviderId = id;
}

export function getPrimaryProvider(): TunnelProviderId {
  return primaryProviderId ?? "zrok";
}

/**
 * Connect every provider the config resolves to: the primary plus each
 * `tunnel.<id>.enabled` extra.
 *
 * Failure is scoped by primacy, matching `resolveTunnelPlan`: the primary
 * failing is the connect failing (as before this change), while a non-primary
 * failing disables that provider alone and leaves the rest reachable.
 *
 * Non-primary providers are connected but never consulted for the redirect
 * base — they are additional reachable URLs, and `liveTunnelOrigins()` is what
 * makes them CORS-readable.
 *
 * See change: add-zrok-custom-reserved-name (D3/D5).
 */
export async function connectResolvedProviders(
  tunnelConfig: Parameters<typeof resolveTunnelPlan>[0],
  port: number,
  opts?: { zerotierNetworkId?: string; reservedName?: string; persistent?: boolean },
): Promise<{ plan: ReturnType<typeof resolveTunnelPlan>; connected: TunnelProviderId[]; failures: { provider: TunnelProviderId; error: string }[] }> {
  const plan = resolveTunnelPlan(tunnelConfig);
  setPrimaryProvider(tunnelConfig?.provider);
  const connected: TunnelProviderId[] = [];
  const failures: { provider: TunnelProviderId; error: string }[] = [];
  if (plan.refuseConnect) return { plan, connected, failures };

  // Instantiate the singletons once so `status()` (and therefore
  // `liveTunnelOrigins()` and `getTunnelUrl()`) reads the SAME objects that
  // were connected.
  const byId = new Map(knownProviders(opts).map((p) => [p.id, p]));

  for (const entry of plan.providers) {
    const provider = byId.get(entry.provider);
    if (!provider) continue;
    try {
      await provider.connect(port, entry.mode, {
        reservedName: opts?.reservedName,
        persistent: opts?.persistent,
      });
      connected.push(entry.provider);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ provider: entry.provider, error: message });
      // A non-primary failure is scoped to itself; a primary failure is the
      // connect failing, and the caller sees it in `failures`.
    }
  }
  return { plan, connected, failures };
}

/** Disconnect every provider this process connected. */
export async function disconnectResolvedProviders(port: number): Promise<void> {
  for (const provider of providerSingletons?.values() ?? []) {
    try {
      if (provider.status().active) await provider.disconnect(port);
    } catch {
      // One provider's teardown failure must not strand the others.
    }
  }
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
 * One SINGLETON per provider, for the life of the process.
 *
 * Singletons, not fresh instances per call, because a provider's `status()`
 * reads `lastEndpoints` — state recorded when THIS process connected it. A
 * newly constructed provider has none, so a per-call factory would report every
 * tunnel as disconnected and `liveTunnelOrigins()` would silently never widen
 * CORS for anything.
 *
 * `tunnel.ts` previously delegated to zrok BY NAME (`getTunnelUrl()` →
 * `zrokRuntime.getTunnelUrl()`), so running two providers at once was not a
 * config change but an unfinished abstraction. This is the registry that
 * finishes it.
 *
 * Only `kind: "child"` providers carry a `ChildTunnelRuntime`, and their PID
 * files are already named per provider (`zrok.pid`, `ngrok.pid`) so one
 * provider's recycle cannot reap another's process. Daemon providers carry no
 * PID file and no watchdog, per the shipped child-vs-daemon requirement.
 *
 * See change: add-zrok-custom-reserved-name (D5).
 */
let providerSingletons: Map<TunnelProviderId, TunnelProvider> | null = null;

export function knownProviders(opts?: { zerotierNetworkId?: string }): TunnelProvider[] {
  if (!providerSingletons) {
    providerSingletons = new Map<TunnelProviderId, TunnelProvider>([
      ["zrok", new ZrokProvider()],
      ["ngrok", new NgrokProvider()],
      ["tailscale", new TailscaleProvider()],
      ["zerotier", new ZeroTierProvider({ networkId: opts?.zerotierNetworkId })],
    ]);
  }
  return [...providerSingletons.values()];
}

/** Test seam — drops the singletons so the next call rebuilds them. */
export function _resetProviderSingletons(): void {
  providerSingletons = null;
}

/**
 * Test seam — substitute one provider singleton.
 *
 * Exists so that "getTunnelUrl() resolves the PRIMARY" is assertable against a
 * provider whose status is controllable. Without it that test can only observe
 * `null`, which is true whether the resolution works or not — a vacuous
 * assertion is worse than no assertion.
 */
export function _setProviderSingleton(id: TunnelProviderId, provider: TunnelProvider): void {
  if (!providerSingletons) knownProviders();
  providerSingletons?.set(id, provider);
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
 * Recomputed per call so the allowance follows tunnels as they come and go: a
 * provider that disconnects stops contributing an origin on the very next
 * request. Reads `status()` only (in-memory, no shell-out), because this runs
 * on the CORS hot path — the readiness board owns the expensive live probes.
 *
 * See change: add-zrok-custom-reserved-name (D4).
 */
export function liveTunnelOrigins(): string[] {
  const out: string[] = [];
  for (const provider of providerSingletons?.values() ?? []) {
    try {
      const status = provider.status();
      if (!status.active) continue;
      for (const e of status.endpoints) out.push(e.url);
    } catch {
      // A throwing provider must not deny every OTHER provider's origin.
    }
  }
  const primary = zrokRuntime.getTunnelUrl();
  if (primary) out.push(primary);
  return out;
}
