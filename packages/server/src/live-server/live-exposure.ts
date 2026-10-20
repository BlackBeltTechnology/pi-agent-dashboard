/**
 * Preview exposure: is the dashboard reachable only from this machine?
 *
 * `exposed` when ANY of: the resolved bind host is not loopback-only (an
 * unparseable value counts as exposed), a non-local endpoint exists (tunnel,
 * `publicBaseUrls`, TLS listener), a request carrying a forwarding header has
 * been seen since start (sticky — fails closed), or the operator set
 * `liveServer.previewExposure: "exposed"` (covers a same-host relay that adds
 * no header, e.g. `ssh -L`). Otherwise `local-only`.
 *
 * Every change of the computed value bumps a monotonic epoch and notifies the
 * listeners (the server revokes restricted scripted local-only tokens and pushes
 * `preview_exposure_changed` to the browsers). Inputs are injected so the
 * predicate is a plain matrix test.
 *
 * See change: improve-canvas-html-and-url-ux (design D5).
 */
import { isIP } from "node:net";
import { hasProxyForwardingHeaders } from "../auth/localhost-guard.js";
import type { LiveCapabilityStore, LiveExposure } from "./live-capability.js";
import { type LiveLogSink, liveLog } from "./live-log.js";

export interface ExposureInputs {
  /** The bind host this process actually bound (`127.0.0.1`, `0.0.0.0`, a LAN IP, a name, ...). */
  getBindHost: () => string;
  /** Non-local endpoints (tunnel / publicBaseUrls / TLS listener) — empty when none. */
  getEndpoints: () => readonly string[];
  /** `liveServer.previewExposure` from config (`"exposed"` forces exposed). */
  getConfigOverride?: () => string | undefined;
}

export interface ExposureState {
  exposure: LiveExposure;
  epoch: number;
}

/** Is `host` unambiguously loopback-only? Names other than `localhost` are NOT (fail closed). */
export function isLoopbackBindHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost") return true;
  if (h === "::1") return true;
  if (isIP(h) === 4) return h.split(".")[0] === "127";
  return false;
}

/** Pure predicate: the matrix of design D5. */
export function computeExposure(args: {
  bindHost: string;
  endpoints: readonly string[];
  forwardedSeen: boolean;
  configOverride?: string;
}): LiveExposure {
  if (args.configOverride === "exposed") return "exposed";
  if (args.forwardedSeen) return "exposed";
  if (args.endpoints.length > 0) return "exposed";
  return isLoopbackBindHost(args.bindHost) ? "local-only" : "exposed";
}

export type ExposureListener = (state: ExposureState, previous: ExposureState) => void;

export interface PreviewExposure {
  /** Recompute (cheap) and return the current state; fires listeners on a change. */
  current(): ExposureState;
  /** Note a request's headers: a forwarding header pins `exposed` until restart. */
  noteRequest(headers: Record<string, unknown>): void;
  onChange(listener: ExposureListener): void;
}

export function createPreviewExposure(inputs: ExposureInputs): PreviewExposure {
  let forwardedSeen = false;
  let state: ExposureState | null = null;
  const listeners: ExposureListener[] = [];

  const compute = (): LiveExposure => {
    let endpoints: readonly string[] = [];
    let bindHost = "";
    try {
      endpoints = inputs.getEndpoints();
      bindHost = inputs.getBindHost();
    } catch {
      return "exposed"; // an input we cannot read is an input we cannot trust
    }
    return computeExposure({
      bindHost,
      endpoints,
      forwardedSeen,
      configOverride: inputs.getConfigOverride?.(),
    });
  };

  const current = (): ExposureState => {
    const next = compute();
    if (state === null) {
      state = { exposure: next, epoch: 1 };
      return state;
    }
    if (next !== state.exposure) {
      const previous = state;
      state = { exposure: next, epoch: previous.epoch + 1 };
      for (const l of listeners) {
        try {
          l(state, previous);
        } catch (err) {
          console.error("[live-preview] exposure listener failed:", err);
        }
      }
    }
    return state;
  };

  current(); // fix the baseline now, so a later flip is a real epoch change
  return {
    current,
    noteRequest(headers) {
      if (forwardedSeen) return;
      if (!hasProxyForwardingHeaders(headers)) return;
      forwardedSeen = true;
      current();
    },
    onChange(listener) {
      listeners.push(listener);
    },
  };
}

/**
 * Wire the consequences of an exposure flip: on a change TO `exposed`, revoke every
 * restricted scripts-on token minted while `local-only` (open tokens are the operator's
 * own choice and stay), log the count (no token text), and push `preview_exposure_changed`
 * so open viewers re-mint without scripts. A flip back to `local-only` only notifies.
 */
export function wirePreviewExposure(deps: {
  exposure: PreviewExposure;
  capabilities: Pick<LiveCapabilityStore, "revokeWhere">;
  /** Push `preview_exposure_changed {epoch}` to every browser. */
  broadcast: (epoch: number) => void;
  log?: LiveLogSink;
}): void {
  deps.exposure.onChange((state) => {
    const revoked =
      state.exposure === "exposed"
        ? deps.capabilities.revokeWhere(
            (e) => e.policy.egress === "restricted" && e.policy.scripts && e.mintExposure === "local-only",
          )
        : 0;
    liveLog(deps.log, "exposure changed", { exposure: state.exposure, epoch: state.epoch, revoked });
    deps.broadcast(state.epoch);
  });
}
