/**
 * "A preview reset dashboard cookies" (D7/D10, task 10.6; change: serve-live-previews-on-capability-origin).
 *
 * The server refuses every request that carries a duplicated `pi_dash_*` cookie with
 * `400 {"error":"duplicate_dashboard_cookie"}`. Any such API response bumps `cookieResetEpoch`;
 * each tier-2/3 `LiveFrame` blanks itself when the epoch moved past the one it opened under and
 * shows the banner. Nothing re-opens a frame automatically: a frame is opened again only by
 * mounting / Reload, which takes a fresh baseline.
 */
import { useSyncExternalStore } from "react";

let epoch = 0;
const listeners = new Set<() => void>();

export const getCookieResetEpoch = (): number => epoch;

export function noteDuplicateCookieRefusal(): void {
  epoch += 1;
  for (const l of [...listeners]) l();
}

const subscribe = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

/** Reactive current epoch. */
export const useCookieResetEpoch = (): number => useSyncExternalStore(subscribe, getCookieResetEpoch, getCookieResetEpoch);

/** Tiers whose frames can toss a dashboard cookie (a sibling host or port on the same host: tiers 2 and 3). */
export const isCookieTossTier = (tier: unknown): boolean => tier === 2 || tier === 3;

/** Same-origin `/api/*` 400 carrying `duplicate_dashboard_cookie`? Reads a clone; never consumes the caller's body. */
async function inspect(res: Response): Promise<void> {
  try {
    const body = (await res.clone().json()) as { error?: unknown } | null;
    if (body?.error === "duplicate_dashboard_cookie") noteDuplicateCookieRefusal();
  } catch {
    /* not JSON */
  }
}

/** Wrap `window.fetch` once: observe 400 responses, never alter them. Idempotent via `window.__piCookieResetFetch`. */
export function installCookieResetFetch(): void {
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;
  const w = window as unknown as { __piCookieResetFetch?: boolean };
  if (w.__piCookieResetFetch) return;
  w.__piCookieResetFetch = true;
  const prev = window.fetch;
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const res = await prev.apply(window, args);
    if (res.status === 400) void inspect(res);
    return res;
  };
}
