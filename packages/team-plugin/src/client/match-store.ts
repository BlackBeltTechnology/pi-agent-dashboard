/**
 * Folder → project matching for the sidebar rows (D17): ONE batched
 * `POST /projects/match` for every visible folder, cached per cwd, refreshed by
 * the folder menu's unified refresh and on window focus (no per-row polling).
 * See change: add-team-plugin.
 */
import { useEffect, useSyncExternalStore } from "react";

export interface MatchProject {
  id: string;
  name: string;
  available: boolean;
  source: "config" | "folder";
  agents: number;
  active: number;
}
export interface MatchResult {
  cwd: string;
  project: MatchProject | null;
  enableable: boolean;
  manageable?: boolean;
}
export type MatchState = { status: "loading" } | { status: "error" } | { status: "ready"; result: MatchResult };

const BATCH_MS = 25;
const MAX_BATCH = 200;
const state = new Map<string, MatchState>();
const subscribers = new Map<string, Set<() => void>>();
let pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;
let focusBound = false;

const LOADING: MatchState = { status: "loading" };
const emit = (cwd: string) => {
  for (const cb of subscribers.get(cwd) ?? []) cb();
};

async function flush(): Promise<void> {
  timer = undefined;
  const cwds = [...pending];
  pending = new Set();
  for (let i = 0; i < cwds.length; i += MAX_BATCH) {
    const chunk = cwds.slice(i, i + MAX_BATCH);
    try {
      const res = await fetch("/api/plugins/team/projects/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwds: chunk }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { results: MatchResult[] };
      const byCwd = new Map(body.results.map((r) => [r.cwd, r]));
      for (const cwd of chunk) {
        const r = byCwd.get(cwd);
        state.set(cwd, r ? { status: "ready", result: r } : { status: "error" });
        emit(cwd);
      }
    } catch {
      for (const cwd of chunk) {
        state.set(cwd, { status: "error" });
        emit(cwd);
      }
    }
  }
}

export function requestMatch(cwd: string): void {
  pending.add(cwd);
  timer ??= setTimeout(() => void flush(), BATCH_MS);
}

/** Refetch every folder that currently has a subscriber (one batched call). */
export function invalidateMatches(): void {
  for (const [cwd, subs] of subscribers) if (subs.size > 0) requestMatch(cwd);
}

export function resetMatchStore(): void {
  state.clear();
  subscribers.clear();
  pending = new Set();
  if (timer) clearTimeout(timer);
  timer = undefined;
}

export function useFolderMatch(cwd: string | undefined): MatchState {
  const get = () => (cwd ? (state.get(cwd) ?? LOADING) : LOADING);
  const snapshot = useSyncExternalStore(
    (cb) => {
      if (!cwd) return () => {};
      let set = subscribers.get(cwd);
      if (!set) subscribers.set(cwd, (set = new Set()));
      set.add(cb);
      return () => set.delete(cb);
    },
    get,
    get,
  );
  useEffect(() => {
    if (!cwd) return;
    if (!state.has(cwd)) requestMatch(cwd);
    if (!focusBound && typeof window !== "undefined") {
      focusBound = true;
      window.addEventListener("focus", invalidateMatches);
    }
  }, [cwd]);
  return snapshot;
}
