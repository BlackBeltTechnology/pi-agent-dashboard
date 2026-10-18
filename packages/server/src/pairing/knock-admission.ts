/**
 * LAN knock admission (design D2, D3, D5, D12).
 *
 * `admitKnock` evaluates the gates in the spec's order and, on success, records
 * the admission in the `KnockLimiter`. Admission depends ONLY on the socket peer
 * address, the `Host` admission, the proxy-forwarding headers, the live
 * `acceptLanRequests` switch and server state — never on the requester `name` or
 * User-Agent (they are not inputs).
 *
 * Live-per-source and global-live counts are READ from the manager (`liveKnocks`)
 * on every call so they cannot drift; only the sliding windows and the deny /
 * lockout cooldown live in the limiter.
 *
 * See change: add-lan-knock-pairing.
 */
import type { KnockRefusal } from "@blackbelt-technology/pi-dashboard-shared/pairing-knock.js";
import type { FastifyRequest } from "fastify";
import { type HostAdmissionOptions, isHostAdmitted } from "../auth/host-admission.js";
import { hasLocalProof, type LocalTrustContext } from "../auth/local-proof.js";
import {
  hasProxyForwardingHeaders,
  isOnLinkPrivate,
  knockSourceKey,
  type LanInterface,
} from "../auth/localhost-guard.js";

/** Per-source admitted knocks allowed inside {@link WINDOW_MS}. */
const SOURCE_WINDOW_MAX = 5;
/** Admitted knocks allowed across ALL sources inside {@link WINDOW_MS}. */
const GLOBAL_WINDOW_MAX = 10;
/** Live knocks allowed across all sources. */
const GLOBAL_LIVE_MAX = 3;
const WINDOW_MS = 10 * 60_000;
const COOLDOWN_MS = 10 * 60_000;
const DEFAULT_MAX_SOURCES = 1024;

/** How a knock entry left the live state (design D12). */
export type KnockOutcome = "denied" | "locked_out" | "approved" | "expired";

interface SourceState {
  admitted: number[];
  cooldownUntil: number;
}

export class KnockLimiter {
  private readonly now: () => number;
  private readonly maxSources: number;
  private readonly sources = new Map<string, SourceState>();
  private globalAdmitted: number[] = [];

  constructor(opts: { now?: () => number; maxSources?: number } = {}) {
    this.now = opts.now ?? Date.now;
    this.maxSources = opts.maxSources ?? DEFAULT_MAX_SOURCES;
  }

  /** Number of tracked sources (bounded by `maxSources`). */
  size(): number {
    return this.sources.size;
  }

  private touch(key: string): SourceState {
    const existing = this.sources.get(key);
    const state = existing ?? { admitted: [], cooldownUntil: 0 };
    // Re-insert so Map iteration order is least-recently-used first.
    this.sources.delete(key);
    this.sources.set(key, state);
    while (this.sources.size > this.maxSources) {
      const oldest = this.sources.keys().next().value;
      if (oldest === undefined) break;
      this.sources.delete(oldest);
    }
    return state;
  }

  private static prune(list: number[], now: number): number[] {
    return list.filter((t) => t > now - WINDOW_MS);
  }

  /** Seconds until a per-source knock may be admitted, or null when it may. */
  sourceRetryAfter(key: string): number | null {
    const now = this.now();
    const state = this.sources.get(key);
    if (!state) return null;
    state.admitted = KnockLimiter.prune(state.admitted, now);
    let until = state.cooldownUntil > now ? state.cooldownUntil : 0;
    if (state.admitted.length >= SOURCE_WINDOW_MAX) {
      until = Math.max(until, state.admitted[state.admitted.length - SOURCE_WINDOW_MAX] + WINDOW_MS);
    }
    return until > now ? Math.max(1, Math.ceil((until - now) / 1000)) : null;
  }

  /** Seconds until the global admitted-window frees a slot, or null. */
  globalRetryAfter(): number | null {
    const now = this.now();
    this.globalAdmitted = KnockLimiter.prune(this.globalAdmitted, now);
    if (this.globalAdmitted.length < GLOBAL_WINDOW_MAX) return null;
    const until = this.globalAdmitted[this.globalAdmitted.length - GLOBAL_WINDOW_MAX] + WINDOW_MS;
    return Math.max(1, Math.ceil((until - now) / 1000));
  }

  recordAdmitted(key: string): void {
    const now = this.now();
    const state = this.touch(key);
    state.admitted = KnockLimiter.prune(state.admitted, now);
    state.admitted.push(now);
    this.globalAdmitted = KnockLimiter.prune(this.globalAdmitted, now);
    this.globalAdmitted.push(now);
  }

  /** Called from the manager's resolution callback. Only denial/lockout cool down. */
  onResolved(key: string, outcome: KnockOutcome): void {
    if (outcome !== "denied" && outcome !== "locked_out") return;
    this.touch(key).cooldownUntil = this.now() + COOLDOWN_MS;
  }
}

export interface KnockAdmissionInput {
  /** Raw socket peer address (`request.socket.remoteAddress`); never `request.ip`. */
  peer: string | undefined;
  headers: Record<string, unknown>;
  host: string | undefined;
}

export interface KnockAdmissionState {
  /** Host admission options, read live (enforce semantics regardless of the global mode). */
  hostAdmission: HostAdmissionOptions;
  /** Live `pairing.acceptLanRequests`. */
  acceptLanRequests: boolean;
  interfaces: readonly LanInterface[];
  /** Live knocks read from the manager. */
  liveKnocks: readonly { sourceKey: string }[];
  limiter: KnockLimiter;
}

export type KnockAdmission =
  | { ok: true; sourceKey: string }
  | { ok: false; error: KnockRefusal; status: 403 | 409 | 429 | 503; retryAfter?: number };

/** First string of a header value (a string, or the first element of a repeated header). */
export function headerString(v: unknown): string | undefined {
  return typeof v === "string" ? v : Array.isArray(v) && typeof v[0] === "string" ? v[0] : undefined;
}

/**
 * The one builder of a knock's admission input: the raw socket peer (never
 * `request.ip`), the raw headers and the normalised `Host`. Shared by the knock
 * route and the `request-access` remedy so the two cannot read a request
 * differently. See change: add-request-access-remedy (design D1).
 */
export function knockPeerInput(request: FastifyRequest): KnockAdmissionInput {
  return {
    peer: request.socket.remoteAddress,
    headers: request.headers as Record<string, unknown>,
    host: headerString(request.headers.host),
  };
}

/** What the knock's pre-switch gates read, as live thunks. */
export interface KnockPeerDeps {
  hostAdmission: () => HostAdmissionOptions;
  getLanInterfaces: () => LanInterface[];
}

/** The slice of {@link KnockAdmissionState} the pre-switch gates need. */
type KnockPeerState = Pick<KnockAdmissionState, "hostAdmission" | "interfaces">;

/** The one gate-state builder: both deps are read per call (never captured). */
export function knockPeerState(deps: KnockPeerDeps): KnockPeerState {
  return { hostAdmission: deps.hostAdmission(), interfaces: deps.getLanInterfaces() };
}

/**
 * The knock's gates that run before the operator switch: Host admission (enforce
 * semantics, DNS rebinding), then a private, on-link, non-loopback peer with no
 * forwarding header. `null` = both pass. A later change to knock eligibility
 * extends this function and `knockPeerState` only.
 */
export function knockPeerGate(
  input: KnockAdmissionInput,
  state: KnockPeerState,
): "host_not_admitted" | "knock_not_lan" | null {
  if (!isHostAdmitted(input.host, state.hostAdmission)) return "host_not_admitted";
  if (hasProxyForwardingHeaders(input.headers) || !isOnLinkPrivate(input.peer, state.interfaces)) return "knock_not_lan";
  return null;
}

/**
 * Would the knock's pre-switch gates pass for this request, from a caller with no
 * verified local credential? The `request-access` remedy predicate. It reads
 * neither the operator switch nor any knock state, so it tells a caller only what
 * the public knock route already tells it. See change: add-request-access-remedy (D2).
 */
export function createRequestAccessAvailable(
  deps: KnockPeerDeps,
  localTrust: LocalTrustContext,
): (request: FastifyRequest) => boolean {
  return (request) =>
    !hasLocalProof(request.headers as Record<string, unknown>, localTrust) &&
    knockPeerGate(knockPeerInput(request), knockPeerState(deps)) === null;
}

export function admitKnock(input: KnockAdmissionInput, state: KnockAdmissionState): KnockAdmission {
  // 1–2. Host admission, then the private on-link peer gate.
  const refused = knockPeerGate(input, state);
  if (refused) return { ok: false, error: refused, status: 403 };
  // 3. Operator switch — after the LAN gate so an off-link caller learns nothing.
  if (!state.acceptLanRequests) return { ok: false, error: "knock_disabled", status: 403 };

  const sourceKey = knockSourceKey(input.peer as string);
  // 4. Per-source window + deny/lockout cooldown (before `pending`, so a re-knock
  //    right after a deny reports the cooldown, not "pending").
  const rate = state.limiter.sourceRetryAfter(sourceKey);
  if (rate !== null) return { ok: false, error: "knock_rate_limited", status: 429, retryAfter: rate };
  // 5. One live knock per source.
  if (state.liveKnocks.some((k) => k.sourceKey === sourceKey)) {
    return { ok: false, error: "knock_pending", status: 409 };
  }
  // 6. Global concurrency and global rate.
  if (state.liveKnocks.length >= GLOBAL_LIVE_MAX) {
    return { ok: false, error: "knock_busy", status: 503, retryAfter: 30 };
  }
  const global = state.limiter.globalRetryAfter();
  if (global !== null) return { ok: false, error: "knock_busy", status: 503, retryAfter: global };

  state.limiter.recordAdmitted(sourceKey);
  return { ok: true, sourceKey };
}

/** Refusal-log window: one line per reason per window, then a flush line (D13). */
const REFUSAL_LOG_WINDOW_MS = 60_000;

/**
 * Per-reason throttled refusal logger: the first refusal in a window logs
 * immediately; the rest are counted, and an unref'd timer at the window's end
 * logs `suppressed=<n>` when n > 0 even if no further refusal arrives. Lines
 * carry the reason only — never an address, name, User-Agent or code.
 */
export function createRefusalLogger(
  log: (line: string) => void = (line) => console.log(line),
  windowMs: number = REFUSAL_LOG_WINDOW_MS,
): (reason: KnockRefusal) => void {
  const windows = new Map<KnockRefusal, { suppressed: number }>();
  return (reason) => {
    const open = windows.get(reason);
    if (open) {
      open.suppressed += 1;
      return;
    }
    log(`[pairing] knock refused reason=${reason}`);
    const state = { suppressed: 0 };
    windows.set(reason, state);
    const timer = setTimeout(() => {
      windows.delete(reason);
      if (state.suppressed > 0) log(`[pairing] knock refused reason=${reason} suppressed=${state.suppressed}`);
    }, windowMs);
    timer.unref?.();
  };
}
