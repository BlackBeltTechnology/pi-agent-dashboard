/**
 * Seeding decision table for `register` (harness: memory-session-manager.test.ts)
 * and the extractor-version round-trip through the full-overwrite save
 * (harness: meta-persistence.test.ts).
 *
 * test-plan #E17 #E23. See change: count-non-message-usage.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { STATS_EXTRACTOR_VERSION } from "@blackbelt-technology/pi-dashboard-shared/usage-totals.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMetaPersistence } from "../persistence/meta-persistence.js";
import { createMemorySessionManager, normalizeUsageSeed } from "../session/memory-session-manager.js";
import { sessionToMeta } from "../session/session-to-meta.js";

const seed = { tokensIn: 11, tokensOut: 22, cacheRead: 33, cacheWrite: 44, cost: 0.55 };
const five = (s: DashboardSession) => ({
  tokensIn: s.tokensIn,
  tokensOut: s.tokensOut,
  cacheRead: s.cacheRead,
  cacheWrite: s.cacheWrite,
  cost: s.cost,
});

describe("#E17 register: usageSeed applies only to an unknown id", () => {
  it("(a) unknown id + seed → totals = seed, cache included", () => {
    const sm = createMemorySessionManager();
    const s = sm.register({ id: "fork-b", cwd: "/r", source: "tui", usageSeed: seed });
    expect(five(s)).toEqual(seed);
    expect(s.statsExtractorVersion).toBe(STATS_EXTRACTOR_VERSION);
  });

  it("(b) known id + different seed → carried-over totals, seed ignored", () => {
    const sm = createMemorySessionManager();
    sm.register({ id: "a", cwd: "/r", source: "tui" });
    sm.update("a", { tokensIn: 1, tokensOut: 2, cacheRead: 3, cacheWrite: 4, cost: 5, statsExtractorVersion: 1 });
    const s = sm.register({ id: "a", cwd: "/r", source: "tui", usageSeed: seed, registerReason: "reattach" });
    expect(five(s)).toEqual({ tokensIn: 1, tokensOut: 2, cacheRead: 3, cacheWrite: 4, cost: 5 });
    expect(s.statsExtractorVersion).toBe(1);
  });

  it("(c) unknown id, no seed → all five totals 0", () => {
    const sm = createMemorySessionManager();
    const s = sm.register({ id: "new", cwd: "/r", source: "tui" });
    expect(five(s)).toEqual({ tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
  });
});

describe("normalizeUsageSeed (untrusted socket input)", () => {
  it("passes a well-formed seed", () => {
    expect(normalizeUsageSeed(seed)).toEqual(seed);
  });
  it.each([
    [undefined],
    ["x"],
    [{ ...seed, cost: -1 }],
    [{ ...seed, tokensIn: Number.NaN }],
    [{ ...seed, cacheRead: "5" }],
    [{ tokensIn: 1 }],
  ])("drops malformed %j", (raw) => {
    expect(normalizeUsageSeed(raw)).toBeUndefined();
  });
});

describe("#E23 extractor version survives a routine full-overwrite save", () => {
  let tmp: string | undefined;
  afterEach(() => {
    vi.useRealTimers();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("sessionToMeta → metaPersistence.save keeps statsExtractorVersion", () => {
    vi.useFakeTimers();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "e23-"));
    const sf = path.join(tmp, "s.jsonl");
    const session = {
      id: "s",
      cwd: "/r",
      source: "tui",
      status: "active",
      startedAt: 1,
      tokensIn: 1,
      tokensOut: 1,
      cost: 0,
      sessionFile: sf,
      statsExtractorVersion: STATS_EXTRACTOR_VERSION,
    } as DashboardSession;
    const mp = createMetaPersistence();
    mp.save(sf, sessionToMeta(session));
    vi.advanceTimersByTime(1000);
    mp.dispose();
    expect(readSessionMeta(sf)?.statsExtractorVersion).toBe(STATS_EXTRACTOR_VERSION);
  });
});
