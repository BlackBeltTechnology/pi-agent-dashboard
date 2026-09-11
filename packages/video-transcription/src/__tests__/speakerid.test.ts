import { describe, expect, it } from "vitest";
import {
  chooseCentering,
  clusterCoherence,
  clusterDuration,
  decideCluster,
  dominanceCheck,
  driftPairs,
  GATE_DEFAULTS,
  mapClusters,
  pickSegments,
  profileClusters,
  recordingMean,
  SEGMENT_DEFAULTS,
} from "../speakerid.js";
import type { Cue } from "../srt-parse.js";
import { l2 } from "../voiceprint.js";

function cue(start: number, end: number, label = "1"): Cue {
  return { index: "1", start, end, label, text: "" };
}
/** A unit vector whose cosine to e0 is `c`. */
function atCos(c: number): Float32Array {
  return l2([c, Math.sqrt(Math.max(0, 1 - c * c))]);
}
const E0 = l2([1, 0]);
const E1 = l2([0, 1]);
const opts = { ...GATE_DEFAULTS };

function gate(input: {
  segments?: Float32Array[];
  refs: Map<string, Float32Array>;
  fallback?: boolean;
  options?: Partial<typeof GATE_DEFAULTS & { forceFallbackThresholds: boolean }>;
}) {
  return decideCluster({
    segments: input.segments ?? [E0, E0, E0],
    refs: input.refs,
    fallback: input.fallback ?? false,
    options: { ...opts, ...input.options },
  });
}

describe("decision gates", () => {
  it("E1 absolute-threshold boundary", () => {
    const refs = (s: number) =>
      new Map([
        ["Alice", atCos(s)],
        ["Bob", atCos(0)],
      ]);
    expect(gate({ refs: refs(0.349) }).reason).toBe("below-threshold");
    // 0.350 (nudged so float32 rounding cannot push it under the boundary)
    expect(gate({ refs: refs(0.3501) }).name).toBe("Alice");
    expect(gate({ refs: refs(0.351) }).name).toBe("Alice");
  });

  it("E2 margin boundary", () => {
    const refs = (s: number) =>
      new Map([
        ["Alice", atCos(0.8)],
        ["Bob", atCos(s)],
      ]);
    expect(gate({ refs: refs(0.71) }).reason).toBe("ambiguous");
    expect(gate({ refs: refs(0.7) }).name).toBe("Alice");
    expect(gate({ refs: refs(0.69) }).name).toBe("Alice");
  });

  it("E3 vote boundary", () => {
    const refs = new Map([
      ["Alice", E0],
      ["Bob", E1],
    ]);
    const four = [l2([0.95, 0.05]), l2([0.95, 0.05]), l2([0.95, 0.05]), l2([0.95, 0.05])];
    const six = Array.from({ length: 6 }, () => l2([0.55, 0.95]));
    const weak = gate({ segments: [...four, ...six], refs });
    expect(weak.reason).toBe("weak-vote");
    expect(weak.name).toBeUndefined();
    expect(weak.vote).toBeCloseTo(0.4, 6);
    const five = Array.from({ length: 5 }, () => l2([0.95, 0.05]));
    expect(gate({ segments: [...five, ...five], refs }).name).toBe("Alice");
  });

  it("E4 minimum-segment boundary", () => {
    const refs = new Map([
      ["Alice", atCos(0.99)],
      ["Bob", atCos(0)],
    ]);
    expect(gate({ segments: [E0, E0], refs }).reason).toBe("insufficient-segments");
    expect(gate({ segments: [E0, E0, E0], refs }).name).toBe("Alice");
  });

  it("E5 single voiceprint raises the threshold and skips margin/vote", () => {
    const refs = new Map([["Alice", E0]]);
    const low = gate({ segments: [atCos(0.4), atCos(0.4), atCos(0.4)], refs });
    expect(low.effectiveThreshold).toBeCloseTo(0.45, 6);
    expect(low.reason).toBe("below-threshold");
    const high = gate({ segments: [atCos(0.46), atCos(0.46), atCos(0.46)], refs });
    expect(high.name).toBe("Alice");
    expect(high.gatesEvaluated).toEqual({ margin: false, vote: false });
    expect(high.raises).toContain("single-voiceprint");
  });

  it("E6 raises do not stack", () => {
    const refs = new Map([["Alice", atCos(0.5)]]);
    const d = gate({ segments: [E0, E0, E0], refs, fallback: true });
    expect(d.effectiveThreshold).toBeCloseTo(0.45, 6);
    expect(d.raises.sort()).toEqual(["single-voiceprint", "small-cohort-fallback"]);
    expect(d.name).toBe("Alice");
  });

  it("E7 force-fallback-thresholds cancels only the fallback raise", () => {
    const refs = new Map([["Alice", atCos(0.4)]]);
    const d = gate({
      segments: [E0, E0, E0],
      refs,
      fallback: true,
      options: { forceFallbackThresholds: true },
    });
    expect(d.effectiveThreshold).toBeCloseTo(0.45, 6);
    expect(d.raises).toEqual(["single-voiceprint"]);
    expect(d.reason).toBe("below-threshold");
  });

  it("E36 merges several clusters onto one name", () => {
    const decisions = new Map([
      ["1", { ...gate({ refs: new Map([["Alice", E0]]) }), name: "Alice" }],
      ["2", { ...gate({ refs: new Map([["Alice", E0]]) }), name: "Alice" }],
    ]);
    const { mapping, merges } = mapClusters(decisions);
    expect(mapping.get("1")).toBe("Alice");
    expect(merges).toEqual([{ name: "Alice", keys: ["1", "2"] }]);
  });
});

describe("centering pool", () => {
  const mean = l2([1, 0]);
  const spk = (durations: number[]) => durations.map((d, i) => ({ key: `${i}`, duration: d }));

  it("E8 uses the cohort once it reaches the minimum, else the recording", () => {
    const recording = { mean, speakers: spk([100, 100, 100]) };
    expect(chooseCentering({ cohort: { mean: null, speakers: [] }, recording }).source).toBe(
      "recording",
    );
    expect(
      chooseCentering({ cohort: { mean, speakers: spk([100, 100, 100]) }, recording }).source,
    ).toBe("cohort");
  });

  it("E9 dominance boundary is 70% of duration", () => {
    expect(dominanceCheck(spk([69, 31])).ok).toBe(true);
    expect(dominanceCheck(spk([71, 29])).reason).toBe("dominant-speaker");
    expect(
      chooseCentering({ cohort: { mean: null, speakers: [] }, recording: { mean, speakers: spk([71, 29]) } })
        .cannotCompensate,
    ).toBeDefined();
  });

  it("E10 dominance reads duration, not sampled counts", () => {
    // 95/5 duration split; the guard fires on the 95% speaker
    expect(dominanceCheck(spk([95, 5])).ok).toBe(false);
  });

  it("E11 the cohort is rejected as a pool when dominated", () => {
    const c = chooseCentering({
      cohort: { mean, speakers: spk([90, 10]) },
      recording: { mean, speakers: spk([50, 50]) },
    });
    expect(c.source).toBe("none");
    expect(c.cannotCompensate).toMatch(/cohort/);
  });

  it("E12 a single-cluster recording cannot compensate", () => {
    const c = chooseCentering({
      cohort: { mean: null, speakers: [] },
      recording: { mean: null, speakers: spk([100]) },
    });
    expect(c.source).toBe("none");
  });
});

describe("segment sampling", () => {
  it("E30 spans the whole timeline rather than a prefix", () => {
    const cues = Array.from({ length: 120 }, (_, i) => cue(i * 45, i * 45 + 5));
    const picked = pickSegments(cues, { ...SEGMENT_DEFAULTS, maxSegments: 5 });
    expect(picked[0].start).toBe(0);
    expect(picked[picked.length - 1].start).toBeGreaterThan(cues[cues.length - 1].start * 0.9);
  });

  it("E31 is deterministic", () => {
    const cues = Array.from({ length: 200 }, (_, i) => cue(i * 10, i * 10 + 4));
    expect(pickSegments(cues, SEGMENT_DEFAULTS)).toEqual(pickSegments(cues, SEGMENT_DEFAULTS));
  });

  it("E32 falls back to the longest segments when all are short", () => {
    const cues = [cue(0, 0.4), cue(1, 1.2), cue(2, 2.5)];
    const picked = pickSegments(cues, SEGMENT_DEFAULTS);
    expect(picked.length).toBeGreaterThan(0);
    expect(picked[0].start).toBe(2); // longest first
  });

  it("honours the max-audio cap", () => {
    const cues = Array.from({ length: 100 }, (_, i) => cue(i * 20, i * 20 + 10));
    const picked = pickSegments(cues, { ...SEGMENT_DEFAULTS, maxAudio: 25 });
    expect(picked.length).toBeLessThan(5);
  });
});

describe("cluster profiling", () => {
  it("profiles a cluster via an injected embedder", () => {
    const clusters = new Map([["1", [cue(0, 5), cue(10, 15), cue(20, 25)]]]);
    const embed = () => E0;
    const [p] = profileClusters(clusters, embed);
    expect(p.vectors).toHaveLength(3);
    expect(Array.from(p.centroid)).toEqual(Array.from(E0));
    expect(p.duration).toBe(15);
  });

  it("omits a cluster with no usable embedding", () => {
    const clusters = new Map([["1", [cue(0, 5)]]]);
    expect(profileClusters(clusters, () => null)).toEqual([]);
  });

  it("returns a recording mean only with two or more clusters", () => {
    const clusters = new Map([
      ["1", [cue(0, 5)]],
      ["2", [cue(5, 10)]],
    ]);
    expect(recordingMean(profileClusters(clusters, () => E0))).not.toBeNull();
    const one = new Map([["1", [cue(0, 5)]]]);
    expect(recordingMean(profileClusters(one, () => E0))).toBeNull();
  });

  it("clusterDuration sums every cue", () => {
    expect(clusterDuration([cue(0, 5), cue(10, 12.5)])).toBe(7.5);
  });
});

describe("drift analysis", () => {
  it("E33 flags pairs at or above the drift threshold", () => {
    const centroids = new Map([
      ["1", E0],
      ["2", atCos(0.54)],
      ["3", atCos(0.55)],
      ["4", atCos(0.83)],
    ]);
    const pairs = driftPairs(centroids, 0.55);
    const flagged = pairs.map((p) => [p.a, p.b].sort().join("-"));
    expect(flagged).toContain("1-3");
    expect(flagged).toContain("1-4");
    expect(flagged).not.toContain("1-2");
  });

  it("E34 takes the plain threshold with no raise", () => {
    // a pair just under 0.55 is not flagged even though a gate margin exists
    expect(driftPairs(new Map([["1", E0], ["2", atCos(0.54)]]), 0.55)).toEqual([]);
  });

  it("E35 returns nothing with fewer than two clusters", () => {
    expect(driftPairs(new Map([["1", E0]]), 0.55)).toEqual([]);
  });

  it("reports per-cluster coherence", () => {
    const clusters = new Map([["1", [cue(0, 5), cue(5, 10)]]]);
    const profiles = profileClusters(clusters, () => E0);
    expect(clusterCoherence(profiles[0], l2([0, 1]))).toBeCloseTo(1, 5);
  });
});
