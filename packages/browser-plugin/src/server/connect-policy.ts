/**
 * `browser_connect {target?}` selection policy (change: add-dedicated-agent-browser, D6).
 *
 * Pure and dependency-injected: the first target is the `target` argument, else
 * `defaultBrowser` (default `@dedicated`). `onUnavailable: "next"` walks the
 * unique sequence first, `@dedicated`, `realProfile`, `@headless`; `"ask"` /
 * `"stop"` stop at the first failure and return `options` / `stopped`. A live
 * dedicated instance held by the CALLING session is closed and reconnected
 * (lost `cdpUrl`, compaction); any other holder is `busy`. Never routes to
 * Panerelay and never looks up or re-sends a `cdpUrl`.
 */
import {
  type BrowserConnectResult,
  type ConnectAttempt,
  type ConnectOption,
  type ConnectOutcome,
  type ConnectPolicyDeps,
  DEDICATED_TARGET,
  HEADLESS_TARGET,
  type OnUnavailable,
  type ProfileView,
} from "./agent-browser-types.js";

const MAX_TARGET = 128;

type Step =
  | { ok: true; result: Extract<BrowserConnectResult, { browser: string }> }
  | { ok: false; reason: string };

const failReason = (r: Extract<ConnectOutcome, { ok: false }>): string =>
  r.reason ?? (r.status !== undefined ? `status-${r.status}` : (r.message ?? "failed").slice(0, 80));

async function profilesOf(deps: ConnectPolicyDeps): Promise<ProfileView[]> {
  try {
    return await deps.installedProfiles();
  } catch {
    return [];
  }
}

function profileReason(profiles: ProfileView[], target: string): string | undefined {
  const p = profiles.find((x) => x.profileDirectory === target);
  return p?.installed ? undefined : "not-installed";
}

/** Availability WITHOUT connecting — used for the `ask` options. */
function availability(deps: ConnectPolicyDeps, profiles: ProfileView[], target: string): string | undefined {
  if (target === HEADLESS_TARGET) return undefined;
  if (target === DEDICATED_TARGET) return dedicatedReason(deps);
  if (target.startsWith("@")) return "unknown-target";
  return profileReason(profiles, target);
}

/** `undefined` = connectable (free, or held by the caller and about to be reconnected). */
function dedicatedReason(deps: ConnectPolicyDeps): string | undefined {
  const st = deps.dedicatedStatus();
  if (!st.available) return st.reason ?? "unavailable";
  if (st.instanceId !== undefined && st.holder !== deps.sessionId) return "busy";
  return undefined;
}

function labelOf(profiles: ProfileView[], target: string): string {
  if (target === DEDICATED_TARGET) return "Dedicated browser";
  if (target === HEADLESS_TARGET) return "Headless browser";
  return profiles.find((p) => p.profileDirectory === target)?.label ?? target;
}

async function attempt(deps: ConnectPolicyDeps, profiles: ProfileView[], target: string): Promise<Step> {
  const liveView = deps.config().openLiveViewOnConnect !== false;
  const attempts: ConnectAttempt[] = []; // replaced by the caller
  if (target === HEADLESS_TARGET) return { ok: true, result: { browser: "headless", attempts } };
  const pre = availability(deps, profiles, target);
  if (pre) return { ok: false, reason: pre };
  try {
    let out: ConnectOutcome;
    if (target === DEDICATED_TARGET) {
      const st = deps.dedicatedStatus();
      // Held by this very session: close it so a fresh instance (and cdpUrl) can be issued.
      if (st.instanceId !== undefined) await deps.disconnect(st.instanceId);
      out = await deps.connectDedicated({ holder: deps.sessionId });
    } else {
      out = await deps.connectProfile(target);
    }
    if (!out.ok) return { ok: false, reason: failReason(out) };
    if (liveView) deps.liveView?.remember(out.instanceId, deps.sessionId);
    return {
      ok: true,
      result:
        target === DEDICATED_TARGET
          ? { browser: "dedicated", instanceId: out.instanceId, cdpUrl: out.cdpUrl, liveView, attempts }
          : { browser: "profile", profileDirectory: target, instanceId: out.instanceId, cdpUrl: out.cdpUrl, liveView, attempts },
    };
  } catch (err) {
    return { ok: false, reason: `error:${(err as Error).message}`.slice(0, 80) };
  }
}

const cleanTarget = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v.slice(0, MAX_TARGET) : undefined;

export async function resolveBrowserConnect(args: { target?: unknown }, deps: ConnectPolicyDeps): Promise<BrowserConnectResult> {
  const cfg = deps.config();
  const policy: OnUnavailable = cfg.onUnavailable === "next" || cfg.onUnavailable === "stop" ? cfg.onUnavailable : "ask";
  const first = cleanTarget(args?.target) ?? cleanTarget(cfg.defaultBrowser) ?? DEDICATED_TARGET;
  const real = cleanTarget(cfg.realProfile);
  const chain = [...new Set([first, DEDICATED_TARGET, ...(real ? [real] : []), HEADLESS_TARGET])];
  const sequence = policy === "next" ? chain : [first];
  const profiles = await profilesOf(deps);

  const attempts: ConnectAttempt[] = [];
  let firstFailure: { target: string; reason: string } | undefined;
  for (const target of sequence) {
    const step = await attempt(deps, profiles, target);
    if (step.ok) {
      attempts.push({ target, ok: true });
      return { ...step.result, attempts };
    }
    attempts.push({ target, ok: false, reason: step.reason });
    firstFailure ??= { target, reason: step.reason };
  }

  const unavailable = firstFailure ?? { target: first, reason: "unavailable" };
  if (policy === "stop") return { unavailable, stopped: true, attempts };
  const options: ConnectOption[] = chain.map((target) => {
    const reason = target === unavailable.target ? unavailable.reason : availability(deps, profiles, target);
    return { target, label: labelOf(profiles, target), available: reason === undefined, ...(reason ? { reason } : {}) };
  });
  return { unavailable, options, attempts };
}
