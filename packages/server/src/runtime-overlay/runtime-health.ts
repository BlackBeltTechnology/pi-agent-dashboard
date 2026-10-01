/**
 * `/api/health.runtime` — which dashboard runtime is serving (D10).
 *
 * Identity comes from the env Electron stamps at spawn
 * (`PI_DASHBOARD_RUNTIME_ID`, `PI_DASHBOARD_RUNTIME_ORIGIN`); a non-Electron
 * server reports `npmGlobal`. `updatable` drives ONLY the runtime Updates UI:
 * true only for the Electron starter on a non-devMonorepo runtime. Existing
 * pi-core gates are unchanged. Never throws (health must not 500).
 *
 * See change: electron-runtime-overlay-updates.
 */
import { parseLaunchSource } from "@blackbelt-technology/pi-dashboard-shared/dashboard-starter.js";
import {
  deriveEffectiveSource,
  type EffectiveSource,
  type LocalSnapshot,
  type RuntimeFailure,
  type RuntimeRequest,
  type RuntimeState,
} from "@blackbelt-technology/pi-dashboard-shared/runtime-overlay/state.js";

type RuntimeOrigin = "bundled" | "overlay" | "local" | "devMonorepo" | "npmGlobal";

export interface RuntimeHealth {
  origin: RuntimeOrigin;
  /** Runtime id: `X`, `local:<realpath>`, `bundled`, `devMonorepo`, or `npmGlobal`. */
  id: string;
  version: string;
  updatable: boolean;
  source?: EffectiveSource;
  channel?: string;
  pin?: string;
  pending?: string;
  gitSha?: string | null;
  dirty?: boolean;
  lastFailure?: RuntimeFailure;
  /** Electron owner token (`PI_DASHBOARD_ELECTRON_INSTANCE`); local callers only. */
  owner?: string;
}

const ELECTRON_ORIGINS: ReadonlySet<string> = new Set(["bundled", "overlay", "local", "devMonorepo"]);

function safe<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

export function buildRuntimeHealth(input: {
  env: Record<string, string | undefined>;
  serverVersion: string;
  readRequest: () => RuntimeRequest | null;
  readState: () => RuntimeState;
  /** Git snapshot of a linked checkout (only called for origin `local`). */
  localSnapshot?: (checkoutPath: string) => LocalSnapshot;
}): RuntimeHealth {
  const electron = parseLaunchSource(input.env) === "electron";
  const rawOrigin = input.env.PI_DASHBOARD_RUNTIME_ORIGIN;
  const origin: RuntimeOrigin = electron && rawOrigin && ELECTRON_ORIGINS.has(rawOrigin) ? (rawOrigin as RuntimeOrigin) : "npmGlobal";
  const id = origin === "npmGlobal" ? "npmGlobal" : (input.env.PI_DASHBOARD_RUNTIME_ID ?? origin);
  const health: RuntimeHealth = {
    origin,
    id,
    version: input.serverVersion,
    updatable: electron && origin !== "devMonorepo" && origin !== "npmGlobal",
  };
  if (!electron) return health;
  if (input.env.PI_DASHBOARD_ELECTRON_INSTANCE) health.owner = input.env.PI_DASHBOARD_ELECTRON_INSTANCE;

  const request = safe(input.readRequest, null);
  const state = safe(input.readState, {} as RuntimeState);
  health.source = deriveEffectiveSource(request, state);
  if (typeof request?.channel === "string") health.channel = request.channel;
  if (typeof request?.pin === "string") health.pin = request.pin;
  if (typeof request?.pending === "string") health.pending = request.pending;
  if (state.lastFailure) health.lastFailure = state.lastFailure;
  if (origin === "local" && id.startsWith("local:") && input.localSnapshot) {
    const snap = safe(() => input.localSnapshot?.(id.slice("local:".length)) ?? null, null);
    if (snap) {
      health.gitSha = snap.gitSha;
      health.dirty = snap.dirty;
    }
  }
  return health;
}

/**
 * Public view for callers that are neither authenticated nor genuinely local:
 * `/api/health` is tunnel-reachable and must not disclose filesystem paths or
 * private repo identity. Local ids collapse to `local`; git snapshot,
 * failure details and the Electron owner token are dropped. Electron probes from localhost → full view.
 */
export function redactRuntimeHealth(h: RuntimeHealth): RuntimeHealth {
  const { gitSha: _g, dirty: _d, lastFailure: _f, owner: _o, ...rest } = h;
  return { ...rest, id: h.id.startsWith("local:") ? "local" : h.id };
}

/**
 * Cached provider for the health route: the route handler never touches the
 * filesystem (unauthenticated, frequently polled — CodeQL
 * js/missing-rate-limiting). Electron servers refresh state every
 * `refreshMs`; the local git snapshot is taken once (a restart refreshes it).
 */
export function createRuntimeHealthProvider(input: {
  env: Record<string, string | undefined>;
  serverVersion: string;
  readRequest: () => RuntimeRequest | null;
  readState: () => RuntimeState;
  localSnapshot?: (checkoutPath: string) => LocalSnapshot;
  refreshMs?: number;
}): { get: () => RuntimeHealth; stop: () => void } {
  let snapshot: LocalSnapshot | null = null;
  const localSnapshot = input.localSnapshot
    ? (p: string) => {
        snapshot ??= input.localSnapshot?.(p) ?? null;
        return snapshot ?? { gitSha: null, dirty: false };
      }
    : undefined;
  const compute = () => buildRuntimeHealth({ ...input, localSnapshot });
  let current = compute();
  if (parseLaunchSource(input.env) !== "electron") return { get: () => current, stop: () => {} };
  const timer = setInterval(() => {
    current = compute();
  }, input.refreshMs ?? 2_000);
  timer.unref?.();
  return { get: () => current, stop: () => clearInterval(timer) };
}
