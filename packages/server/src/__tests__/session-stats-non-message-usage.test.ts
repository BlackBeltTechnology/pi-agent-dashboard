/**
 * Non-message usage in the derived (JSONL) totals + the extractor-version
 * re-extract trigger. Real `extractSessionStats` over real JSONL fixtures
 * (harness: session-scanner.test.ts); the scanner cases wrap the real reader
 * in a pass-through spy so "JSONL not read" is observable.
 *
 * test-plan #E1 #E2 #E3 #E4 (derived) #E9 #E21 #E22.
 * See change: count-non-message-usage.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { metaPath, readSessionMeta, writeSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import { STATS_EXTRACTOR_VERSION, sumEntryUsage } from "@blackbelt-technology/pi-dashboard-shared/usage-totals.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { replayEntriesAsEvents } from "@blackbelt-technology/pi-dashboard-shared/state-replay.js";
import { extractStatsFromEvents } from "../session/event-status-extraction.js";
import { scanAllSessions } from "../session/session-scanner.js";
import { extractSessionStats } from "../session/session-stats-reader.js";

vi.mock("../session/session-stats-reader.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../session/session-stats-reader.js")>();
  return { ...real, extractSessionStats: vi.fn(real.extractSessionStats) };
});

const usage = (u: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; totalTokens?: number; cost?: number }) => ({
  input: u.input ?? 0,
  output: u.output ?? 0,
  cacheRead: u.cacheRead ?? 0,
  cacheWrite: u.cacheWrite ?? 0,
  totalTokens: u.totalTokens ?? 0,
  cost: { total: u.cost ?? 0 },
});

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nmu-"));
  vi.mocked(extractSessionStats).mockClear();
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function writeJsonl(entries: unknown[], name = "2026-03-30T21-39-43-034Z_s1.jsonl", dir = tmp): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`);
  return file;
}

const header = { type: "session", id: "s1", cwd: "/repo", timestamp: "2026-03-30T21:39:43.034Z" };

/** One entry of every usage kind. */
const everyKind = [
  header,
  { type: "model_change", id: "m0", provider: "anthropic", modelId: "claude-sonnet-4-20250514" },
  { type: "message", id: "e1", message: { role: "user", content: "hi" } },
  { type: "message", id: "e2", message: { role: "assistant", content: [], usage: usage({ input: 1000, output: 200, cacheRead: 300, cacheWrite: 40, totalTokens: 12000, cost: 0.01 }) } },
  { type: "message", id: "e3", message: { role: "toolResult", toolCallId: "t1", toolName: "classify", content: [], usage: usage({ input: 300, output: 5, cost: 0.001 }) } },
  { type: "usage", id: "e4", kind: "cache_warm", provider: "anthropic", model: "claude-sonnet-4", usage: usage({ cacheRead: 50000, cost: 0.015 }) },
  { type: "compaction", id: "e5", summary: "s", firstKeptEntryId: "e2", tokensBefore: 1, usage: usage({ input: 40000, output: 900, totalTokens: 40000, cost: 0.12 }) },
  { type: "branch_summary", id: "e6", fromId: "e2", summary: "b", usage: usage({ input: 700, output: 70, cacheWrite: 7, cost: 0.007 }) },
];

describe("derived totals include non-message usage", () => {
  it("#E1 cache-warm usage entry is counted (cost + cacheRead)", () => {
    const f = writeJsonl([header, { type: "usage", id: "u1", kind: "cache_warm", provider: "p", model: "m", usage: usage({ cacheRead: 50000, cost: 0.015 }) }]);
    const s = extractSessionStats(f)!;
    expect(s.cost).toBeCloseTo(0.015, 10);
    expect(s.cacheRead).toBe(50000);
  });

  it("#E2 unknown usage kind is counted", () => {
    const f = writeJsonl([header, { type: "usage", id: "u1", kind: "future_kind", provider: "p", model: "m", usage: usage({ input: 100, output: 20, cost: 0.002 }) }]);
    const s = extractSessionStats(f)!;
    expect(s.tokensIn).toBe(100);
    expect(s.tokensOut).toBe(20);
    expect(s.cost).toBeCloseTo(0.002, 10);
  });

  it("#E3 compaction + branch-summary usage counted, gauge stays on the last assistant", () => {
    const f = writeJsonl([
      header,
      { type: "message", id: "a1", message: { role: "assistant", content: [], usage: usage({ input: 10, totalTokens: 12000 }) } },
      { type: "compaction", id: "c1", summary: "s", firstKeptEntryId: "a1", tokensBefore: 1, usage: usage({ input: 40000, totalTokens: 40000 }) },
      { type: "branch_summary", id: "b1", fromId: "a1", summary: "b", usage: usage({ input: 500, totalTokens: 500 }) },
    ]);
    const s = extractSessionStats(f)!;
    expect(s.tokensIn).toBe(10 + 40000 + 500);
    expect(s.lastTotalTokens).toBe(12000);
  });

  it("#E4 (derived) tool-result usage counted exactly once", () => {
    const tr = { role: "toolResult", toolCallId: "t1", toolName: "classify", content: [], usage: usage({ input: 300 }) };
    const f = writeJsonl([
      header,
      { type: "message", id: "a1", message: { role: "assistant", content: [{ type: "toolCall", id: "t1", name: "classify", arguments: {} }], usage: usage({ input: 1 }) } },
      { type: "message", id: "r1", message: tr },
    ]);
    expect(extractSessionStats(f)!.tokensIn).toBe(1 + 300);
  });

  it("#E9 shared summing helper (usageSeed) agrees with the JSONL reader on every total", () => {
    const f = writeJsonl(everyKind);
    const derived = extractSessionStats(f)!;
    const seed = sumEntryUsage(everyKind);
    expect(seed.tokensIn).toBe(derived.tokensIn);
    expect(seed.tokensOut).toBe(derived.tokensOut);
    expect(seed.cacheRead).toBe(derived.cacheRead);
    expect(seed.cacheWrite).toBe(derived.cacheWrite);
    expect(seed.cost).toBeCloseTo(derived.cost, 12);
    // Every kind contributed (not just the assistant).
    expect(derived.tokensIn).toBe(1000 + 300 + 0 + 40000 + 700);
    expect(derived.cacheRead).toBe(300 + 50000);
    expect(derived.lastTotalTokens).toBe(12000);
  });
});

describe("#E20 hydration (production extractStatsFromEvents over replay) = JSONL-derived totals", () => {
  it("replace-with-replay totals equal extractSessionStats on the same fixture; gauge from the assistant", () => {
    const f = writeJsonl(everyKind);
    const derived = extractSessionStats(f)!;
    const replay = replayEntriesAsEvents("s1", everyKind.slice(1), 1_000_000);
    const hydrated = extractStatsFromEvents(replay.map((m) => m.event as any))!;
    expect(hydrated.tokensIn).toBe(derived.tokensIn);
    expect(hydrated.tokensOut).toBe(derived.tokensOut);
    expect(hydrated.cacheRead).toBe(derived.cacheRead);
    expect(hydrated.cacheWrite).toBe(derived.cacheWrite);
    expect(hydrated.cost).toBeCloseTo(derived.cost, 12);
    expect(hydrated.contextTokens).toBe(12000);
    expect(hydrated.contextWindow).toBe(1_000_000);
  });
});

describe("#E21 / #E22 extractor-version re-extract", () => {
  function cwdDir(): string {
    const d = path.join(tmp, "--repo--");
    fs.mkdirSync(d, { recursive: true });
    return d;
  }
  const fresh = () => Date.now() + 10 * 86_400_000; // JSONL never newer than cache

  it("(a) non-archived versionless sidecar is re-extracted and stamped", () => {
    const f = writeJsonl(everyKind, undefined, cwdDir());
    writeSessionMeta(f, { cwd: "/repo", status: "ended", tokensIn: 1000, cost: 0.01, cachedAt: fresh() });
    const r = scanAllSessions(tmp);
    expect(vi.mocked(extractSessionStats)).toHaveBeenCalledWith(f);
    expect(r.sessions[0].tokensIn).toBe(1000 + 300 + 40000 + 700);
    expect(readSessionMeta(f)?.statsExtractorVersion).toBe(STATS_EXTRACTOR_VERSION);
  });

  it("(b) current-version sidecar reuses cached totals without reading the JSONL", () => {
    const f = writeJsonl(everyKind, undefined, cwdDir());
    writeSessionMeta(f, { cwd: "/repo", status: "ended", tokensIn: 7, cost: 0.5, cachedAt: fresh(), statsExtractorVersion: STATS_EXTRACTOR_VERSION });
    const r = scanAllSessions(tmp);
    expect(vi.mocked(extractSessionStats)).not.toHaveBeenCalled();
    expect(r.sessions[0].tokensIn).toBe(7);
    expect(r.sessions[0].statsExtractorVersion).toBe(STATS_EXTRACTOR_VERSION);
  });

  it("(c) archived versionless sidecar: JSONL not opened, sidecar untouched", () => {
    const f = writeJsonl(everyKind, undefined, cwdDir());
    writeSessionMeta(f, { cwd: "/repo", status: "ended", archived: true, archivedAt: 9000, endedAt: 8000, cachedAt: fresh() });
    const before = fs.readFileSync(metaPath(f), "utf-8");
    const r = scanAllSessions(tmp);
    expect(vi.mocked(extractSessionStats)).not.toHaveBeenCalled();
    expect(r.archived.map((a) => a.id)).toContain("s1");
    expect(fs.readFileSync(metaPath(f), "utf-8")).toBe(before);
  });

  it("#E22 version-triggered re-extract keeps the persisted contextWindow", () => {
    const f = writeJsonl(everyKind, undefined, cwdDir());
    writeSessionMeta(f, {
      cwd: "/repo",
      status: "ended",
      model: "anthropic/claude-sonnet-4-20250514",
      contextWindow: 1_000_000,
      cachedAt: fresh(),
    });
    const r = scanAllSessions(tmp);
    expect(vi.mocked(extractSessionStats)).toHaveBeenCalledWith(f);
    expect(r.sessions[0].contextWindow).toBe(1_000_000);
    expect(readSessionMeta(f)?.contextWindow).toBe(1_000_000);
  });
});
