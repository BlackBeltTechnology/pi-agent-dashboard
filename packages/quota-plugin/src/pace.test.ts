import { describe, expect, it } from "vitest";
import { computePace, paceLabel } from "./pace.js";

const NOW = 1_700_000_000_000; // fixed epoch ms
const iso = (deltaSec: number) => new Date(NOW + deltaSec * 1000).toISOString();

describe("computePace", () => {
  it("on pace: usage tracks elapsed time (green, no warn)", () => {
    // 5h window, 50% elapsed, 50% used → projected 100? use 40% used → projected 80.
    const windowSeconds = 5 * 3600;
    const p = computePace({ usedPercent: 40, resetsAt: iso(windowSeconds / 2), windowSeconds }, NOW);
    expect(p.state).toBe("ok");
    expect(p.severity).toBe("green");
    expect(p.warn).toBe(false);
    expect(Math.round(p.projected ?? 0)).toBe(80);
    expect(Math.round(p.elapsedPercent ?? 0)).toBe(50);
    expect(paceLabel(p)).toBe("on pace");
  });

  it("ahead of pace: warns when projected >= 100 (orange)", () => {
    const windowSeconds = 5 * 3600;
    // 25% elapsed, 40% used → projected 160? that's red. Use 60% elapsed, 70% used → projected ~117.
    const p = computePace({ usedPercent: 70, resetsAt: iso(windowSeconds * 0.4), windowSeconds }, NOW);
    expect(p.state).toBe("ok");
    expect(p.warn).toBe(true);
    expect(p.severity).toBe("orange");
    expect(p.overage).toBeGreaterThan(0);
    expect(paceLabel(p)).toMatch(/^over by \d+%$/);
  });

  it("critical: projected >> 100 is red", () => {
    const windowSeconds = 5 * 3600;
    // 20% elapsed, 50% used → projected 250 → red.
    const p = computePace({ usedPercent: 50, resetsAt: iso(windowSeconds * 0.8), windowSeconds }, NOW);
    expect(p.severity).toBe("red");
    expect(p.warn).toBe(true);
  });

  it("critical: usedPercent >= 90 is red even when on pace", () => {
    const windowSeconds = 5 * 3600;
    // 95% elapsed, 92% used → projected < 100 but used >= 90 → red.
    const p = computePace({ usedPercent: 92, resetsAt: iso(windowSeconds * 0.05), windowSeconds }, NOW);
    expect(p.severity).toBe("red");
  });

  it("just reset (elapsedRaw <= EPS) → unavailable, no Infinity/NaN", () => {
    const windowSeconds = 5 * 3600;
    // reset is ~almost a full window away → elapsed ~0.
    const p = computePace({ usedPercent: 10, resetsAt: iso(windowSeconds * 0.999), windowSeconds }, NOW);
    expect(p.state).toBe("unavailable");
    expect(p.projected).toBeNull();
    expect(p.elapsedPercent).toBeNull();
    expect(paceLabel(p)).toBe("pace unavailable");
  });

  it("stale reset (secondsToReset <= 0) → stale, not 'on pace'", () => {
    const windowSeconds = 5 * 3600;
    const p = computePace({ usedPercent: 30, resetsAt: iso(-10), windowSeconds }, NOW);
    expect(p.state).toBe("stale");
    expect(p.severity).toBe("muted");
    expect(paceLabel(p)).not.toBe("on pace");
  });

  it("windowSeconds <= 0 → unavailable", () => {
    const p = computePace({ usedPercent: 30, resetsAt: iso(3600), windowSeconds: 0 }, NOW);
    expect(p.state).toBe("unavailable");
  });

  it("non-finite windowSeconds → unavailable", () => {
    const p = computePace({ usedPercent: 30, resetsAt: iso(3600), windowSeconds: Number.NaN }, NOW);
    expect(p.state).toBe("unavailable");
  });

  it("NaN resetsAt → unavailable", () => {
    const p = computePace({ usedPercent: 30, resetsAt: "not-a-date", windowSeconds: 3600 }, NOW);
    expect(p.state).toBe("unavailable");
  });

  it("finite oversized usedPercent → finite projected/overage (no Infinity)", () => {
    const windowSeconds = 5 * 3600;
    const p = computePace(
      { usedPercent: Number.MAX_VALUE, resetsAt: iso(windowSeconds * 0.5), windowSeconds },
      NOW,
    );
    expect(p.state).toBe("ok");
    expect(Number.isFinite(p.projected ?? Number.NaN)).toBe(true);
    expect(Number.isFinite(p.overage ?? Number.NaN)).toBe(true);
    expect(p.severity).toBe("red");
  });

  it("NaN now → unavailable (never propagates NaN)", () => {
    const p = computePace({ usedPercent: 30, resetsAt: iso(3600), windowSeconds: 7200 }, Number.NaN);
    expect(p.state).toBe("unavailable");
    expect(p.projected).toBeNull();
    expect(p.elapsedPercent).toBeNull();
  });

  it("uses seconds↔ms consistently (resetsAt ms, windowSeconds s)", () => {
    // 2h window, exactly 1h to reset → 50% elapsed.
    const windowSeconds = 2 * 3600;
    const p = computePace({ usedPercent: 50, resetsAt: iso(3600), windowSeconds }, NOW);
    expect(Math.round(p.elapsedPercent ?? 0)).toBe(50);
    expect(Math.round(p.projected ?? 0)).toBe(100);
  });
});
