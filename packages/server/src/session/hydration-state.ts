/**
 * Server-only bookkeeping that ties cold disk hydration to the bridge register:
 *  - a fingerprint of the hydrated branch, so a later register can skip the
 *    wipe when it is provably the same branch (and the store is untouched);
 *  - the leaf id the last bridge register reported (the bridge-learned skip);
 *  - a per-session register generation, so a hydration that was started (or
 *    resolved) before a register never inserts its stale result.
 *
 * Deliberately NOT on `DashboardSession`, which is broadcast to every browser.
 *
 * See change: fix-large-session-resume-replay (D5, D6).
 */

import {
  createReplayExitController,
  type ReplayExitController,
  type ReplayExitControllerOptions,
} from "./replay-exit-controller.js";

/** Bridge-supplied `leafEntryId` is an untrusted string: bound it. */
const LEAF_ENTRY_ID_MAX = 128;

interface HydrationFingerprint {
  entryCount: number;
  leafEntryId: string;
  /** Highest store seq right after the hydration insert. */
  storeMaxSeq: number;
}

export interface SkipWipeInput {
  eventCount: number | undefined;
  /** Already validated with `validLeafEntryId`. */
  leafEntryId: string | undefined;
  liveTailOpen: boolean | undefined;
  hasEvents: boolean;
  storeMaxSeq: number;
  /** `lastEntryCount` + leaf the previous BRIDGE register reported. */
  bridgeLearned: { entryCount: number | undefined; leafEntryId: string | undefined };
  fingerprint: HydrationFingerprint | undefined;
}

export type SkipWipeReason =
  | "bridge-learned"
  | "hydration-learned"
  | "no-event-count"
  | "no-leaf"
  | "no-events"
  | "no-match";

export function validLeafEntryId(v: unknown): string | undefined {
  return typeof v === "string" && v.length >= 1 && v.length <= LEAF_ENTRY_ID_MAX ? v : undefined;
}

/** Pure skip-wipe decision. A skip needs a register carrying a valid `leafEntryId`. */
export function decideSkipWipe(i: SkipWipeInput): { skip: boolean; reason: SkipWipeReason } {
  if (i.eventCount === undefined) return { skip: false, reason: "no-event-count" };
  if (i.leafEntryId === undefined) return { skip: false, reason: "no-leaf" };
  if (!i.hasEvents) return { skip: false, reason: "no-events" };
  if (i.bridgeLearned.entryCount === i.eventCount && i.bridgeLearned.leafEntryId === i.leafEntryId) {
    return { skip: true, reason: "bridge-learned" };
  }
  const fp = i.fingerprint;
  if (
    fp &&
    fp.entryCount === i.eventCount &&
    fp.leafEntryId === i.leafEntryId &&
    i.liveTailOpen === false &&
    fp.storeMaxSeq === i.storeMaxSeq
  ) {
    return { skip: true, reason: "hydration-learned" };
  }
  return { skip: false, reason: "no-match" };
}

/** Replay-mode controller + hydration bookkeeping, built once in `createServer`
 *  and shared by `wireEvents`, the browser gateway and the subscribe handler. */
export interface ReplayState {
  controller: ReplayExitController;
  hydration: HydrationState;
}

export function createReplayState(controllerOpts?: ReplayExitControllerOptions): ReplayState {
  return { controller: createReplayExitController(controllerOpts), hydration: createHydrationState() };
}

interface HydrationState {
  /** Record the fingerprint after a successful hydration insert. */
  recordFingerprint(sessionId: string, fp: HydrationFingerprint): void;
  getFingerprint(sessionId: string): HydrationFingerprint | undefined;
  clearFingerprint(sessionId: string): void;
  /**
   * Count + leaf the last bridge register reported (the bridge-learned skip).
   * Kept here, not on the session record: `register()` rebuilds that record on
   * every re-register, so a field on it never survives to the next comparison.
   */
  setBridgeLearned(sessionId: string, learned: { entryCount: number; leafEntryId: string | undefined }): void;
  getBridgeLearned(sessionId: string): { entryCount: number | undefined; leafEntryId: string | undefined };
  /** Current register generation (0 = never registered / released). */
  generation(sessionId: string): number;
  /** A register happened: every hydration started before it is now stale. */
  bumpRegister(sessionId: string): number;
  /** Unregister: drop the fingerprint + generation (the bridge-learned count + leaf stay so a reconnect can still match them). */
  release(sessionId: string): void;
  /** Session removed: drop everything held for it. */
  forget(sessionId: string): void;
}

function createHydrationState(): HydrationState {
  const fingerprints = new Map<string, HydrationFingerprint>();
  const bridgeLearned = new Map<string, { entryCount: number; leafEntryId: string | undefined }>();
  const generations = new Map<string, number>();
  // Globally unique values: a released-then-re-registered session can never
  // reuse a generation a still-running hydration captured.
  let counter = 0;
  return {
    recordFingerprint: (id, fp) => { fingerprints.set(id, fp); },
    getFingerprint: (id) => fingerprints.get(id),
    clearFingerprint: (id) => { fingerprints.delete(id); },
    setBridgeLearned: (id, learned) => { bridgeLearned.set(id, learned); },
    getBridgeLearned: (id) => bridgeLearned.get(id) ?? { entryCount: undefined, leafEntryId: undefined },
    generation: (id) => generations.get(id) ?? 0,
    bumpRegister: (id) => {
      const next = ++counter;
      generations.set(id, next);
      return next;
    },
    release: (id) => {
      fingerprints.delete(id);
      generations.delete(id);
    },
    forget: (id) => {
      fingerprints.delete(id);
      bridgeLearned.delete(id);
      generations.delete(id);
    },
  };
}
