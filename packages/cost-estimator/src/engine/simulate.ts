/**
 * Uncertainty layer: Beta-PERT sampling per work item, Monte Carlo aggregation,
 * and the cone-of-uncertainty band for the current project phase.
 *
 * A single number is not an estimate. This module is what turns the point value
 * into P50/P85/P95, which is the only defensible thing to put in front of a client.
 */

import {
  CONE_OF_UNCERTAINTY,
  CORRELATED_SHOCK,
  DEFAULT_ITERATIONS,
  DEFAULT_SEED,
  PERT_LAMBDA,
  PERT_SPREAD,
} from "./defaults.js";
import type { Percentiles, Phase, WorkItem } from "./types.js";

/** Deterministic RNG (mulberry32) so a run is reproducible from a seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sample from Gamma(shape, 1) — Marsaglia & Tsang, used to build Beta variates. */
function sampleGamma(shape: number, random: () => number): number {
  if (shape < 1) {
    const u = random();
    return sampleGamma(shape + 1, random) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = gaussian(random);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Box-Muller standard normal. */
function gaussian(random: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = random();
  while (v === 0) v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Draw one Beta-PERT sample on [min, max] with mode `mode`. */
export function samplePert(min: number, mode: number, max: number, random: () => number): number {
  if (max <= min) return mode;
  const alpha = 1 + (PERT_LAMBDA * (mode - min)) / (max - min);
  const beta = 1 + (PERT_LAMBDA * (max - mode)) / (max - min);
  const x = sampleGamma(alpha, random);
  const y = sampleGamma(beta, random);
  return min + ((x / (x + y)) * (max - min));
}

/**
 * Monte Carlo over the work-item tree.
 * Each item's three-point range comes from its risk level, so risk is priced
 * where it lives rather than as a flat project-wide buffer.
 */
export function simulate(
  items: WorkItem[],
  options: { iterations?: number; seed?: number; scale?: number } = {},
): Percentiles {
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;
  const random = rng(options.seed ?? DEFAULT_SEED);
  const scale = options.scale ?? 1;
  const totals = new Float64Array(iterations);

  for (let i = 0; i < iterations; i++) {
    // One correlated project-level shock per iteration, applied to every item.
    // Independent item sampling alone understates tail risk badly.
    const shock = samplePert(CORRELATED_SHOCK.optimistic, CORRELATED_SHOCK.likely, CORRELATED_SHOCK.pessimistic, random);
    let total = 0;
    for (const item of items) {
      const spread = PERT_SPREAD[item.risk];
      total += samplePert(item.hours * spread.optimistic, item.hours, item.hours * spread.pessimistic, random);
    }
    totals[i] = total * scale * shock;
  }

  const sorted = Array.from(totals).sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return {
    p10: at(0.1),
    p50: at(0.5),
    p85: at(0.85),
    p95: at(0.95),
    mean: sorted.reduce((s, v) => s + v, 0) / sorted.length,
  };
}

/** Cone-of-uncertainty band for the phase the project is actually in. */
export function coneBand(phase: Phase | undefined, value: number): { phase: Phase; low: number; high: number } {
  const resolved = phase ?? 'approved-product-definition';
  const [low, high] = CONE_OF_UNCERTAINTY[resolved] ?? CONE_OF_UNCERTAINTY['approved-product-definition'];
  return { phase: resolved, low: value * low, high: value * high };
}
