/**
 * Cross-session clustering + recurrence gate (tasks 4.1, 4.2).
 * Clusters candidates by signature (tool sequence + error class + file/topic,
 * already encoded in Candidate.signature) and accumulates distinct sessionIds in
 * a persisted candidates store so a cluster is promoted only when seen in >= N
 * sessions. Below-threshold clusters are held, auto-promoted once a later run
 * raises the count to N.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { defaultRoot, cwdHash } from "./watermark.js";
import type { Candidate, SignalClass } from "./types.js";

export const DEFAULT_RECURRENCE = 3;

export interface HeldCluster {
  signature: string;
  signal: SignalClass;
  sessionIds: string[]; // distinct, accumulated across runs
  sample: Candidate; // a representative candidate for distillation
}

export type CandidateStore = Record<string, HeldCluster>;

export function candidatesPath(cwd: string, root = defaultRoot()): string {
  return join(root, cwdHash(cwd), "candidates.json");
}

export function loadStore(path: string): CandidateStore {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as CandidateStore;
  } catch {
    return {};
  }
}

export function saveStore(path: string, store: CandidateStore): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(store, null, 2));
}

/** Merge a run's candidates into the store, unioning distinct sessionIds. */
export function mergeIntoStore(store: CandidateStore, candidates: Candidate[]): CandidateStore {
  const next: CandidateStore = { ...store };
  for (const c of candidates) {
    const held = next[c.signature];
    if (held) {
      if (!held.sessionIds.includes(c.sessionId)) {
        next[c.signature] = { ...held, sessionIds: [...held.sessionIds, c.sessionId] };
      }
    } else {
      next[c.signature] = {
        signature: c.signature,
        signal: c.signal,
        sessionIds: [c.sessionId],
        sample: c,
      };
    }
  }
  return next;
}

export interface PromotionResult {
  promoted: HeldCluster[];
  remaining: CandidateStore; // below-threshold clusters held for later
}

/** Promote clusters seen in >= N distinct sessions; hold the rest. */
export function promote(store: CandidateStore, n = DEFAULT_RECURRENCE): PromotionResult {
  const promoted: HeldCluster[] = [];
  const remaining: CandidateStore = {};
  for (const [sig, held] of Object.entries(store)) {
    if (held.sessionIds.length >= n) promoted.push(held);
    else remaining[sig] = held;
  }
  return { promoted, remaining };
}
