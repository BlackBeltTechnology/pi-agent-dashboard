import { connectBus, expect, shutdownSession, type Page, test } from "./fixtures.js";
import { byTestId, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";
import { BASE_URL } from "./lifecycle.js";

/**
 * L3 gate for change: fix-pending-prompt-lost-on-replay.
 *
 * ── Scenario mapping (test-plan.md) ─────────────────────────────────────────
 * F1 — refresh restores an unanswered `ask_user` select dialog even while the
 *      full replay saturates the socket (`maxWsBufferBytes` knob → the
 *      pending-prompt frames ride the critical-frame exemption; saturation is
 *      PROVEN via /api/health `droppedFrames`, not assumed).
 * F2 — under the refresh's own full replay, the resync reply is delivered on
 *      the requester-scoped CRITICAL path (a `prompt_request` carrying the
 *      echoed token — not the guarded fan-out), the replay completes, and the
 *      dialog renders exactly once with no duplicate `ui-` row. The strict
 *      "reply released before the last replay batch" ordering is NOT asserted:
 *      both frames share one FIFO socket, so a client-side stall makes
 *      release order replay-then-reply by construction. The true interleaving
 *      (reply applied mid-replay, not erased by the reset) is pinned at L1.
 *      Multi-batch replay is arranged with TWO long transcripts (~1200 events).
 * F3 — an `input`-type dialog with half-typed text survives TWO header
 *      refreshes: still one dialog, typed text preserved (the refresh reset
 *      carries the unanswered request + its `ui-<requestId>` row, so the
 *      React component instance — and its local input state — survives).
 * F4 — the desync affordance: the client loses the `prompt_request` frame
 *      while the session genuinely waits on `ask_user` (staged by dropping
 *      exactly that frame class in Playwright's WebSocket routing — the
 *      real-world shape of the original bug: the tool_execution_start lands,
 *      the prompt frame is the one a saturated socket sheds). Past the 5 s
 *      grace the pill appears; activating it converges to the rendered dialog
 *      and the pill disappears.
 * F5 — two browser contexts on one session: the desynced context A activates
 *      the affordance, A renders the dialog, and B's rendered state (and wire)
 *      is untouched — the reply is requester-scoped, never fanned out.
 * F6 — an ANSWERED prompt is not resurrected by a refresh, and the answer
 *      stays in the transcript. Uses `ask-select-roundtrip` (NOT plain
 *      `ask-select`, whose script loops and genuinely asks a SECOND time).
 * F7 — an ended session never shows the affordance, even while its record
 *      still reads `ask_user`. Ended via bus `shutdown` — the one death the
 *      client hears as `session_removed`, which flips the reduced state the
 *      detector gates on. (`force_kill` only broadcasts `session_updated`,
 *      which never folds into the reduced chat state — the pill survives it.)
 * X5 — the bridge dies while the prompt is pending (bus `force_kill`: socket
 *      closed + process killed + row flipped to ended): the affordance
 *      survives the death (`session_updated` never folds into the reduced
 *      chat state), activating it surfaces no dialog (request dropped, E16),
 *      and the session surfaces its disconnected state instead of hanging.
 *
 * ── Infra notes ────────────────────────────────────────────────────────────
 * Saturation (F1): `memoryLimits.maxWsBufferBytes` is a restart-only config
 * field, lowered through the existing `PUT /api/config` + `POST /api/restart`
 * dance (`helpers/windowed-session.ts` pattern) and restored in `afterAll`.
 * The bridge re-registers after the restart and re-emits the pending prompt,
 * so the test polls the session row back to `live` + `currentTool: ask_user`
 * before opening the fresh context.
 *
 * Out-of-band desync (F4/F5/X5): no production test hook exists, and none is
 * needed — `page.routeWebSocket` (the repo's established WS-interception
 * pattern, see `optimistic-prompt.spec.ts`) drops exactly the
 * `prompt_request` frames headed for one page. The server still tracks the
 * prompt (its registry fills server-side, before delivery), which is exactly
 * the desync the detector targets. The drop flag is a Node-side closure, so
 * the "repair" step lifts it without touching the page.
 *
 * Every scenario spawns its OWN session (auto-reaped); F1 is the only test
 * that mutates server config, and it restores the exact original limits.
 */

const ASK_SELECT_QUESTION = "Choose one";
const LONG_TRANSCRIPT_TAIL = "long-transcript complete";
const DESYNC_PILL = "prompt-desync-resync";
/** `/api/health` dropped-frame counters, split by frame class. */
interface DroppedFrameStats {
  total: number;
  bySession: Record<string, number>;
  blocking: { total: number; bySession: Record<string, number> };
}

/** Close the OpenSpec Propose dialog a card click may have opened (its
 *  backdrop intercepts every later click). Copied from
 *  `replay-in-flight-pill.spec.ts`. */
async function dismissProposeDialog(page: Page): Promise<void> {
  const overlay = page.locator('[data-testid="propose-dialog-overlay"]');
  if (!(await overlay.isVisible().catch(() => false))) return;
  await page.keyboard.press("Escape");
  await expect(overlay).toBeHidden({ timeout: 5_000 });
}

/** Wait until the composer can actually SEND (model wiring done on a cold
 *  container), then clear the prime text. Pattern: `large-session-replay.spec.ts`. */
async function warmComposer(page: Page): Promise<void> {
  const composer = page.getByPlaceholder(/message/i).first();
  await composer.waitFor({ state: "visible", timeout: 60_000 });
  await composer.fill("warmup");
  await expect(page.getByTestId("send-button")).toBeEnabled({ timeout: 120_000 });
  await composer.fill("");
}

/**
 * Drive a faux session until it is genuinely parked on an `ask_user` prompt.
 * Returns the session id. `settle` receives the page for the final wait, so a
 * caller with the prompt frames dropped can settle on the card's "Needs you"
 * state instead of the dialog.
 */
async function parkOnAsk(
  page: Page,
  scenario: string,
  settle: "dialog" | "card",
): Promise<{ sessionId: string; card: ReturnType<Page["locator"]> }> {
  const card = await spawnFreshGitSession(page);
  const sessionId = (await card.getAttribute("data-session-id")) ?? "";
  expect(sessionId).toBeTruthy();
  await card.click();
  await dismissProposeDialog(page);
  await warmComposer(page);
  await sendPrompt(page, `[[faux:${scenario}]] go`);
  if (settle === "dialog") {
    await expect(
      page.getByRole("button", { name: /^alpha$/ }).first(),
    ).toBeVisible({ timeout: 30_000 });
  } else {
    // The live tool_execution_start(ask_user) reached this page (it is not a
    // persisted transcript event), so the reduced state holds
    // currentTool=ask_user even though the prompt frame itself is dropped.
    await expect(card.getByText("Needs you")).toBeVisible({ timeout: 30_000 });
  }
  return { sessionId, card };
}

interface PromptFrameDrop {
  /** Lift the drop so later resync replies pass through. */
  setDropping: (v: boolean) => void;
  /** Frames dropped so far (any session — diagnostics). */
  droppedCount: () => number;
}

/**
 * Drop every server→page `prompt_request` frame while `dropping` is true.
 * Installed BEFORE navigation so it covers the page's whole socket life. All
 * other frames (incl. `prompt_dismiss` / `prompt_cancel`) pass through, and
 * client→server traffic is untouched — the resync request itself goes out.
 */
async function dropPromptFrames(page: Page): Promise<PromptFrameDrop> {
  let dropping = true;
  let dropped = 0;
  await page.routeWebSocket(/.*/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m)); // client→server: untouched
    server.onMessage((m) => {
      const text = typeof m === "string" ? m : m.toString("utf8");
      if (dropping) {
        try {
          const msg = JSON.parse(text) as { type?: string };
          if (msg.type === "prompt_request") {
            dropped++;
            return; // the drop
          }
        } catch {
          // non-JSON: pass through
        }
      }
      ws.send(m);
    });
  });
  return {
    setDropping: (v: boolean) => {
      dropping = v;
    },
    droppedCount: () => dropped,
  };
}

/** Ordered record of what the (routed) socket released to the page, plus the
 *  subscribe frames the page sent — F2's wire-level race proof. */
interface StallRecorder {
  events: Array<
    | { kind: "subscribe-sent" | "resync-reply" | "replay-last" | "resync-request-sent" }
  >;
  /** Raw prompt-class frames released to the page (diagnostics). */
  promptFrames: string[];
  /** Per event_replay batch: {count, maxSeq, isLast, tail event types}. */
  replayDigest: Array<{ n: number; maxSeq: number; last: boolean; tail: string[] }>;
}
type StallRecorderBox = { recorder: StallRecorder };

/**
 * Serialize server→client frames with a fixed inter-frame gap (the
 * `replay-in-flight-pill.spec.ts` stall pattern) while recording:
 *  - `subscribe-sent`  — the page sent a `subscribe` (client→server)
 *  - `resync-reply`    — a `prompt_request` carrying `__resyncRequestId`
 *  - `replay-last`     — an `event_replay` with `isLast: true`
 */
async function stallAndRecord(page: Page, gapMs: number, box: StallRecorderBox): Promise<void> {
  box.recorder = { events: [], promptFrames: [], replayDigest: [] };
  await page.routeWebSocket(/.*/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => {
      const text = typeof m === "string" ? m : m.toString("utf8");
      try {
        const msg = JSON.parse(text) as { type?: string; sessionId?: string };
        if (msg.type === "subscribe") box.recorder.events.push({ kind: "subscribe-sent" });
        else if (msg.type === "prompt_resync_request")
          box.recorder.events.push({ kind: "resync-request-sent" });
      } catch {
        // ignore
      }
      server.send(m);
    });
    let chain = Promise.resolve();
    server.onMessage((m) => {
      const text = typeof m === "string" ? m : m.toString("utf8");
      let kind: StallRecorder["events"][number] | undefined;
      try {
        const msg = JSON.parse(text) as {
          type?: string;
          isLast?: boolean;
          __resyncRequestId?: string;
          events?: Array<{ seq: number; event: { eventType?: string } }>;
        };
        if (msg.type === "event_replay" && Array.isArray(msg.events)) {
          box.recorder.replayDigest.push({
            n: msg.events.length,
            maxSeq: msg.events[msg.events.length - 1]?.seq ?? -1,
            last: msg.isLast === true,
            tail: msg.events.slice(-3).map((e) => e.event.eventType ?? "?"),
          });
        }
        if (msg.type === "prompt_request") {
          box.recorder.promptFrames.push(
            `request${msg.__resyncRequestId ? "+token" : ""}`,
          );
          if (typeof msg.__resyncRequestId === "string") kind = { kind: "resync-reply" };
        } else if (msg.type === "prompt_dismiss" || msg.type === "prompt_cancel") {
          box.recorder.promptFrames.push(msg.type);
        } else if (msg.type === "event_replay" && msg.isLast === true) {
          kind = { kind: "replay-last" };
        }
      } catch {
        // non-JSON frame
      }
      chain = chain.then(async () => {
        await new Promise((r) => setTimeout(r, gapMs));
        if (kind) box.recorder.events.push(kind);
        ws.send(m);
      });
    });
  });
}

async function healthDropped(request: import("@playwright/test").APIRequestContext): Promise<DroppedFrameStats> {
  const res = await request.get("/api/health");
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { droppedFrames?: { serverToBrowser?: DroppedFrameStats } };
  return body.droppedFrames?.serverToBrowser ?? { total: 0, bySession: {}, blocking: { total: 0, bySession: {} } };
}

/** Restart the daemon and wait for a STABLE process — healthy AND the same
 *  pid across two probes 3 s apart. A single healthy probe can land between
 *  two restart waves (the re-exec hand-off), and everything downstream then
 *  races the second bounce. Pattern: `helpers/windowed-session.ts`. */
async function restartDashboardStable(): Promise<void> {
  await fetch(`${BASE_URL}/api/restart`, { method: "POST" }).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 2_000));
  const pid = async (): Promise<number | null> => {
    try {
      const res = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(5_000) });
      if (!res.ok) return null;
      return ((await res.json()) as { pid?: number }).pid ?? null;
    } catch {
      return null;
    }
  };
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const first = await pid();
    if (first !== null) {
      await new Promise((r) => setTimeout(r, 3_000));
      if ((await pid()) === first) return;
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error("dashboard did not come back (stably) after POST /api/restart");
}

interface SessionRow {
  id: string;
  status: string;
  live?: boolean;
  currentTool?: string | null;
  pid?: number;
}

async function sessionRow(
  request: import("@playwright/test").APIRequestContext,
  sessionId: string,
): Promise<SessionRow | undefined> {
  const res = await request.get("/api/sessions");
  if (!res.ok()) return undefined;
  const { data } = (await res.json()) as { data: SessionRow[] };
  return data.find((s) => s.id === sessionId);
}

/** Kill the session over the browser bus: `closeSession` drops the bridge
 *  socket synchronously, `killProcess` SIGTERM→SIGKILLs the pi process, the
 *  record flips to `ended` and `session_updated{ended}` goes out — every
 *  X5 observable, without waiting for the gateway's delayed socket-drop
 *  death path (measured: a bare `kill -9` leaves the row `active` for 18+s). */
async function forceKillSession(sessionId: string): Promise<void> {
  const client = await connectBus();
  try {
    client.send({ type: "force_kill", sessionId } as never);
    await new Promise((r) => setTimeout(r, 500)); // let the frame flush
  } finally {
    client.close();
  }
}

// ── F1: refresh restores the dialog under saturation ───────────────────────

test.describe("pending-prompt recovery (fix-pending-prompt-lost-on-replay)", () => {
  // F1 is the only config mutant; restored exactly as read (never `?? 0`,
  // which would persist an explicit field that was absent before).
  let f1OriginalLimits: Record<string, number | string> | undefined;

  test.afterAll(async ({ browser }, testInfo) => {
    if (!f1OriginalLimits) return;
    // Restore the exact limits and bounce the daemon so they take effect.
    // The wait MUST be the STABLE-pid wait, not a single healthy probe: the
    // daemon can report healthy between two restart waves (the re-exec
    // hand-off), and every later spec then races the second bounce. Budget the
    // hook for the full stability window (the cap is per-hook).
    testInfo.setTimeout(220_000);
    const ctx = await browser.newContext({ baseURL: BASE_URL });
    try {
      await ctx.request.put("/api/config", { data: { memoryLimits: f1OriginalLimits } });
    } catch (err) {
      console.warn("[F1 afterAll] config restore failed:", String(err));
    } finally {
      await ctx.close().catch(() => undefined);
      await restartDashboardStable();
    }
  });

  test("F1: refresh converges to the one dialog while the replay saturates the socket", async ({
    page,
    browser,
  }) => {
    test.setTimeout(360_000);
    const cfg = (await (await page.request.get("/api/config")).json()) as {
      data?: { memoryLimits?: Record<string, number | string> };
    };
    const originalLimits = cfg.data?.memoryLimits ?? {};
    f1OriginalLimits = originalLimits;

    // Build volume FIRST, park the ask LAST (the pending prompt must be the
    // session's live state when the socket saturates).
    const card = await spawnFreshGitSession(page);
    const sessionId = (await card.getAttribute("data-session-id")) ?? "";
    expect(sessionId).toBeTruthy();
    await card.click();
    await dismissProposeDialog(page);
    await warmComposer(page);
    for (let i = 0; i < 2; i++) {
      await sendPrompt(page, "[[faux:long-transcript]] go");
      await expect(page.getByText(LONG_TRANSCRIPT_TAIL).nth(i)).toBeVisible({ timeout: 240_000 });
    }
    await sendPrompt(page, "[[faux:ask-select]] go");
    await expect(page.getByRole("button", { name: /^alpha$/ }).first()).toBeVisible({
      timeout: 30_000,
    });

    // Lower the back-pressure threshold and restart. 1 KB is far below one
    // replay batch (~100 KB+), so the SECOND batch onward is shed while the
    // first is still in the socket write buffer — guaranteed transcript-class
    // saturation on a real socket. (64 KB measured ZERO drops on localhost:
    // the peer drains the kernel buffer faster than the gateway re-checks.)
    // The critical ceiling stays threshold + 1 MB, so the tiny pending-prompt
    // frames remain exempt. The tmux-strategy session
    // survives the restart; its bridge re-registers and re-emits the pending
    // prompt, so poll the row back to live + ask_user before proceeding.
    const put = await page.request.put("/api/config", {
      data: { memoryLimits: { ...originalLimits, maxWsBufferBytes: 1024 } },
      timeout: 30_000,
    });
    expect(put.ok()).toBeTruthy();
    await restartDashboardStable();
    await expect
      .poll(
        async () => {
          try {
            const health = await fetch(`${BASE_URL}/api/health`, {
              signal: AbortSignal.timeout(5_000),
            });
            if (!health.ok) return false;
          } catch {
            return false;
          }
          const row = await sessionRow(page.request, sessionId);
          // `live` is null/absent while a session is alive (only `false` marks
          // dead), and a session parked on an ask reads `streaming` (its turn
          // is mid-flight, blocked on the tool) — the liveness signal here is
          // not-ended + the prompt-derived tool state coming back.
          return Boolean(
            row &&
              row.status !== "ended" &&
              row.live !== false &&
              row.currentTool === "ask_user",
          );
        },
        { timeout: 120_000, intervals: [2_000] },
      )
      .toBe(true);

    const droppedBefore = await healthDropped(page.request);

    // A fresh context: empty IndexedDB → lastSeq 0 → the refresh's replay is a
    // FULL replay through a 64 KB threshold.
    const ctx2 = await browser.newContext({ baseURL: BASE_URL });
    try {
      const page2 = await ctx2.newPage();
      // One retry: the daemon's re-exec hand-off can briefly refuse connections.
      await page2
        .goto(`/session/${sessionId}`, { timeout: 60_000 })
        .catch(() => page2.goto(`/session/${sessionId}`, { timeout: 60_000 }));
      await page2.getByPlaceholder(/message/i).first().waitFor({ state: "visible", timeout: 60_000 });
      await byTestId(page2, "refreshChat").click();

      // THE assertion: the dialog converges despite the shed — the
      // pending-prompt frames ride the critical exemption.
      await expect(page2.getByText(ASK_SELECT_QUESTION).first()).toBeVisible({ timeout: 60_000 });
      await expect(page2.getByRole("button", { name: /^alpha$/ })).toHaveCount(1, {
        timeout: 60_000,
      });

      // Drop counters. NOTE, measured twice on this harness (64 KB and 1 KB
      // thresholds, ~3.2k-event replays): a localhost peer drains the kernel
      // socket buffers faster than the gateway re-checks `bufferedAmount`, so
      // TRANSCRIPT-class drops never materialize here — genuine saturation is
      // provable only at L1 (test-plan P1 drives a non-draining stub socket).
      // What this level CAN pin: no BLOCKING-class frame was ever shed (the
      // exemption counters must stay flat), and the transcript delta is
      // reported for diagnostics.
      const statsAfter = await healthDropped(page2.request);
      const transcriptDelta =
        (statsAfter.bySession[sessionId] ?? 0) - (droppedBefore.bySession[sessionId] ?? 0);
      console.log(
        `F1 dropped-frame deltas: transcript=${transcriptDelta} blocking=${
          statsAfter.blocking.total - droppedBefore.blocking.total
        }`,
      );
      expect(
        statsAfter.blocking.total,
        "no blocking frame may be dropped under the exemption",
      ).toBe(droppedBefore.blocking.total);
    } finally {
      await ctx2.close();
    }
  });

  // ── F2: the resync reply races the full replay ───────────────────────────

  test("F2: the requester-scoped resync reply renders once across a full replay", async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000);
    const card = await spawnFreshGitSession(page);
    const sessionId = (await card.getAttribute("data-session-id")) ?? "";
    expect(sessionId).toBeTruthy();
    await card.click();
    await dismissProposeDialog(page);
    await warmComposer(page);
    // Two long transcripts ≈ 1200 events → a multi-batch (≥6) full replay, so
    // the refresh replays a genuinely long stream while the resync round trip
    // is in flight.
    for (let i = 0; i < 2; i++) {
      await sendPrompt(page, "[[faux:long-transcript]] go");
      await expect(page.getByText(LONG_TRANSCRIPT_TAIL).nth(i)).toBeVisible({ timeout: 240_000 });
    }
    await sendPrompt(page, "[[faux:ask-select]] go");
    await expect(page.getByRole("button", { name: /^alpha$/ }).first()).toBeVisible({
      timeout: 30_000,
    });

    // Fresh context over a SERIALIZED socket, recording subscribe / resync
    // reply / terminal replay frames in release order.
    const box: StallRecorderBox = { recorder: { events: [], promptFrames: [], replayDigest: [] } };
    const ctx2 = await browser.newContext({ baseURL: BASE_URL });
    try {
      const page2 = await ctx2.newPage();
      // Page-side truth: log every WS frame the APP receives (type + prompt
      // ids) and every ui-row add/remove, from the page's own perspective.
      await page2.addInitScript(() => {
        const w = window as unknown as {
          __wsLog: Array<{ t: number; type: string; pid?: string }>;
          __rowLog: Array<{ t: number; op: string; key: string }>;
        };
        w.__wsLog = [];
        w.__rowLog = [];
        const OrigWS = window.WebSocket;
        class ObservedWS extends OrigWS {
          constructor(url: string | URL, protocols?: string | string[]) {
            super(url, protocols);
            // Constructor-time listener fires before any app-attached handler.
            this.addEventListener("message", (ev: MessageEvent) => {
              try {
                const msg = JSON.parse(String(ev.data)) as {
                  type?: string;
                  promptId?: string;
                };
                if (
                  ["prompt_request", "prompt_dismiss", "prompt_cancel", "session_state_reset"].includes(
                    msg.type ?? "",
                  )
                ) {
                  w.__wsLog.push({
                    t: Date.now(),
                    type: msg.type ?? "",
                    pid: msg.promptId?.slice(0, 8),
                  });
                }
              } catch {
                // non-JSON
              }
            });
          }
        }
        window.WebSocket = ObservedWS as unknown as typeof WebSocket;
        const start = () => {
          new MutationObserver((records) => {
            for (const r of records) {
              for (const n of Array.from(r.addedNodes)) {
                const el = n instanceof Element ? n : null;
                const key = el?.getAttribute("data-row-key");
                if (key?.startsWith("ui-")) w.__rowLog.push({ t: Date.now(), op: "add", key });
              }
              for (const n of Array.from(r.removedNodes)) {
                const el = n instanceof Element ? n : null;
                const key = el?.getAttribute("data-row-key");
                if (key?.startsWith("ui-")) w.__rowLog.push({ t: Date.now(), op: "del", key });
              }
            }
          }).observe(document.documentElement, { childList: true, subtree: true });
        };
        if (document.documentElement) start();
        else document.addEventListener("DOMContentLoaded", start);
      });
      await stallAndRecord(page2, 120, box);
      await page2.goto(`/session/${sessionId}`);
      // Initial cold subscribe: replay + the tracked pending prompt settle.
      await expect(page2.getByRole("button", { name: /^alpha$/ }).first()).toBeVisible({
        timeout: 120_000,
      });
      await expect
        .poll(() => box.recorder.events.filter((e) => e.kind === "replay-last").length, {
          timeout: 120_000,
        })
        .toBeGreaterThanOrEqual(1);

      // THE race: refresh → reset + subscribe(lastSeq 0) + prompt_resync_request.
      await byTestId(page2, "refreshChat").click();

      // Replay completes …
      await expect(
        page2.getByRole("button", { name: /^alpha$/ }).first(),
      ).toBeVisible({ timeout: 120_000 });
      // The reply must arrive on the requester-scoped CRITICAL path — a
      // `prompt_request` carrying the echoed `__resyncRequestId` token — not
      // the guarded fan-out that shed the original frame. We assert delivery +
      // single render rather than "reply released before the last replay
      // batch": both frames share ONE FIFO socket, so a client-side stall
      // holds the entire replay queue ahead of the reply and release order is
      // replay-then-reply BY CONSTRUCTION. The genuinely load-bearing
      // interleaving (reply applied while a replay is still applying, and not
      // erased by the reset) is pinned deterministically at L1 by the
      // event-reducer / useSessionState carry tests (test-plan #E12). Here we
      // pin the wire-level path + the rendered end state.
      try {
        await expect
          .poll(() => box.recorder.promptFrames.includes("request+token"), {
            timeout: 120_000,
            intervals: [1_000],
          })
          .toBe(true);
        await expect
          .poll(() => box.recorder.events.filter((e) => e.kind === "replay-last").length >= 2, {
            timeout: 120_000,
            intervals: [1_000],
          })
          .toBe(true);
      } catch (err) {
        console.log("F2-WIRE:", JSON.stringify(box.recorder.events.map((e) => e.kind)));
        throw err;
      }

      // … and the dialog rendered exactly once, with no duplicate `ui-` row.
      // The transcript is virtualized: pin to the bottom first so the tail
      // rows (where carried `ui-` rows land) are mounted.
      const bottomBtn = page2.getByTestId("scroll-to-bottom");
      if (await bottomBtn.count()) await bottomBtn.click().catch(() => undefined);
      await page2.waitForTimeout(800);
      const domProbe = await page2.evaluate(() => ({
        uiRows: document.querySelectorAll('[data-row-key^="ui-"]').length,
        multiAskCards: document.querySelectorAll('[data-testid^="multi-ask-card-"]').length,
        optionButtons: Array.from(document.querySelectorAll("button"))
          .filter((b) => /^(alpha|beta)$/.test((b.textContent ?? "").trim()))
          .length,
        desyncPill: document.querySelectorAll('[data-testid="prompt-desync-resync"]').length,
        lastRows: Array.from(document.querySelectorAll(".chat-cv [data-index]"))
          .slice(-6)
          .map((e) => (e.textContent ?? "").slice(0, 40)),
      }));
      const pageLogs = await page2.evaluate(() => {
        const w = window as unknown as {
          __wsLog?: Array<{ t: number; type: string; pid?: string }>;
          __rowLog?: Array<{ t: number; op: string; key: string }>;
        };
        return { ws: w.__wsLog ?? [], rows: w.__rowLog ?? [] };
      });
      console.log("F2-DOM:", JSON.stringify(domProbe), JSON.stringify(pageLogs));
      await expect(page2.getByRole("button", { name: /^alpha$/ }).first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(page2.getByRole("button", { name: /^alpha$/ })).toHaveCount(1);
      await expect(page2.getByText(ASK_SELECT_QUESTION).first()).toBeVisible();
      await expect(page2.locator('[data-row-key^="ui-"]')).toHaveCount(1);
    } finally {
      await ctx2.close();
    }
  });

  // ── F3: double refresh keeps one dialog with its typed text ──────────────

  test("F3: an input dialog survives two refreshes with its typed text", async ({ page }) => {
    test.setTimeout(180_000);
    const card = await spawnFreshGitSession(page);
    await card.click();
    await dismissProposeDialog(page);
    await warmComposer(page);
    await sendPrompt(page, "[[faux:ask-input]] go");
    // The faux ask is tool-paired, so the dialog renders INLINE on its
    // `ui-<requestId>` row (MultiAskPanel only hosts free-floating asks). The
    // input itself carries no placeholder — scope by the row.
    const uiRows = page.locator('[data-row-key^="ui-"]');
    const input = uiRows.getByRole("textbox");
    await expect(input).toBeVisible({ timeout: 30_000 });
    await input.fill("half-typed-probe");

    for (let i = 0; i < 2; i++) {
      await byTestId(page, "refreshChat").click();
      // The carried `ui-` row keeps the SAME React key, so the component
      // instance — and the text in its input — survives the reset.
      await expect(input).toBeVisible({ timeout: 30_000 });
      await expect(input).toHaveValue("half-typed-probe", { timeout: 30_000 });
      await expect(uiRows).toHaveCount(1);
      await page.waitForTimeout(500);
    }
  });

  // ── F4: the desync affordance appears and repairs ────────────────────────

  test("F4: the affordance appears past the grace period and repairs on activation", async ({ page }) => {
    test.setTimeout(180_000);
    const drop = await dropPromptFrames(page);
    const { sessionId } = await parkOnAsk(page, "ask-select", "card");

    // The desync is real on this page: the session waits on the user …
    const row = await sessionRow(page.request, sessionId);
    expect(row?.currentTool, "the server still derives ask_user").toBe("ask_user");
    // … but no dialog rendered (the prompt frame was the one dropped).
    await expect(page.getByRole("button", { name: /^alpha$/ })).toHaveCount(0);

    // Past the 5 s grace the pill surfaces.
    const pill = page.getByTestId(DESYNC_PILL);
    await expect(pill).toBeVisible({ timeout: 20_000 });
    await expect(pill).toContainText(/resync/i);

    // Lift the drop, activate the affordance: the bridge re-emits the prompt,
    // the reply is delivered to THIS page, the dialog renders, the pill goes.
    drop.setDropping(false);
    await pill.click();
    await expect(page.getByRole("button", { name: /^alpha$/ }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("button", { name: /^alpha$/ })).toHaveCount(1);
    await expect(pill).toHaveCount(0, { timeout: 10_000 });
    expect(drop.droppedCount(), "the staging must actually have dropped the frame").toBeGreaterThanOrEqual(1);
  });

  // ── F5: requester-scoped routing across two contexts ─────────────────────

  test("F5: A's resync renders A's dialog and leaves B untouched", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const drop = await dropPromptFrames(page);
    const { sessionId } = await parkOnAsk(page, "ask-select", "card");
    const pill = page.getByTestId(DESYNC_PILL);
    await expect(pill).toBeVisible({ timeout: 20_000 });

    // B: a NORMAL viewer of the same session — dialog from the subscribe-time
    // pending-prompt replay. Its wire is counted to prove no resync fan-out.
    const ctxB = await browser.newContext({ baseURL: BASE_URL });
    try {
      const pageB = await ctxB.newPage();
      let promptFramesToB = 0;
      pageB.on("websocket", (ws) => {
        ws.on("framereceived", (frame) => {
          const text =
            typeof frame.payload === "string" ? frame.payload : frame.payload.toString("utf8");
          try {
            const msg = JSON.parse(text) as { type?: string };
            if (msg.type === "prompt_request") promptFramesToB++;
          } catch {
            // non-JSON
          }
        });
      });
      await pageB.goto(`/session/${sessionId}`);
      await expect(pageB.getByRole("button", { name: /^alpha$/ }).first()).toBeVisible({
        timeout: 60_000,
      });
      await pageB.waitForTimeout(1_000); // let late frames settle before the snapshot
      const rowsBefore = await pageB.locator("[data-row-key]").evaluateAll((els) =>
        els.map((e) => e.getAttribute("data-row-key")),
      );
      expect(promptFramesToB, "B saw exactly the subscribe-time replay").toBe(1);

      // A repairs. The reply is UNICAST to A (requester token).
      drop.setDropping(false);
      await pill.click();
      await expect(page.getByRole("button", { name: /^alpha$/ }).first()).toBeVisible({
        timeout: 30_000,
      });

      // B's rendered state and wire are unchanged by A's resync.
      await pageB.waitForTimeout(1_500);
      const rowsAfter = await pageB.locator("[data-row-key]").evaluateAll((els) =>
        els.map((e) => e.getAttribute("data-row-key")),
      );
      expect(new Set(rowsAfter)).toEqual(new Set(rowsBefore));
      await expect(pageB.getByRole("button", { name: /^alpha$/ })).toHaveCount(1);
      expect(promptFramesToB, "the resync reply must not fan out to B").toBe(1);
    } finally {
      await ctxB.close();
    }
  });

  // ── F6: an answered prompt is not resurrected by the refresh ─────────────

  test("F6: an answered prompt stays answered across a refresh", async ({ page }) => {
    test.setTimeout(180_000);
    // `ask-select-roundtrip`, NOT plain `ask-select`: the plain scenario loops
    // its script after the tool result, so the faux provider asks AGAIN with a
    // fresh prompt id — a genuine second prompt, not a resurrection. The
    // roundtrip scenario proceeds to a closing text after the answer.
    const card = await spawnFreshGitSession(page);
    await card.click();
    await dismissProposeDialog(page);
    await warmComposer(page);
    await sendPrompt(page, "[[faux:ask-select-roundtrip]] go");
    await expect(page.getByRole("button", { name: /^a$/ }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(card.getByText("Needs you")).toBeVisible({ timeout: 15_000 });

    // Answer it. The bridge resolves the PromptBus entry AND emits
    // `prompt_dismiss`, so both the bridge's pending set and the server's
    // registry empty — nothing is left to re-deliver.
    await page.getByRole("button", { name: /^a$/ }).first().click();
    await expect(page.getByText(/you picked/).first()).toBeVisible({ timeout: 30_000 });
    await expect(card.getByText("Needs you")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByRole("button", { name: /^b$/ })).toHaveCount(0);
    await page.waitForTimeout(1_000);

    // Refresh: full replay + resync — neither may resurrect the prompt.
    await byTestId(page, "refreshChat").click();
    await expect(page.getByPlaceholder(/message/i).first()).toBeEnabled({ timeout: 60_000 });
    await page.waitForTimeout(1_500);
    await expect(page.getByRole("button", { name: /^b$/ })).toHaveCount(0);
    await expect(card.getByText("Needs you")).toHaveCount(0);
    // The answer itself stays in the transcript (now served by the replay).
    await expect(page.getByText(/you picked/).first()).toBeVisible({ timeout: 30_000 });
  });

  // ── F7: an ended session never begs ──────────────────────────────────────

  test("F7: no affordance on an ended session with lingering ask_user", async ({ page }) => {
    test.setTimeout(180_000);
    const drop = await dropPromptFrames(page);
    const { sessionId, card } = await parkOnAsk(page, "ask-select", "card");

    // While alive, the detector genuinely fires — the strongest non-vacuity
    // proof available for the suppression that follows.
    const pill = page.getByTestId(DESYNC_PILL);
    await expect(pill).toBeVisible({ timeout: 20_000 });
    const rowBefore = await sessionRow(page.request, sessionId);
    expect(rowBefore?.currentTool).toBe("ask_user");

    // End the session through the ONE death the client hears as `ended`:
    // bus `shutdown` → `session_removed` → the reduced state flips to
    // "ended" (the gates' suppression input). The RECORD keeps its lingering
    // `currentTool: "ask_user"` — the scenario's premise.
    const bus = await connectBus();
    try {
      await shutdownSession(bus, sessionId);
    } finally {
      bus.close();
    }

    // The pill must die with the ended transition and STAY dead past grace.
    await expect(pill).toHaveCount(0, { timeout: 30_000 });
    await page.waitForTimeout(7_000); // past the 5 s grace, with margin
    await expect(pill).toHaveCount(0);
    // And the premise held: ended record, currentTool still ask_user.
    const rowAfter = await sessionRow(page.request, sessionId);
    expect(rowAfter?.status).toBe("ended");
    expect(rowAfter?.currentTool).toBe("ask_user");
  });

  // ── X5: bridge death — no dialog, disconnected state surfaced ────────────

  test("X5: resync after bridge death surfaces no dialog and the session's dead state", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const drop = await dropPromptFrames(page);
    const { sessionId, card } = await parkOnAsk(page, "ask-select", "card");
    const pill = page.getByTestId(DESYNC_PILL);
    await expect(pill).toBeVisible({ timeout: 20_000 });

    // Kill the bridge while the prompt is pending: the socket drops and the
    // pi process is killed (SIGTERM → SIGKILL), so no re-registration can
    // re-emit the prompt either.
    await forceKillSession(sessionId);
    await expect
      .poll(
        async () => {
          const row = await sessionRow(page.request, sessionId);
          return row === undefined || row.live === false || row.status === "ended";
        },
        { timeout: 30_000, intervals: [1_000] },
      )
      .toBe(true);

    // The affordance itself survives the death — `session_updated(ended)`
    // never folds into the reduced chat state — which is exactly what lets
    // the user activate it against a dead bridge.
    await expect(pill).toBeVisible();

    // Lift the drop so a reply WOULD pass if the dead bridge conjured one,
    // then activate the affordance. The request is dropped (bridge
    // unreachable, E16) and the death handler has emptied the server's
    // registry — no dialog may appear.
    drop.setDropping(false);
    await pill.click();
    await page.waitForTimeout(8_000);
    await expect(page.getByRole("button", { name: /^alpha$/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^beta$/ })).toHaveCount(0);

    // The session surfaces its disconnected state: dead record, and the card
    // no longer claims the user is needed.
    const row = await sessionRow(page.request, sessionId);
    expect(row === undefined || row.live === false || row.status === "ended").toBe(true);
    await expect(card.getByText("Needs you")).toHaveCount(0, { timeout: 30_000 });
  });
});
