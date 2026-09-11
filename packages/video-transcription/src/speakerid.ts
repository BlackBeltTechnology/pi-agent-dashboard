/**
 * Speaker-id matching: deterministic segment sampling, cluster profiling, the
 * centering-pool policy, the decision gates, and drift detection. Everything
 * here is pure logic driven by an injected `EmbedWindow`, so it is testable
 * without the native embedding binding or real audio.
 *
 * See change: add-speaker-id-enrollment.
 */
import type { Cue } from "./srt-parse.js";
import { centroid, cosine, l2 } from "./voiceprint.js";

export interface SegmentOptions {
  /** Ignore segments shorter than this (seconds). */
  minSeg: number;
  /** Maximum segments sampled per cluster. */
  maxSegments: number;
  /** Maximum speech seconds folded into one profile. */
  maxAudio: number;
  /** Embedding window length within a cue (seconds). */
  windowSeconds: number;
}

export const SEGMENT_DEFAULTS: SegmentOptions = {
  minSeg: 1.2,
  maxSegments: 60,
  maxAudio: 120,
  windowSeconds: 10,
};

export const GATE_DEFAULTS = {
  threshold: 0.35,
  margin: 0.1,
  minVote: 0.45,
  minSegments: 3,
  driftThreshold: 0.55,
} as const;

/** Fraction of a pool's audio one speaker may hold before it dominates. */
const DOMINANCE_SHARE = 0.7;

/** Embed one `[start, end)` time range; null when unusable. */
export type EmbedWindow = (start: number, end: number) => Float32Array | null;

export interface ClusterProfile {
  key: string;
  cues: Cue[];
  /** L2-normalised per-segment embeddings actually produced. */
  vectors: Float32Array[];
  /** L2-normalised centroid of `vectors`. */
  centroid: Float32Array;
  /** Total cue duration (seconds) of the whole cluster, not just samples. */
  duration: number;
}

/**
 * Sample segments spread across the timeline (fixed stride, no RNG) — drift is
 * temporal, so longest-first would hide it. Falls back to the longest available
 * segments when none meet `minSeg`.
 */
export function pickSegments(cues: Cue[], opts: SegmentOptions): Cue[] {
  // A cap below 2 would make the stride divide by zero.
  const maxN = Math.max(2, Math.floor(opts.maxSegments));
  const usable = cues.filter((c) => c.end - c.start >= opts.minSeg);
  let pool = usable;
  if (pool.length === 0) {
    pool = [...cues].sort((a, b) => b.end - b.start - (a.end - a.start)).slice(0, maxN);
    return pool;
  }
  if (pool.length > maxN) {
    const picked = new Set<number>();
    const last = pool.length - 1;
    const stride = last / (maxN - 1);
    for (let i = 0; i < maxN; i++) picked.add(Math.round(i * stride));
    pool = [...picked].sort((a, b) => a - b).map((i) => pool[i]);
  }
  const out: Cue[] = [];
  let total = 0;
  for (const c of pool) {
    out.push(c);
    total += Math.min(c.end - c.start, opts.windowSeconds);
    if (total >= opts.maxAudio) break;
  }
  return out;
}

/** Duration of every cue in a cluster, in seconds. */
export function clusterDuration(cues: Cue[]): number {
  return cues.reduce((s, c) => s + (c.end - c.start), 0);
}

/**
 * Profile every cluster: sample segments, embed via `embed`, and build an
 * L2-normalised centroid. A cluster that yields no usable embedding is omitted.
 */
export function profileClusters(
  clusters: Map<string, Cue[]>,
  embed: EmbedWindow,
  opts: SegmentOptions = SEGMENT_DEFAULTS,
): ClusterProfile[] {
  const profiles: ClusterProfile[] = [];
  for (const [key, cues] of clusters) {
    const vectors: Float32Array[] = [];
    for (const c of pickSegments(cues, opts)) {
      const end = Math.min(c.end, c.start + opts.windowSeconds);
      const v = embed(c.start, end);
      if (v && v.length > 0) vectors.push(l2(v));
    }
    if (vectors.length === 0) continue;
    profiles.push({
      key,
      cues,
      vectors,
      centroid: centroid(vectors),
      duration: clusterDuration(cues),
    });
  }
  return profiles;
}

/**
 * The recording's own multi-speaker mean (uncentered), or null when there are
 * fewer than two profiled clusters. Returned raw: centering subtracts it.
 */
export function recordingMean(profiles: ClusterProfile[]): Float32Array | null {
  if (profiles.length < 2) return null;
  const dim = profiles[0].vectors[0].length;
  const sum = new Float64Array(dim);
  let n = 0;
  for (const p of profiles) {
    for (const v of p.vectors) {
      for (let i = 0; i < dim; i++) sum[i] += v[i];
      n++;
    }
  }
  if (n === 0) return null;
  for (let i = 0; i < dim; i++) sum[i] /= n;
  return Float32Array.from(sum);
}

// ---------------------------------------------------------- centering policy

export interface PoolSpeaker {
  key: string;
  duration: number;
}

export interface DominanceResult {
  ok: boolean;
  reason?: "fewer-than-two-speakers" | "no-duration" | "dominant-speaker";
}

/**
 * A centering mean is usable only with ≥ 2 speakers and no speaker above
 * `DOMINANCE_SHARE` of the pool's **audio duration**. Durations, not sampled
 * segment counts: the per-cluster sample cap equalises clusters, so a 95/5
 * interview would sample ~50/50 and the guard would never fire on the shape it
 * exists to catch.
 */
export function dominanceCheck(speakers: PoolSpeaker[]): DominanceResult {
  if (speakers.length < 2) return { ok: false, reason: "fewer-than-two-speakers" };
  const total = speakers.reduce((s, x) => s + x.duration, 0);
  if (total <= 0) return { ok: false, reason: "no-duration" };
  const max = Math.max(...speakers.map((s) => s.duration));
  if (max / total > DOMINANCE_SHARE) return { ok: false, reason: "dominant-speaker" };
  return { ok: true };
}

export interface CenteringChoice {
  mean: Float32Array | null;
  source: "cohort" | "recording" | "none";
  /** True when the cohort was unavailable and the recording mean was used. */
  fallback: boolean;
  /** Set when no usable mean exists; the run must rename nothing. */
  cannotCompensate?: string;
}

export interface CenteringInput {
  cohort: { mean: Float32Array | null; speakers: PoolSpeaker[] };
  recording: { mean: Float32Array | null; speakers: PoolSpeaker[] };
}

/**
 * Prefer the library-wide cohort mean; fall back to the recording's own mean
 * when the cohort is too small. Every pool must pass the dominance test —
 * including the cohort, so a one-speaker cohort is not admitted through the
 * path labelled safe.
 */
export function chooseCentering(input: CenteringInput): CenteringChoice {
  const { cohort, recording } = input;
  if (cohort.mean !== null) {
    const dominance = dominanceCheck(cohort.speakers);
    if (!dominance.ok) {
      return {
        mean: null,
        source: "none",
        fallback: false,
        cannotCompensate:
          dominance.reason === "fewer-than-two-speakers"
            ? "cohort has fewer than two speakers"
            : "cohort is dominated by one speaker",
      };
    }
    return { mean: cohort.mean, source: "cohort", fallback: false };
  }
  if (recording.mean !== null && dominanceCheck(recording.speakers).ok) {
    return { mean: recording.mean, source: "recording", fallback: true };
  }
  const reason =
    recording.speakers.length < 2
      ? "fewer than two speakers in the recording"
      : "recording is dominated by one speaker";
  return { mean: null, source: "none", fallback: false, cannotCompensate: reason };
}

// --------------------------------------------------------------- decision

type DecisionReason =
  | "assigned"
  | "below-threshold"
  | "ambiguous"
  | "weak-vote"
  | "insufficient-segments"
  | "cannot-compensate";

export interface GateOptions {
  threshold: number;
  margin: number;
  minVote: number;
  minSegments: number;
  forceFallbackThresholds?: boolean;
}

export interface GateInput {
  /** Centered per-segment vectors of the cluster. */
  segments: Float32Array[];
  /** Centered voiceprints keyed by name. */
  refs: Map<string, Float32Array>;
  /** True when the cohort was unavailable and the recording mean was used. */
  fallback: boolean;
  options: GateOptions;
}

export interface ClusterDecision {
  name?: string;
  reason: DecisionReason;
  best: number;
  second: number;
  margin: number;
  vote: number;
  segments: number;
  effectiveThreshold: number;
  raises: string[];
  gatesEvaluated: { margin: boolean; vote: boolean };
}

function activeRaises(single: boolean, fallback: boolean, options: GateOptions): string[] {
  const raises: string[] = [];
  if (single) raises.push("single-voiceprint");
  if (fallback && !options.forceFallbackThresholds) raises.push("small-cohort-fallback");
  return raises;
}

/** Best/runner-up similarity of a centroid against the reference set. */
function scoreRefs(
  cen: Float32Array,
  refs: Map<string, Float32Array>,
): { best: number; bestName: string; second: number; hasRunnerUp: boolean } {
  const scored = [...refs.entries()]
    .map(([name, ref]) => ({ name, score: cosine(cen, ref) }))
    .sort((a, b) => b.score - a.score);
  return {
    best: scored[0]?.score ?? 0,
    bestName: scored[0]?.name ?? "",
    second: scored[1]?.score ?? -1,
    hasRunnerUp: scored.length > 1,
  };
}

/** Share of individual segments whose argmax over `refs` is `bestName`. */
function voteShare(segments: Float32Array[], refs: Map<string, Float32Array>, bestName: string): number {
  let agree = 0;
  for (const v of segments) {
    let topName = "";
    let topScore = Number.NEGATIVE_INFINITY;
    for (const [name, ref] of refs) {
      const s = cosine(v, ref);
      if (s > topScore) {
        topScore = s;
        topName = name;
      }
    }
    if (topName === bestName) agree++;
  }
  return segments.length > 0 ? agree / segments.length : 0;
}

function pickReason(
  segments: number,
  best: number,
  margin: number,
  vote: number,
  hasRunnerUp: boolean,
  effectiveThreshold: number,
  options: GateOptions,
): DecisionReason {
  if (segments < options.minSegments) return "insufficient-segments";
  if (best < effectiveThreshold) return "below-threshold";
  if (hasRunnerUp && margin < options.margin) return "ambiguous";
  if (hasRunnerUp && vote < options.minVote) return "weak-vote";
  return "assigned";
}

/** Apply the absolute-threshold, margin and vote gates to one cluster. */
export function decideCluster(input: GateInput): ClusterDecision {
  const { segments, refs, fallback, options } = input;
  const single = refs.size === 1;
  const raises = activeRaises(single, fallback, options);
  const effectiveThreshold = options.threshold + (raises.length > 0 ? options.margin : 0);

  const { best, bestName, second, hasRunnerUp } = scoreRefs(centroid(segments), refs);
  const margin = hasRunnerUp ? best - second : best - -1;
  const vote = voteShare(segments, refs, bestName);
  const reason = pickReason(segments.length, best, margin, vote, hasRunnerUp, effectiveThreshold, options);

  return {
    ...(reason === "assigned" ? { name: bestName } : {}),
    reason,
    best,
    second,
    margin,
    vote,
    segments: segments.length,
    effectiveThreshold,
    raises,
    gatesEvaluated: { margin: !single, vote: !single },
  };
}

/** Group assigned clusters by name, reporting any drift merges. */
export function mapClusters(
  decisions: Map<string, ClusterDecision>,
): { mapping: Map<string, string>; merges: { name: string; keys: string[] }[] } {
  const mapping = new Map<string, string>();
  const byName = new Map<string, string[]>();
  for (const [key, d] of decisions) {
    if (d.name === undefined) continue;
    mapping.set(key, d.name);
    byName.set(d.name, [...(byName.get(d.name) ?? []), key]);
  }
  const merges = [...byName.entries()]
    .filter(([, keys]) => keys.length > 1)
    .map(([name, keys]) => ({ name, keys }));
  return { mapping, merges };
}

// ----------------------------------------------------------------- drift

export interface DriftPair {
  a: string;
  b: string;
  score: number;
}

/**
 * Pairwise similarity between centered cluster centroids, flagging pairs at or
 * above `threshold` as likely one speaker. `analyze` takes no threshold raise —
 * it names nobody, so the drift threshold is advisory by construction.
 */
export function driftPairs(
  centroids: Map<string, Float32Array>,
  threshold: number,
): DriftPair[] {
  const keys = [...centroids.keys()];
  const pairs: DriftPair[] = [];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const score = cosine(centroids.get(keys[i])!, centroids.get(keys[j])!);
      if (score >= threshold) pairs.push({ a: keys[i], b: keys[j], score });
    }
  }
  return pairs.sort((x, y) => y.score - x.score);
}

/** Center each cluster's vectors and return their centroids. */
export function centeredCentroids(
  profiles: ClusterProfile[],
  mean: Float32Array,
): Map<string, Float32Array> {
  const out = new Map<string, Float32Array>();
  for (const p of profiles) {
    const vecs = p.vectors.map((v) => {
      const c = new Float32Array(v.length);
      for (let i = 0; i < v.length; i++) c[i] = v[i] - mean[i];
      return l2(c);
    });
    out.set(p.key, centroid(vecs));
  }
  return out;
}

/** Per-cluster internal coherence: median centered cosine to its own centroid. */
export function clusterCoherence(p: ClusterProfile, mean: Float32Array): number {
  const c = centroid(
    p.vectors.map((v) => {
      const d = new Float32Array(v.length);
      for (let i = 0; i < v.length; i++) d[i] = v[i] - mean[i];
      return l2(d);
    }),
  );
  const scores = p.vectors
    .map((v) => {
      const d = new Float32Array(v.length);
      for (let i = 0; i < v.length; i++) d[i] = v[i] - mean[i];
      return cosine(l2(d), c);
    })
    .sort((a, b) => a - b);
  if (scores.length === 0) return 0;
  const mid = Math.floor(scores.length / 2);
  return scores.length % 2 === 0 ? (scores[mid - 1] + scores[mid]) / 2 : scores[mid];
}
