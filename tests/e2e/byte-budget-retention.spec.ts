import { execSync } from "node:child_process";
import { expect, test } from "./fixtures.js";
import { DASHBOARD_PORT } from "./lifecycle.js";
import {
  awaitBackfillResults,
  divider,
  loadEarlier,
  pinDividerToTop,
  watchBackfillFrames,
  writeConfigAndRestart,
} from "./helpers/windowed-session.js";

/**
 * L3 gate for `bound-event-store-by-bytes` — a byte-trimmed store observed in a
 * REAL browser against a REAL session.
 *
 * ── Why this spec injects a transcript instead of spawning pi ───────────────
 * The byte budget is a restart-only field on the ONE container every spec
 * shares (like `maxReplayEvents`), and the store is IN MEMORY: a restart clears
 * it, so the transcript is re-inserted through `insertEvent` on the next
 * cold-load (hydration), which is exactly when the byte budget applies.
 *
 * The obvious arrangement — `buildWindowedSession` + a long pi run — depends on
 * a live `pi --mode rpc` spawn, which is unusable on a loaded host (the 90 s
 * spawn watchdog fires and `spawnFreshGitSession` never sees a card). This spec
 * therefore writes the session JSONL DIRECTLY into the container via
 * `docker exec` and opens the resulting (ended) session. No pi process is
 * involved; hydration is the only path under test, which is the path the byte
 * budget actually guards.
 *
 * ── The arithmetic ──────────────────────────────────────────────────────────
 * `maxBytesPerSession` is clamped up to `4 × maxEventDataSize` (default
 * 256 KiB → a 1 MiB floor), and `maxEventDataSize` is NOT a config-file field,
 * so 1 MiB is the smallest reachable budget. The injected messages are ~2.9 KiB
 * so that a 1 MiB budget retains a few hundred events — more than the
 * 100-event replay window (so a divider forms) and few enough that the window
 * gap fits one backfill span (so `remainingGapCount` reaches 0).
 *
 * See change: bound-event-store-by-bytes (F8, X6).
 */

/** A fixture folder the harness already shows in the sidebar. */
const CWD = "/fixtures/seed-win-124";
/** Fixed so the transcript file is overwritten (not accumulated) across runs. */
const SESSION_ID = "019f0000-0000-7000-8000-00000000feed";
const SESSION_BASE = `2026-09-18T00-00-00.000Z_${SESSION_ID}`;
/** The store's floor for the default per-event ceiling. */
const BYTE_BUDGET = 1024 * 1024;
/** `MIN_REPLAY_WINDOW`. */
const WINDOW = 100;
/** Enough ~2.9 KiB messages to exceed the budget by several times. */
const MESSAGE_COUNT = 3000;

const SESSION_DIR = `/home/pi/.pi/agent/sessions/--fixtures-seed-win-124--`;

/** Resolve the harness container by its published dashboard port. */
function containerName(): string {
  return execSync(`docker ps --filter publish=${DASHBOARD_PORT} --format '{{.Names}}'`, {
    encoding: "utf8",
  })
    .trim()
    .split("\n")[0];
}

/**
 * Write a synthetic pi session transcript into the container. The server scans
 * `~/.pi/agent/sessions/` and hydrates a session's events from its JSONL on
 * open, so no pi process is needed.
 */
function injectTranscript(): void {
  const script = `
    const fs = require("node:fs");
    const dir = ${JSON.stringify(SESSION_DIR)};
    const base = ${JSON.stringify(SESSION_BASE)};
    const id = ${JSON.stringify(SESSION_ID)};
    const ts = Date.now();
    const pad = "x".repeat(2800);
    const lines = [JSON.stringify({ type: "session", version: 3, id, timestamp: new Date(ts).toISOString(), cwd: ${JSON.stringify(CWD)} })];
    for (let i = 0; i < ${MESSAGE_COUNT}; i++) {
      lines.push(JSON.stringify({
        type: "message",
        id: "m" + i,
        parentId: i ? "m" + (i - 1) : null,
        timestamp: ts + i,
        message: { role: "assistant", content: [{ type: "text", text: "Injected item " + i + " " + pad }] },
      }));
    }
    fs.writeFileSync(dir + "/" + base + ".jsonl", lines.join("\\n") + "\\n");
    fs.writeFileSync(dir + "/" + base + ".meta.json", JSON.stringify({
      source: "dashboard", hidden: false, cwd: ${JSON.stringify(CWD)}, status: "idle",
      startedAt: ts, model: "faux/faux-1", thinkingLevel: "off",
    }) + "\\n");
  `;
  execSync(`docker exec -i ${containerName()} node`, {
    input: script,
    stdio: ["pipe", "inherit", "inherit"],
  });
}

/**
 * Open the injected session. It is ENDED (no live bridge), so its card lives
 * behind the per-folder ended toggle `n-<cwd>` and must be revealed first.
 */
async function openInjectedSession(page: import("@playwright/test").Page): Promise<void> {
  // Navigate STRAIGHT to the session route. Clicking the card in the sidebar is
  // unreliable for an ENDED session (the click can land on a resume affordance
  // and the view never opens); the route is the same entry point the card uses.
  await page.goto(`/session/${SESSION_ID}`);
  await page.getByTestId("chat-scroll-container").waitFor({ state: "visible", timeout: 120_000 });
  await pinDividerToTop(page);
}

let originalLimits: Record<string, number | string> = {};

test.describe.configure({ mode: "serial" });

test.describe("byte-budget retention — browser-visible", () => {
  test.setTimeout(300_000);

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(600_000);
    injectTranscript();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      const cfg = (await (await page.request.get("/api/config")).json()) as {
        data?: { memoryLimits?: Record<string, number | string> };
      };
      originalLimits = cfg.data?.memoryLimits ?? {};
      // One write + restart: the fresh store hydrates under the byte budget.
      await writeConfigAndRestart(page, {
        memoryLimits: {
          ...originalLimits,
          maxReplayEvents: WINDOW,
          replayWindowMode: "tail-only",
          maxBytesPerSession: BYTE_BUDGET,
          maxTotalEventBytes: 0,
          maxCachedSessions: 100,
        },
      });
    } finally {
      await ctx.close();
    }
  });

  test.afterAll(async ({ browser }) => {
    test.setTimeout(300_000);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      // Restore EXACTLY what was read — never `?? 0`, which would persist
      // "unlimited" for every later spec. `writeConfigAndRestart` (not a bare
      // PUT) also RESTARTS, so the RUNNING server drops this spec's limits for
      // every spec file that runs after it — the `teardownWindowedSession`
      // contract.
      await writeConfigAndRestart(page, { memoryLimits: originalLimits });
    } finally {
      await ctx.close();
    }
  });

  /** F8 — a byte-trimmed range still heals on resubscribe. */
  test("F8: a byte-trimmed range still heals on resubscribe", async ({ page }) => {
    await openInjectedSession(page);

    // The byte budget BOUND: hydration trimmed the store to at most the budget
    // plus the 5% hysteresis slack. Without this the rest of the test would
    // pass on an untrimmed store and prove nothing.
    const health = (await (await page.request.get("/api/health")).json()) as {
      storeRetention?: { residentBytes: number; effective: { maxBytesPerSession: number } };
    };
    const retention = health.storeRetention;
    expect(retention).toBeTruthy();
    expect(retention!.effective.maxBytesPerSession).toBe(BYTE_BUDGET);
    expect(retention!.residentBytes).toBeGreaterThan(0);
    expect(retention!.residentBytes).toBeLessThanOrEqual(BYTE_BUDGET * 1.05);

    // A gap divider is rendered — the window elides the byte-trimmed head.
    await expect(divider(page)).toHaveCount(1);

    // RESUBSCRIBE: reload re-fetches the full stream. The server serves the
    // events above the client's lastSeq that REMAIN, and the view converges on
    // a gap with no error.
    await page.reload();
    await openInjectedSession(page);
    await expect(divider(page)).toHaveCount(1);
    await expect(page.getByTestId("chat-scroll-container")).toBeVisible();
    await expect(page.getByText(/failed to load|connection error/i)).toHaveCount(0);
  });

  /** X6 — history backfill degrades gracefully after a byte trim. */
  test("X6: history backfill degrades gracefully after a byte trim", async ({ page }) => {
    test.setTimeout(600_000);
    // Watch frames BEFORE navigation so the WS is observed from the start.
    const frames = watchBackfillFrames(page);
    await openInjectedSession(page);

    // Request history older than the oldest retained event. The window gap is
    // entirely byte-trimmed away, so the store can serve nothing: the server
    // must answer with EXACTLY ONE result signalling no further history. The
    // tail-only climb usually auto-fires it; fall back to the manual button.
    if (frames.received.filter((m) => m.type === "history_backfill_result").length === 0) {
      await loadEarlier(page)
        .click({ timeout: 60_000 })
        .catch(() => undefined);
    }
    await awaitBackfillResults(page, frames, 1);

    const results = frames.received.filter((m) => m.type === "history_backfill_result");
    const last = results[results.length - 1] as {
      remainingGapCount: number;
      error?: string;
      events: unknown[];
    };
    // No error and no hang: the result CARRIES the events that remain (the
    // retained-but-elided head) and signals no further history — the client's
    // stop rule (`remainingGapCount === 0`) is honoured.
    expect(last.error).toBeUndefined();
    expect(last.events.length).toBeGreaterThan(0);
    expect(last.remainingGapCount).toBe(0);
  });
});
