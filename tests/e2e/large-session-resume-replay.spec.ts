import { connectBus, expect, type Page, test } from "./fixtures.js";
import { gatewayUrlWithTicket, pairDeviceBearer } from "./helpers/bridge-credential.js";
import { FIXTURE_GIT, gotoDashboard } from "./helpers/index.js";
import { BASE_URL } from "./lifecycle.js";

/**
 * Browser E2E — resuming a large session neither freezes the UI nor reopens the
 * "Replace attached proposal?" dialog (L3, issues #928 / #929).
 *
 * A fake bridge replays a ≥ 3,000-event history over the real gateway socket,
 * including a HISTORICAL `Write openspec/changes/<other>/proposal.md` while a
 * different change is manually attached. Before the fix:
 *   - the replay-exit flush was ONE unwindowed `event_replay` frame holding the
 *     whole store (the freeze), and
 *   - a replay that outlived the 5 s safety timeout leaked that historical Write
 *     as a live event, re-raising `pendingReplaceProposal` (the dialog).
 *
 * Observed at the WIRE level on a SECOND browser context that is already
 * subscribed when the bridge reconnects (robust to DOM churn / virtualization,
 * same technique as `large-session-replay.spec.ts`), plus the rendered dialog.
 *
 * ── Scenario mapping (test-plan.md) ─────────────────────────────────────────
 * F7 — no `[data-testid="replace-proposal-dialog"]`; the exit flush announces a
 *      `history_window` and no single `event_replay` frame exceeds
 *      `maxReplayEvents`; the transcript container renders.
 *
 * Gateway port from `/api/health`; dashboard port never hardcoded.
 * See change: fix-large-session-resume-replay (test-plan #F7).
 */

const EVENTS = 3_200;
const ATTACHED = "change-a";
const HISTORICAL = "change-b";

interface FakeBridge {
  send: (payload: Record<string, unknown>) => void;
  close: () => void;
}

async function openBridgeSocket(page: Page): Promise<FakeBridge> {
  const health = (await (await page.request.get("/api/health")).json()) as { piGatewayPort?: number | null };
  test.skip(!health.piGatewayPort, "harness health does not expose the bound gateway port");
  const bearer = await pairDeviceBearer(BASE_URL);
  const url = await gatewayUrlWithTicket(BASE_URL, health.piGatewayPort as number, bearer);
  const ws = await new Promise<WebSocket>((resolve, reject) => {
    const s = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error("open timeout")), 5000);
    s.addEventListener("open", () => { clearTimeout(timer); resolve(s); }, { once: true });
    s.addEventListener("error", () => { clearTimeout(timer); reject(new Error("socket error")); }, { once: true });
  });
  return {
    send: (payload) => {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
      } catch {
        // socket died with the test
      }
    },
    close: () => {
      try {
        ws.close();
      } catch {
        // already closed
      }
    },
  };
}

/**
 * Pin the fixture folder over the bus. The Add-folders dialog (`pinDirectory`)
 * browses through the confined `/api/browse`, which refuses `/fixtures/...`
 * (outside `$HOME` + pinned dirs); `pin_directory` is not confined.
 */
async function ensurePinned(page: Page): Promise<void> {
  const body = (await (await page.request.get("/api/pinned-dirs")).json()) as { data?: string[] };
  if ((body.data ?? []).includes(FIXTURE_GIT)) return;
  const bus = await connectBus();
  try {
    const ack = bus.waitFor((m) => m.type === "pinned_dirs_updated", { timeout: 20_000, label: `pin(${FIXTURE_GIT})` });
    bus.send({ type: "pin_directory", path: FIXTURE_GIT });
    await ack;
  } finally {
    bus.close();
  }
}

/** `maxReplayEvents` in force (config default 2,000 when never written). */
async function maxReplayEvents(page: Page): Promise<number> {
  const cfg = (await (await page.request.get("/api/config")).json()) as {
    data?: { memoryLimits?: { maxReplayEvents?: number } };
  };
  return cfg.data?.memoryLimits?.maxReplayEvents ?? 2_000;
}

function parse(payload: string | Buffer): { type?: string; isLast?: boolean; events?: unknown[] } | null {
  try {
    return JSON.parse(typeof payload === "string" ? payload : payload.toString("utf8"));
  } catch {
    return null;
  }
}

test.describe("resume of a large session (L3)", () => {
  test.setTimeout(180_000);

  test("F7: a ≥3,000-event reconnect replay is windowed on the wire and raises no Replace-proposal dialog", async ({
    page,
    browser,
  }) => {
    const limit = await maxReplayEvents(page);
    test.skip(limit <= 0, "windowing disabled in this harness; the wire assertion needs a window");
    await gotoDashboard(page);
    await ensurePinned(page);

    const sessionId = `e2e-resume-${Date.now()}`;
    const register = (b: FakeBridge) =>
      b.send({
        type: "session_register",
        sessionId,
        cwd: FIXTURE_GIT,
        source: "tui",
        name: "custom name",
        pid: 426000 + Math.floor(Math.random() * 999),
        eventCount: EVENTS,
        leafEntryId: `leaf-${EVENTS}`,
        liveTailOpen: false,
      });

    // 1. A live session with a manual attachment to a DIFFERENT change.
    const first = await openBridgeSocket(page);
    register(first);
    first.send({ type: "replay_complete", sessionId });
    const bus = await connectBus();
    try {
      bus.send({ type: "attach_proposal", sessionId, changeName: ATTACHED });
    } finally {
      // give the server a beat to apply before the bridge drops
      await new Promise((r) => setTimeout(r, 500));
      bus.close();
    }

    // 2. A second browser context is already subscribed when the bridge reconnects.
    const ctx2 = await browser.newContext({ baseURL: BASE_URL });
    const frames: Array<{ type?: string; isLast?: boolean; events?: unknown[] }> = [];
    try {
      const page2 = await ctx2.newPage();
      page2.on("websocket", (ws) =>
        ws.on("framereceived", (frame) => {
          const parsed = parse(frame.payload);
          if (parsed) frames.push(parsed);
        }),
      );
      await page2.goto(`/session/${sessionId}`);
      await page2.waitForTimeout(1_500);
      const before = frames.length;

      // 3. Reconnect: a fresh socket re-registers and replays the whole history,
      //    marked `replay: true`, with a historical Write to another change in the middle.
      first.close();
      const second = await openBridgeSocket(page);
      try {
        register(second);
        for (let i = 0; i < EVENTS; i++) {
          const event =
            i === Math.floor(EVENTS / 2)
              ? {
                  eventType: "tool_execution_start",
                  timestamp: Date.now(),
                  data: { toolName: "Write", toolCallId: "hist-write", args: { path: `openspec/changes/${HISTORICAL}/proposal.md` } },
                }
              : {
                  eventType: "message_end",
                  timestamp: Date.now(),
                  data: { message: { role: i % 2 ? "assistant" : "user", content: [{ type: "text", text: `turn ${i}` }] } },
                };
          second.send({ type: "event_forward", sessionId, replay: true, event });
        }
        second.send({ type: "replay_complete", sessionId });

        await expect
          .poll(() => frames.slice(before).some((f) => f.type === "event_replay" && f.isLast === true), { timeout: 60_000 })
          .toBe(true);

        const after = frames.slice(before);
        const replayFrames = after.filter((f) => f.type === "event_replay");
        // No single frame carries the whole store (develop: one frame, every event).
        expect(Math.max(...replayFrames.map((f) => f.events?.length ?? 0))).toBeLessThanOrEqual(limit);
        // The flush is windowed: the client is told about the gap.
        expect(after.some((f) => f.type === "history_window")).toBe(true);

        // The transcript still renders; the historical Write raised no suggestion.
        await expect(page2.getByTestId("chat-scroll-container")).toBeVisible({ timeout: 30_000 });
        await expect(page2.getByTestId("replace-proposal-dialog")).toHaveCount(0);
        await expect(page.getByTestId("replace-proposal-dialog")).toHaveCount(0);
        const sessions = (await (await page.request.get("/api/sessions")).json()) as {
          data?: Array<{ id: string; pendingReplaceProposal?: string | null; attachedProposal?: string }>;
        };
        const mine = sessions.data?.find((s) => s.id === sessionId);
        expect(mine?.pendingReplaceProposal ?? null).toBeNull();
      } finally {
        second.close();
      }
    } finally {
      await ctx2.close();
    }
  });
});
