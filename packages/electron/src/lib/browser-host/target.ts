/**
 * The dashboard server the main window's SPA `/ws` currently targets, plus the
 * `/api/health` `instanceId` main fetches from it (Node fetch, no browser
 * Origin — same engine as `remote-probe.ts`). The page origin is never used:
 * after an in-page server switch the page is still the local origin.
 *
 * The caller (trusted renderer) supplies the origin via `setTarget`; main
 * normalises it to `scheme://host:port`, accepts only http(s), and refuses
 * redirects when fetching health.
 *
 * Imports nothing from electron.
 *
 * See change: add-operator-browser-relay (D2 step 4, D7).
 */

const HEALTH_TIMEOUT_MS = 5000;
const MAX_INSTANCE_ID = 128;

export interface TargetPort {
  /** Normalised origin the SPA targets, or undefined (after navigation / before `setTarget`). */
  origin(): string | undefined;
  /** `/api/health` `instanceId` of the target. Rejects when there is no target or it cannot be verified. */
  instanceId(): Promise<string>;
}

export interface Target extends TargetPort {
  /** Throws (and clears the target) on anything but a valid http(s) origin. */
  set(origin: unknown): void;
  clear(): void;
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal; redirect?: "error" | "follow" | "manual" }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export function createTarget(opts: { fetchImpl?: FetchLike } = {}): Target {
  const doFetch: FetchLike = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  let current: string | undefined;

  return {
    origin: () => current,
    set(origin) {
      current = undefined;
      if (typeof origin !== "string") throw new Error("invalid target origin");
      const u = new URL(origin);
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("invalid target origin");
      current = u.origin;
    },
    clear() {
      current = undefined;
    },
    async instanceId() {
      const origin = current;
      if (!origin) throw new Error("no target");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
      try {
        const res = await doFetch(`${origin}/api/health`, { signal: controller.signal, redirect: "error" });
        if (!res.ok) throw new Error("health not ok");
        const id = (await res.json() as { instanceId?: unknown } | null)?.instanceId;
        if (typeof id !== "string" || id.length === 0 || id.length > MAX_INSTANCE_ID) throw new Error("no instanceId");
        return id;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
