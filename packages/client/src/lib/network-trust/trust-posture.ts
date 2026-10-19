/**
 * Client read model for `GET /api/health` → `trustPosture`: the network-trust
 * mode, who decided it and how many device addresses still depend on a network
 * match alone. `null` when the server does not disclose it to this caller.
 *
 * `useTrustPosture` is the one reader for pages that do not already fetch the
 * health payload (Access); the Settings panel parses the payload it already
 * reads. See change: retire-trusted-networks-bypass (D4, D6b).
 */
// Types only: `shared/config.ts` pulls node:fs, so the resolver is mirrored below.
import type { TrustMode, TrustModeOrigin } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { useEffect, useState } from "react";
import { getApiBase } from "../api/api-context.js";

export interface TrustPosture {
  trustedHasLoopback: boolean;
  trustMode: TrustMode;
  trustModeOrigin: TrustModeOrigin | null;
  networkOnly: { admissions: number; distinctPeers: number; lastAt: number | null };
}

/** Mirror of shared `resolveTrustMode` (value imports of `shared/config.ts` are not browser-safe). */
export interface ClientTrustMode {
  /** Effective mode, `null` when nothing is stored. */
  mode: TrustMode | null;
  origin: TrustModeOrigin | null;
  /** The stored value when present but unrecognised (effective mode is then `pair`). */
  unrecognised: string | null;
}

export function resolveClientTrustMode(config: { network?: { trustMode?: string; trustModeOrigin?: string } } | null | undefined): ClientTrustMode {
  const raw = config?.network?.trustMode;
  if (raw === undefined || raw === null) return { mode: null, origin: null, unrecognised: null };
  if (raw === "pair" || raw === "legacy") {
    return { mode: raw, origin: config?.network?.trustModeOrigin === "upgrade" ? "upgrade" : "operator", unrecognised: null };
  }
  return { mode: "pair", origin: null, unrecognised: String(raw) };
}

/** Effective mode for display: the stored value, else the server's own report, else legacy. */
export function displayTrustMode(
  config: { network?: { trustMode?: string; trustModeOrigin?: string } } | null | undefined,
  posture: TrustPosture | null,
): TrustMode {
  return resolveClientTrustMode(config).mode ?? posture?.trustMode ?? "legacy";
}

const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** Tolerant parse of the health payload; anything undisclosed or malformed is `null`. */
export function parseTrustPosture(health: unknown): TrustPosture | null {
  const raw = (health as { trustPosture?: unknown } | null | undefined)?.trustPosture as
    | Record<string, unknown>
    | null
    | undefined;
  if (!raw || typeof raw !== "object") return null;
  if (raw.trustMode !== "pair" && raw.trustMode !== "legacy") return null;
  const origin = raw.trustModeOrigin;
  const net = (raw.networkOnly ?? {}) as Record<string, unknown>;
  return {
    trustedHasLoopback: raw.trustedHasLoopback === true,
    trustMode: raw.trustMode,
    trustModeOrigin: origin === "upgrade" || origin === "operator" ? origin : null,
    networkOnly: {
      admissions: count(net.admissions),
      distinctPeers: count(net.distinctPeers),
      lastAt: typeof net.lastAt === "number" ? net.lastAt : null,
    },
  };
}

/** One `/api/health` read on mount. `posture` stays `null` while loading and when undisclosed. */
export function useTrustPosture(): { posture: TrustPosture | null; loaded: boolean } {
  const [state, setState] = useState<{ posture: TrustPosture | null; loaded: boolean }>({ posture: null, loaded: false });
  useEffect(() => {
    let active = true;
    fetch(`${getApiBase()}/api/health`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (active) setState({ posture: parseTrustPosture(body), loaded: true });
      })
      .catch(() => {
        if (active) setState({ posture: null, loaded: true });
      });
    return () => {
      active = false;
    };
  }, []);
  return state;
}
