/**
 * Module-level store for the automatic `pi-anthropic-messages` peer install
 * that follows an Anthropic subscription sign-in.
 *
 * One entry point, `ensureInstall(trigger)`, used by the sign-in hook, the
 * Landing Install button and both Retry buttons — so the vetoes and the
 * "already pending" rule apply everywhere. It makes two FRESH reads
 * (`/api/health`, `/api/packages/recommended`), each bounded to 20 s, never
 * the section's possibly-stale hook state. The source is the module constant
 * and the scope is always `global`; nothing is taken from a response.
 *
 * The store subscribes to `packageQueue` at module load, so a success that
 * auto-clears after 3 s while every surface is unmounted is still latched.
 * Read through `usePeerAutoInstall()` (`useSyncExternalStore`).
 *
 * See change: streamline-first-run (design D1–D3).
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import { getApiBase } from "../api/api-context.js";
import { ANTHROPIC_PEER_ENTRY_ID, ANTHROPIC_PEER_SOURCE, derivePeerState } from "./anthropic-peer.js";
import { packageQueue } from "./package-queue.js";

export type PeerAutoInstallOutcome = "deciding" | "running" | "installed" | "failed";
export type PeerAutoInstallTrigger = "sign-in" | "manual" | "retry";

export interface PeerAutoInstallState {
  /** Bumped by every decision and every reset; late results of an older one are dropped. */
  seq: number;
  outcome: PeerAutoInstallOutcome | null;
  /** Raw installer output on `failed`. */
  message?: string;
}

/** Bound on each fresh read; a timeout counts as "unreadable". */
const READ_TIMEOUT_MS = 20_000;

let state: PeerAutoInstallState = { seq: 0, outcome: null };
const listeners = new Set<() => void>();

function set(next: Omit<PeerAutoInstallState, "seq">, seq = state.seq): void {
  state = { seq, ...next };
  for (const cb of listeners) {
    try {
      cb();
    } catch {
      /* ignore */
    }
  }
}

/** GET a JSON body, rejecting on a non-OK status, a network error or the 20 s bound. */
async function readJson(path: string): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`timeout reading ${path}`));
    }, READ_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      (async () => {
        const res = await fetch(`${getApiBase()}${path}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })(),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

interface RecommendedEntry {
  id?: unknown;
  activeInPi?: unknown;
}

/** The peer's recommended entry, or `undefined` when absent/unreadable. */
function findPeerEntry(body: unknown): RecommendedEntry | undefined {
  const list = (body as { data?: { recommended?: unknown } } | null)?.data?.recommended;
  if (!Array.isArray(list)) return undefined;
  return list.find((e: RecommendedEntry) => e?.id === ANTHROPIC_PEER_ENTRY_ID);
}

async function decide(mySeq: number): Promise<void> {
  const current = () => state.seq === mySeq;
  // Health: an unreadable probe is "no probe yet" (normal on a first run), not a veto.
  const [healthBody, recommendedBody] = await Promise.all([
    readJson("/api/health").catch(() => null),
    readJson("/api/packages/recommended").catch(() => null),
  ]);
  if (!current()) return;

  const probe = derivePeerState(healthBody);
  const entry = recommendedBody === null ? undefined : findPeerEntry(recommendedBody);
  // Rules 1–4: veto → no install.
  if (probe.importFailed || probe.resolving || !entry || entry.activeInPi === true) {
    set({ outcome: null });
    return;
  }
  // Rule 5: follow an install that is already queued or running.
  const pending = packageQueue.getSourceOp(ANTHROPIC_PEER_SOURCE);
  if (pending?.action === "install" && (pending.status === "queued" || pending.status === "running")) {
    set({ outcome: "running" });
    return;
  }
  // Rule 6: constants only.
  packageQueue.enqueue({ source: ANTHROPIC_PEER_SOURCE, action: "install", scope: "global" });
  set({ outcome: "running" });
}

/** Latch the source's install transitions while an install is being followed. */
function onQueueChange(): void {
  if (state.outcome !== "running" && state.outcome !== "failed") return;
  const op = packageQueue.getSourceOp(ANTHROPIC_PEER_SOURCE);
  if (op?.action !== "install") return;
  if (op.status === "success") {
    set({ outcome: "installed" });
  } else if (op.status === "error" && state.outcome === "running") {
    set({ outcome: "failed", message: packageQueue.getMessageForSource(ANTHROPIC_PEER_SOURCE) });
  }
}
packageQueue.subscribe(onQueueChange);

export const peerAutoInstallStore = {
  getSnapshot: (): PeerAutoInstallState => state,
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
  /**
   * Decide once and install when warranted. Sets `deciding` synchronously and
   * never throws: an error resets the store only if this decision is still current.
   */
  ensureInstall(_trigger: PeerAutoInstallTrigger): Promise<void> {
    const mySeq = state.seq + 1;
    set({ outcome: "deciding" }, mySeq);
    return decide(mySeq).catch(() => {
      if (state.seq === mySeq) set({ outcome: null });
    });
  },
  retry(): Promise<void> {
    return peerAutoInstallStore.ensureInstall("retry");
  },
  /** Back to `null`, ignoring any in-flight decision or late queue result. */
  reset(): void {
    if (state.outcome === null) {
      state = { seq: state.seq + 1, outcome: null };
      return;
    }
    set({ outcome: null }, state.seq + 1);
  },
  /** A mounted surface saw the probe report the peer resolving: drop installed/failed. */
  notifyPeerResolving(): void {
    if (state.outcome === "installed" || state.outcome === "failed") set({ outcome: null }, state.seq + 1);
  },
  __resetForTests(): void {
    set({ outcome: null }, state.seq + 1);
  },
};

export function usePeerAutoInstall(): PeerAutoInstallState {
  return useSyncExternalStore(peerAutoInstallStore.subscribe, peerAutoInstallStore.getSnapshot, peerAutoInstallStore.getSnapshot);
}

/**
 * App-level reset: clears the store when `anthropic` goes `true → false`
 * between two successful status reads. `null` (a failed read) never resets
 * and never overwrites the last known value.
 */
export function usePeerAutoInstallReset(anthropicAuthenticated: boolean | null): void {
  const previous = useRef<boolean | null>(null);
  useEffect(() => {
    if (anthropicAuthenticated === null) return;
    if (previous.current === true && anthropicAuthenticated === false) peerAutoInstallStore.reset();
    previous.current = anthropicAuthenticated;
  }, [anthropicAuthenticated]);
}
