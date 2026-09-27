/**
 * L1 test-plan #P1 — scan latency: median ≤ 25 ms / 100 KB, and linear growth
 * (t(1 MB) / t(500 KB) ≤ 2.5). HTML fixtures exercise every layer.
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

function medianMs(input: string, runs = 5): number {
  scan(input); // warm-up
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    scan(input, { mode: "strip" });
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(runs / 2)] as number;
}

describe("#P1 scan latency", () => {
  it("stays within 25 ms/100 KB and grows linearly", () => {
    const half = htmlFixture(500 * 1024);
    const full = htmlFixture(1024 * 1024);
    const tHalf = medianMs(half);
    const tFull = medianMs(full);
    expect(tHalf / 5).toBeLessThanOrEqual(25);
    expect(tFull / 10).toBeLessThanOrEqual(25);
    expect(tFull / tHalf).toBeLessThanOrEqual(2.5);
  });
});
