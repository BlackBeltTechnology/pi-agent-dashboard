/**
 * Shared YOLO status for every indicator and activation surface (change:
 * add-access-grant-dialog, tasks 8b.7, 8b.7a, 8b.7b).
 *
 * ONE store, fed by the `yolo` block of `GET /api/access/prompts`: the sidebar
 * pill, the session-surface indicator, the grant dialog, the directory page and
 * the Access page all read the same snapshot, so "is YOLO on?" has one answer.
 * It polls only while something is subscribed; the Access page also publishes
 * each view it fetches, and every mutation calls `refresh()`. Remaining time is
 * derived client-side from `expiresAt` (see `useNow`).
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { fetchAccessPrompts } from "./access-prompts-api.js";
import type { YoloSessionView, YoloView } from "./access-prompts-types.js";

const POLL_MS = 15_000;

/** Split a path into components; `/` and `\` both separate (never a string prefix). */
function components(p: string): string[] {
  return p.split(/[\\/]+/).filter((c) => c !== "");
}

/**
 * True when `cwd` equals or lies inside a root of `session` (every cwd when
 * unscoped). Component-wise: `/repo-secrets` is NOT inside `/repo`.
 */
export function isCwdInYoloScope(cwd: string | undefined, session: YoloSessionView | null): boolean {
  if (!session) return false;
  if (session.unscoped) return true;
  if (!cwd) return false;
  const c = components(cwd);
  return session.roots.some((r) => {
    const root = components(r.path);
    return root.length <= c.length && root.every((part, i) => part === c[i]);
  });
}

/** Milliseconds left, clamped at 0; `null` = environment session (no expiry). */
export function remainingMs(session: YoloSessionView, now: number): number | null {
  return session.expiresAt === null ? null : Math.max(0, session.expiresAt - now);
}

/** `m:ss`, or `h:mm:ss` from one hour up. Seconds round UP. */
export function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

async function loadYolo(): Promise<YoloView | null> {
  const res = await fetchAccessPrompts();
  return res.ok && res.data ? res.data.yolo : null;
}

export class YoloStatusStore {
  private view: YoloView | null = null;
  private key = "null";
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly load: () => Promise<YoloView | null> = loadYolo,
    private readonly pollMs = POLL_MS,
  ) {}

  getSnapshot = (): YoloView | null => this.view;

  /** Replace the snapshot; listeners fire only when it actually changed. */
  publish = (next: YoloView): void => {
    const key = JSON.stringify(next);
    if (key === this.key) return;
    this.key = key;
    this.view = next;
    for (const l of this.listeners) l();
  };

  /** Fetch now. A failure keeps the last known view. */
  refresh = async (): Promise<void> => {
    try {
      const next = await this.load();
      if (next) this.publish(next);
    } catch {
      // offline / unauthorised: keep what we had
    }
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1 && this.timer === null) {
      void this.refresh();
      this.timer = setInterval(() => void this.refresh(), this.pollMs);
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.timer !== null) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  };
}

export const yoloStatus = new YoloStatusStore();

/** The shared YOLO view (`null` until first loaded). */
export function useYoloStatus(store: YoloStatusStore = yoloStatus): YoloView | null {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** Epoch ms, re-rendered every second while `active`. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}
