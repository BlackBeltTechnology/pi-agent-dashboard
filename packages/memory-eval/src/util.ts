import { createHash } from "node:crypto";

export const sha256 = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");

/** Deterministic JSON: object keys sorted recursively, 2-space indent, trailing newline. */
export function stableJson(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) out[k] = sortKeys((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

/** Seeded PRNG (mulberry32). Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Normalise any parseable timestamp to UTC ISO-8601 (ms). Returns null when unparseable. */
export function toUtcIso(ts: string | number): string | null {
  const ms = typeof ts === "number" ? ts : Date.parse(ts);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function epochMs(ts: string | undefined): number | null {
  if (typeof ts !== "string") return null;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : null;
}

/** Plain stderr/stdout sink used by every command so tests can capture output. */
export interface Out {
  out(s: string): void;
  err(s: string): void;
}

export class CliError extends Error {
  constructor(message: string, readonly code = 1) {
    super(message);
  }
}
