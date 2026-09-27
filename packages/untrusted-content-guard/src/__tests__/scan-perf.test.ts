/**
 * L1 test-plan #P1 — scan latency: median ≤ 25 ms / 100 KB, and linear growth
 * (t(1 MB) / t(500 KB) ≤ 2.5). HTML fixtures exercise every layer. Sizes are
 * interleaved (9 samples each after warm-up) so noise hits both series alike.
 */

import { describe, expect, it } from "vitest";
import { scan } from "../scanner/scan.js";

function htmlFixture(bytes: number): string {
  const row =
    '<tr><td class="c" style="padding:4px">Item &amp; more\u200B <a href="https://ex.com/?a=1">link</a>' +
    '<span style="display:none">hidden</span> <img src="https://t.co/p.gif?u=1"></td></tr>\n';
  let body = "<!DOCTYPE html><html><head><style>.x{display:none}</style></head><body><table>";
  while (body.length < bytes) body += row;
  return `${body.slice(0, bytes - 30)}</table></body></html>`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
}

function timeScan(input: string): number {
  const t0 = performance.now();
  scan(input, { mode: "strip" });
  return performance.now() - t0;
}

describe("#P1 scan latency", () => {
  it("stays within 25 ms/100 KB and grows linearly", () => {
    const half = htmlFixture(500 * 1024);
    const full = htmlFixture(1024 * 1024);
    // Warm up both, then INTERLEAVE the sizes so GC / scheduler noise lands on
    // both series alike; the median of 9 per size is the statistic.
    for (let i = 0; i < 2; i++) {
      timeScan(half);
      timeScan(full);
    }
    const halfTimes: number[] = [];
    const fullTimes: number[] = [];
    for (let i = 0; i < 9; i++) {
      halfTimes.push(timeScan(half));
      fullTimes.push(timeScan(full));
    }
    const tHalf = median(halfTimes);
    const tFull = median(fullTimes);
    expect(tHalf / 5).toBeLessThanOrEqual(25);
    expect(tFull / 10).toBeLessThanOrEqual(25);
    expect(tFull / tHalf).toBeLessThanOrEqual(2.5);
  });
});
