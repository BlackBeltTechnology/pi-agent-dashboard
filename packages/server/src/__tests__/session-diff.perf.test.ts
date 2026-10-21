/**
 * Perf budget of `GET /api/session-diff`'s core (`buildSessionDiff` + git
 * enrichment) over a REAL temp git repo with 200 changed files, which is the
 * server's `MAX_FILES` cap and so the worst case a refresh can return.
 *
 * The composer dock refetches this endpoint at turn end, on dirty-count change
 * and on expand (coalesced, ≤ 1 per 2 s), so p95 of one refresh bounds the
 * dock's cost. Budget: p95 < 300 ms over 20 sequential runs. Real git (no
 * mocks); `session-diff.test.ts` mocks `node:fs`/git at module scope, so this
 * lives in its own file.
 *
 * See change: add-composer-dock (task 4.3, test-plan #P1).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSessionDiff, MAX_FILES } from "../session/session-diff.js";

const RUNS = 20;
const BUDGET_MS = 300;
const FILE_COUNT = 200;

let repo = "";

const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: repo, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });

const body = (rev: number) => Array.from({ length: 40 }, (_, i) => `line ${i} rev ${rev}`).join("\n");
const relPath = (i: number) => `src/pkg${i % 10}/file-${i}.ts`;

function writeEvent(path: string, timestamp: number): DashboardEvent {
  return {
    eventType: "tool_execution_start",
    timestamp,
    data: { type: "tool_execution_start", toolName: "Write", toolCallId: `tc-${timestamp}`, args: { path, content: body(2) } },
  };
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "session-diff-perf-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "perf@example.test");
  git("config", "user.name", "perf");
  git("config", "commit.gpgsign", "false");
  for (let i = 0; i < 10; i++) mkdirSync(join(repo, `src/pkg${i}`), { recursive: true });
  for (let i = 0; i < FILE_COUNT; i++) writeFileSync(join(repo, relPath(i)), body(1));
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  // 200 changed files: modify every tracked file the session "wrote".
  for (let i = 0; i < FILE_COUNT; i++) writeFileSync(join(repo, relPath(i)), body(2));
});

afterAll(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

describe("session-diff perf over a 200-file repo (#P1)", () => {
  it("p95 of 20 sequential runs stays under 300 ms", async () => {
    const events = Array.from({ length: FILE_COUNT }, (_, i) => writeEvent(relPath(i), 1_000 + i));

    // Warm-up run (module + fs caches); not part of the measurement.
    const warm = await buildSessionDiff(events, repo);
    expect(warm.files).toHaveLength(FILE_COUNT);
    expect(warm.files.length).toBeLessThanOrEqual(MAX_FILES);
    expect(warm.totalAdditions).toBeGreaterThan(0);

    const samples: number[] = [];
    for (let run = 0; run < RUNS; run++) {
      const start = performance.now();
      const result = await buildSessionDiff(events, repo);
      samples.push(performance.now() - start);
      expect(result.files).toHaveLength(FILE_COUNT);
    }
    expect(samples).toHaveLength(RUNS);

    const sorted = [...samples].sort((a, b) => a - b);
    const p95 = sorted[Math.ceil(0.95 * sorted.length) - 1] as number;
    const median = sorted[Math.floor(sorted.length / 2)] as number;
    console.info(
      `[session-diff.perf] ${FILE_COUNT} files, ${RUNS} runs: median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${(sorted.at(-1) as number).toFixed(1)} ms`,
    );
    expect(p95).toBeLessThan(BUDGET_MS);
  }, 60_000);
});
