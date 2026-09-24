/**
 * Browser half of the prompt capability (change: add-access-grant-dialog, D1a).
 *
 * The server issues a per-socket capability in a `grant_channel` frame. The
 * browser proves a request is prompt-eligible by echoing it in the
 * `X-Pi-Grant-Channel` header; a request without it is never held.
 *
 * Invariants:
 *   - Memory only. Never written to localStorage / sessionStorage / cookies.
 *   - Replaced on reconnect (`setGrantChannel`), cleared on socket close
 *     (`clearGrantChannel`), so it dies with the connection it belongs to.
 *   - Sent only on same-origin `/api/*` fetches, never cross-origin.
 *
 * The fetch seam mirrors `installDeviceAuthFetch`: one idempotent global
 * wrapper, installed at boot, so every held-plane denial site (`/api/file/*`,
 * the session-file read) carries the header without per-call plumbing.
 */
import { useSyncExternalStore } from "react";

/** Header the server reads (`GRANT_CHANNEL_HEADER`, compared case-insensitively). */
export const GRANT_CHANNEL_HEADER = "X-Pi-Grant-Channel";

let capability: string | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

/** Store the capability from a `grant_channel` frame, replacing any previous one. */
export function setGrantChannel(value: string): void {
  if (capability === value) return;
  capability = value;
  notify();
}

/** Forget the capability (socket closed). */
export function clearGrantChannel(): void {
  if (capability === null) return;
  capability = null;
  notify();
}

export function getGrantChannel(): string | null {
  return capability;
}

function subscribeGrantChannel(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether this browser currently holds a prompt capability (S4 banner). */
export function useHasGrantChannel(): boolean {
  return useSyncExternalStore(subscribeGrantChannel, () => capability !== null);
}

function shouldAttach(url: string): boolean {
  try {
    const u = new URL(url, window.location.origin);
    return u.origin === window.location.origin && u.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

/**
 * Wrap `window.fetch` once so same-origin `/api/*` requests echo the
 * capability. Idempotent; never overrides a header the caller set.
 */
export function installGrantChannelFetch(): void {
  const w = window as unknown as { __piGrantChannelFetch?: boolean };
  if (w.__piGrantChannelFetch) return;
  w.__piGrantChannelFetch = true;

  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const value = capability;
    if (!value) return original(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!shouldAttach(url)) return original(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!headers.has(GRANT_CHANNEL_HEADER)) headers.set(GRANT_CHANNEL_HEADER, value);
    return original(input, { ...init, headers });
  };
}
