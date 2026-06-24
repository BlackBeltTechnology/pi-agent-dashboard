/**
 * Distillation with provenance + confidence decay (task 4.3).
 * The deterministic core lives here (provenance assembly, confidence model). The
 * actual natural-language artifact body is produced by a haiku-class subagent on
 * the --apply path (see route.ts / main.ts); tests cover the math, not the LLM.
 */
import type { HeldCluster } from "./cluster.js";
import type { SignalClass } from "./types.js";

export interface Provenance {
  sessionIds: string[];
  model?: string;
  date: string; // ISO of distillation
  confidence: number; // 0..1
}

export interface Artifact {
  signature: string;
  signal: SignalClass;
  provenance: Provenance;
  /** placeholder body; --apply replaces with subagent output */
  body: string;
  stale: boolean;
  expiryNote?: string;
}

export const CONFIDENCE_FLOOR = 0.25;
const DECAY_PER_DAY = 0.01;
const MODEL_CHANGE_PENALTY = 0.2;

export interface ConfidenceInput {
  recurrence: number; // distinct sessions seen
  n: number; // promotion threshold
  ageDays: number; // days since last sighting
  modelChanged: boolean;
  isModelWorkaround: boolean; // workarounds decay fastest
}

/**
 * Confidence rises with recurrence, decays with age / model change, and decays
 * fastest for model-limitation workarounds. Fresh recurrence (ageDays ~ 0)
 * refreshes it; no hard TTL cliff.
 */
export function computeConfidence(i: ConfidenceInput): number {
  const base = clamp(0.3 + 0.2 * (i.recurrence - i.n + 1), 0, 1);
  const decayRate = DECAY_PER_DAY * (i.isModelWorkaround ? 3 : 1);
  const aged = base - i.ageDays * decayRate - (i.modelChanged ? MODEL_CHANGE_PENALTY : 0);
  return clamp(aged, 0, 1);
}

export function isModelWorkaround(signature: string): boolean {
  return /model|token|context.?window|hallucin|workaround/i.test(signature);
}

export function distill(
  cluster: HeldCluster,
  opts: { n: number; now?: Date; lastSeen?: Date; modelChanged?: boolean } = { n: 3 },
): Artifact {
  const now = opts.now ?? new Date();
  const lastSeen = opts.lastSeen ?? now;
  const ageDays = Math.max(0, (now.getTime() - lastSeen.getTime()) / 86_400_000);
  const workaround = isModelWorkaround(cluster.signature);
  const confidence = computeConfidence({
    recurrence: cluster.sessionIds.length,
    n: opts.n,
    ageDays,
    modelChanged: opts.modelChanged ?? false,
    isModelWorkaround: workaround,
  });
  return {
    signature: cluster.signature,
    signal: cluster.signal,
    provenance: {
      sessionIds: [...cluster.sessionIds],
      model: cluster.sample.model,
      date: now.toISOString(),
      confidence,
    },
    body: placeholderBody(cluster),
    stale: confidence < CONFIDENCE_FLOOR,
    expiryNote: workaround
      ? "Model-limitation workaround — expires as models improve."
      : undefined,
  };
}

function placeholderBody(cluster: HeldCluster): string {
  return `[${cluster.signal}] ${cluster.signature} (seen in ${cluster.sessionIds.length} sessions)`;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
