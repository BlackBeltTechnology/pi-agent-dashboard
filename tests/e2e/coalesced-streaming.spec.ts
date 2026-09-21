import { expect, type Page, test } from "./fixtures.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";
import { BASE_URL } from "./lifecycle.js";

// L3 (docker harness) rows for change: coalesce-bridge-message-update-snapshots.
//
// The bridge now holds at most one pending text snapshot and forwards the
// newest one per fixed 50 ms window. That is invisible at the unit level for
// the four things that actually break users: a swallowed FINAL snapshot
// (truncated answer), a snapshot landing after `message_end` (ghost streaming
// bubble), a reordered stream across a transport/session boundary, and lost
// pre-tool text on replay (the server's replay-compaction seeds its
// `flush-<toolCallId>` row from the last text-bearing `message_update`).
//
// The faux streaming scenarios used here are defined in
// `qa/fixtures/faux-scenarios.ts` (markers duplicated verbatim, matching the
// convention in `faux-text.spec.ts`); `coalesce-multiparagraph` streams ~8
// paragraphs at the default `FAUX_TPS=50` so the turn lasts long enough to
// observe the live tail and to cut a socket mid-stream.
//
// See change: coalesce-bridge-message-update-snapshots (tasks 6.1–6.5).

const PARAGRAPH_MARKERS = Array.from({ length: 8 }, (_unused, i) => `Coalesce paragraph ${i + 1}.`);
const STREAM_TAIL = "coalesce stream complete";
const REASONING_TAIL = "coalesce reasoning complete";
const REASONING_LAST = "Reasoning step 12 weighs the ordering tradeoff.";
const PRE_TOOL_TEXT = "coalesce pre-tool text";
const TOOL_OUTPUT = "coalesce-tool-ran";

/** The whole visible transcript, for content assertions. */
async function transcriptText(page: Page): Promise<string> {
  return page.getByTestId("chat-scroll-container").innerText();
}

/** Occurrences of `needle` in the visible transcript. */
function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/** Click a session card by id, navigating to the dashboard first if needed. */
async function openSession(page: Page, sessionId: string): Promise<void> {
  const card = page.locator(`[data-testid="session-card-desktop"][data-session-id="${sessionId}"]`);
  await card.waitFor({ state: "visible", timeout: 60_000 });
  await card.click();
}

/**
 * Track live sockets so the established one can be cut on demand. Mirrors
 * `paging-exhausted-reconnect-rearm.spec.ts`: `context.setOffline(true)` does
 * NOT close an established WebSocket, and a page reload would pass vacuously
 * (a fresh socket proves nothing about the transport-boundary flush).
 */
async function armSocketCut(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const Real = window.WebSocket;
    const w = window as unknown as { __coalesceSockets: WebSocket[]; WebSocket: typeof WebSocket };
    w.__coalesceSockets = [];
    const Wrapped = function (url: string, protocols?: string | string[]) {
      const socket = protocols === undefined ? new Real(url) : new Real(url, protocols);
      w.__coalesceSockets.push(socket);
      return socket;
    } as unknown as typeof WebSocket;
    Wrapped.prototype = Real.prototype;
    Object.assign(Wrapped, Real);
    w.WebSocket = Wrapped;
  });
}

async function dropSocket(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __coalesceSockets: WebSocket[] };
    for (const socket of w.__coalesceSockets) {
      try {
        socket.close();
      } catch {
        /* already closing */
      }
    }
  });
}

/**
 * Issue `/reload` to one session exactly as `scripts/reload-all.sh` does: over
 * the DASHBOARD client socket, not the bridge port. In the harness the pi
 * processes live in the container, so the script's own host-side session scan
 * cannot reach them — the wire command is the portable half.
 */
async function sendReload(sessionId: string): Promise<void> {
  const wsUrl = `${BASE_URL.replace(/^http/, "ws").replace(/\/$/, "")}/ws`;
  const socket = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("reload socket open timeout")), 15_000);
    socket.addEventListener(
      "open",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(new Error("reload socket error"));
      },
      { once: true },
    );
  });
  socket.send(JSON.stringify({ type: "send_prompt", sessionId, text: "/reload" }));
  await new Promise((resolve) => setTimeout(resolve, 500));
  socket.close();
}

/** Enable the tool/reasoning surfaces the tool-row assertions need. */
async function enableToolSurfaces(page: Page): Promise<void> {
  const prefs = await page.request.patch("/api/preferences/display", {
    data: {
      toolResults: true,
      toolResultBodies: true,
      reasoning: true,
      toolCalls: { bash: true, generic: true },
    },
  });
  expect(prefs.ok()).toBeTruthy();
}

test.describe("bridge coalesced streaming (L3)", () => {
  test("F1: a multi-paragraph stream converges to the full text with no ghost bubble", async ({ page }) => {
    test.setTimeout(300_000);
    const card = await spawnFreshGitSession(page);
    await card.click();

    const liveTail = page.locator(".chat-stream-live");
    await sendPrompt(page, "[[faux:coalesce-multiparagraph]] go");

    // The windowed tail is on screen while the turn is in flight.
    await expect(liveTail).toHaveCount(1, { timeout: 60_000 });

    // The turn settles with the WHOLE streamed text, not a truncated tail.
    await expect(page.getByText(STREAM_TAIL).first()).toBeVisible({ timeout: 180_000 });
    const text = await transcriptText(page);
    for (const marker of PARAGRAPH_MARKERS) {
      expect(text, `missing ${marker}`).toContain(marker);
    }
    expect(occurrences(text, STREAM_TAIL)).toBe(1);

    // No ghost streaming bubble survives the settle (R4/R6).
    await expect(liveTail).toHaveCount(0);
  });

  test("F2: reasoning renders in full with the tool row after it", async ({ page }) => {
    test.setTimeout(300_000);
    await enableToolSurfaces(page);
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:coalesce-reasoning-tool]] go");
    await expect(page.getByText(REASONING_TAIL).first()).toBeVisible({ timeout: 180_000 });

    // A settled burst mounts collapsed, so expand it to mount the absorbed
    // reasoning + step bodies.
    const group = page.getByTestId("tool-burst-group").first();
    await expect(group).toBeVisible({ timeout: 30_000 });
    await group.getByTestId("tool-burst-header").first().click();
    await expect(group.getByTestId("tool-burst-body").first()).toBeVisible({ timeout: 20_000 });

    // The streamed reasoning is COMPLETE: thinking deltas are additive, so a
    // window that swallowed them would truncate this block. A block that
    // streamed live in this view mounts EXPANDED, so only toggle when collapsed.
    const reasoning = page.getByTestId("reasoning-block").first();
    await expect(reasoning).toBeVisible({ timeout: 30_000 });
    const reasoningBody = page.getByTestId("reasoning-body").first();
    if ((await reasoningBody.count()) === 0) {
      await reasoning.locator("button").first().click();
    }
    await expect(reasoningBody).toContainText(REASONING_LAST, { timeout: 20_000 });

    // Source order kept: the reasoning reads BEFORE the tool's output.
    const text = await transcriptText(page);
    const reasoningAt = text.indexOf(REASONING_LAST);
    const toolAt = text.indexOf(TOOL_OUTPUT);
    expect(reasoningAt, `reasoning missing from: ${text.slice(0, 600)}`).toBeGreaterThanOrEqual(0);
    expect(toolAt, `tool output missing from: ${text.slice(0, 600)}`).toBeGreaterThanOrEqual(0);
    expect(reasoningAt).toBeLessThan(toolAt);
  });

  test("F3: pre-tool text survives a reload above the tool row", async ({ page }) => {
    test.setTimeout(300_000);
    await enableToolSurfaces(page);
    const card = await spawnFreshGitSession(page);
    const sessionId = await card.getAttribute("data-session-id");
    expect(sessionId).toBeTruthy();
    await card.click();

    await sendPrompt(page, "[[faux:coalesce-reasoning-tool]] go");
    await expect(page.getByText(REASONING_TAIL).first()).toBeVisible({ timeout: 180_000 });
    const before = await transcriptText(page);
    expect(before, `pre-tool text missing before reload: ${before.slice(0, 600)}`).toContain(
      PRE_TOOL_TEXT,
    );

    // Reload forces a full history replay. The server's replay compaction keeps
    // only the LAST text-bearing message_update before each tool execution, so a
    // lost snapshot would blank the text above the tool row.
    await page.reload();
    await expect(page.getByTestId("header-app-bar")).toBeVisible({ timeout: 60_000 });
    await openSession(page, sessionId as string);

    await expect(page.getByText(REASONING_TAIL).first()).toBeVisible({ timeout: 60_000 });
    const group = page.getByTestId("tool-burst-group").first();
    await expect(group).toBeVisible({ timeout: 30_000 });
    await group.getByTestId("tool-burst-header").first().click();

    const after = await transcriptText(page);
    const preToolAt = after.indexOf(PRE_TOOL_TEXT);
    const toolAt = after.indexOf(TOOL_OUTPUT);
    expect(preToolAt, `pre-tool text missing after replay: ${after.slice(0, 600)}`).toBeGreaterThanOrEqual(0);
    expect(toolAt, `tool output missing after replay: ${after.slice(0, 600)}`).toBeGreaterThanOrEqual(0);
    expect(preToolAt).toBeLessThan(toolAt);
  });

  test("F4: a mid-turn reconnect converges to the full text exactly once", async ({ page }) => {
    test.setTimeout(300_000);
    await armSocketCut(page);
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:coalesce-multiparagraph]] go");
    const liveTail = page.locator(".chat-stream-live");
    await expect(liveTail).toHaveCount(1, { timeout: 60_000 });

    // Cut the CLIENT socket mid-turn; the app's own backoff reconnects the same
    // instance, so the turn converges through state sync + replayed history
    // rather than through a fresh mount.
    await dropSocket(page);

    await expect(page.getByText(STREAM_TAIL).first()).toBeVisible({ timeout: 180_000 });
    await expect(liveTail).toHaveCount(0);

    const text = await transcriptText(page);
    // No duplicated tail: live content must never land after replayed history.
    expect(occurrences(text, STREAM_TAIL)).toBe(1);
    for (const marker of PARAGRAPH_MARKERS) {
      expect(text, `missing ${marker}`).toContain(marker);
    }
  });

  test("X4: a reload landing mid-stream still renders the rest of the turn", async ({ page }) => {
    test.setTimeout(300_000);
    const card = await spawnFreshGitSession(page);
    const sessionId = await card.getAttribute("data-session-id");
    expect(sessionId).toBeTruthy();
    await card.click();

    await sendPrompt(page, "[[faux:coalesce-multiparagraph]] go");
    const liveTail = page.locator(".chat-stream-live");
    await expect(liveTail).toHaveCount(1, { timeout: 60_000 });

    // The extension reloads mid-turn: the fresh bridge instance never saw this
    // message's `message_start`, so the coalescer's fail-open lazy open is what
    // keeps the REST of the turn streaming instead of being dropped.
    await sendReload(sessionId as string);

    await expect(page.getByText(STREAM_TAIL).first()).toBeVisible({ timeout: 180_000 });
    await expect(liveTail).toHaveCount(0);
    const text = await transcriptText(page);
    for (const marker of PARAGRAPH_MARKERS) {
      expect(text, `missing ${marker}`).toContain(marker);
    }
    expect(occurrences(text, STREAM_TAIL)).toBe(1);
  });
});
