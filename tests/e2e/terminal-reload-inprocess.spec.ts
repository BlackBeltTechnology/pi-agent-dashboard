/**
 * `/reload` on a terminal-hosted (tmux) session, end to end.
 *
 * The harness spawns with `spawnStrategy: "tmux"` by default, so the session
 * has no headless PID and the server forwards `/reload` to the bridge. The
 * bridge self-dispatches `/__dashboard_reload <token>` in-process; the RELOADED
 * bridge instance reports `completed` after re-registering. The TUI is never
 * touched — the old path needed a manual `/__dashboard_reload` bootstrap and
 * failed with a stale-ctx error on every reload after the first.
 *
 * Covers test-plan #F1 (repeated reloads, one pill each, no transcript
 * pollution, same pid) and #F2 (a concurrent reload is refused).
 *
 * Exemplars: `headless-reload-dispatch.spec.ts` (pill assertions),
 * `tmux-session-shutdown.spec.ts` (tmux spawn strategy).
 * See change: fix-terminal-session-dashboard-reload.
 */
import { expect, type Page, test } from "./fixtures.js";
import { gotoDashboard, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

interface SessionShape {
  id: string;
  status?: string;
  pid?: number;
}

/** Read the server's session record via the dashboard's own same-origin REST. */
async function readSession(page: Page, sessionId: string): Promise<SessionShape | undefined> {
  return page.evaluate(async (sid: string) => {
    const res = await fetch("/api/sessions");
    if (!res.ok) return undefined;
    const body = (await res.json()) as { data?: SessionShape[] };
    const list = Array.isArray(body?.data) ? body.data : [];
    return list.find((s) => s.id === sid);
  }, sessionId);
}

/** Pin the tmux strategy for this spec; returns the previous value. */
async function setSpawnStrategy(page: Page, strategy: string): Promise<string> {
  return page.evaluate(async (next: string) => {
    const cur = await (await fetch("/api/config")).json();
    const prev = cur?.data?.spawnStrategy ?? "tmux";
    await fetch("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spawnStrategy: next }),
    });
    return prev as string;
  }, strategy);
}

async function dismissOverlays(page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const overlay = page.getByTestId("propose-dialog-overlay");
    if (!(await overlay.isVisible().catch(() => false))) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
  }
}

interface ReloadFeedback {
  status: string;
  message?: string;
}

/**
 * Collect every LIVE `/reload` terminal `command_feedback` the browser receives
 * for `sessionId`, straight off the dashboard WebSocket.
 *
 * DOM pills are not countable across reloads: each reload re-registers the
 * session, the server wipes its event store and broadcasts
 * `session_state_reset`, so an earlier pill (and a refusal pill racing the
 * first reload) disappears from the chat. Live `event` frames are the
 * operator-visible feedback, one per emission.
 */
interface EventFrame {
  type?: string;
  sessionId?: string;
  event?: { eventType?: string; data?: { command?: string; status?: string; message?: string } };
}

/** The `/reload` terminal feedback a live `event` frame carries, if any. */
function reloadFeedbackOf(node: EventFrame, sessionId: string | undefined): ReloadFeedback | undefined {
  const data = node.event?.data;
  if (node.type !== "event" || node.event?.eventType !== "command_feedback") return undefined;
  if (data?.command !== "/reload" || (data.status !== "completed" && data.status !== "error")) return undefined;
  if (sessionId && node.sessionId !== sessionId) return undefined;
  return { status: data.status, message: data.message };
}

function collectReloadFeedback(page: Page, sessionIdRef: { id?: string }): ReloadFeedback[] {
  const seen: ReloadFeedback[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const hit = Array.isArray(node) ? undefined : reloadFeedbackOf(node as EventFrame, sessionIdRef.id);
    if (hit) {
      seen.push(hit);
      return;
    }
    for (const v of Object.values(node)) visit(v);
  };
  page.on("websocket", (ws) => {
    ws.on("framereceived", ({ payload }) => {
      if (typeof payload !== "string" || !payload.includes("/reload")) return;
      try {
        visit(JSON.parse(payload));
      } catch {
        /* non-JSON frame */
      }
    });
  });
  return seen;
}

async function waitForFeedback(seen: ReloadFeedback[], want: { completed: number; error: number }): Promise<void> {
  await expect
    .poll(
      () => ({
        completed: seen.filter((f) => f.status === "completed").length,
        error: seen.filter((f) => f.status === "error").length,
      }),
      { timeout: 90_000, message: "terminal /reload feedback reaches the browser" },
    )
    .toEqual(want);
}

/**
 * Settled = registered and not running a turn. A never-prompted session reads
 * `active`, a session after `agent_end` reads `idle`; `streaming` would mean the
 * self-dispatch started a model turn, and `ended` that the reloaded bridge
 * never re-registered.
 */
async function waitIdle(page: Page, sessionId: string): Promise<void> {
  await expect
    .poll(async () => (await readSession(page, sessionId))?.status ?? "missing", {
      timeout: 60_000,
      message: "session converges back to a settled status after the reload",
    })
    .toMatch(/^(idle|active)$/);
}

async function spawnTmuxSession(
  page: Page,
  ref: { id?: string },
): Promise<{ sessionId: string; previous: string }> {
  await gotoDashboard(page);
  const previous = await setSpawnStrategy(page, "tmux");
  const card = await spawnFreshGitSession(page);
  const sessionId = (await card.getAttribute("data-session-id")) as string;
  expect(sessionId).toBeTruthy();
  ref.id = sessionId;
  await card.click();
  await dismissOverlays(page);
  await waitIdle(page, sessionId);
  return { sessionId, previous };
}

test.describe("terminal-hosted /reload (in-process)", () => {
  // Spawn + two reloads + convergence polls exceed the 60 s default.
  test.setTimeout(240_000);

  test("#F1 two reloads without touching the TUI: one completed feedback each, same pid, no transcript pollution", async ({
    page,
  }) => {
    const ref: { id?: string } = {};
    const seen = collectReloadFeedback(page, ref);
    const { sessionId, previous } = await spawnTmuxSession(page, ref);
    try {
      const pidBefore = (await readSession(page, sessionId))?.pid;
      expect(pidBefore, "tmux session registers its pi pid").toBeTruthy();

      for (let i = 1; i <= 2; i++) {
        await sendPrompt(page, "/reload");
        await waitForFeedback(seen, { completed: i, error: 0 });
        await waitIdle(page, sessionId);
      }
      // No immediate duplicate feedback (settle window).
      await page.waitForTimeout(3_000);
      expect(seen.map((f) => f.status)).toEqual(["completed", "completed"]);

      const body = (await page.locator("body").textContent()) ?? "";
      expect(body, "the self-dispatch must not surface as a user message").not.toContain("__dashboard_reload");
      expect(body.toLowerCase(), "no stale-ctx failure").not.toContain("stale");
      expect((await readSession(page, sessionId))?.pid, "in-process reload keeps the pi process").toBe(pidBefore);
    } finally {
      await setSpawnStrategy(page, previous).catch(() => {});
    }
  });

  test("#F2 a concurrent reload is refused: one completed + one 'already in progress' error", async ({ page }) => {
    const ref: { id?: string } = {};
    const seen = collectReloadFeedback(page, ref);
    const { sessionId, previous } = await spawnTmuxSession(page, ref);
    try {
      await sendPrompt(page, "/reload");
      await sendPrompt(page, "/reload");
      await waitForFeedback(seen, { completed: 1, error: 1 });
      expect(seen.find((f) => f.status === "error")?.message ?? "").toMatch(/already in progress/i);
      await waitIdle(page, sessionId);
    } finally {
      await setSpawnStrategy(page, previous).catch(() => {});
    }
  });
});
