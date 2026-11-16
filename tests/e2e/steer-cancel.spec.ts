import { expect, type Page, test } from "./fixtures.js";
import { gatewayUrlWithTicket, pairDeviceBearer } from "./helpers/bridge-credential.js";
import { byTestId, FIXTURE_GIT, gotoDashboard, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";
import { BASE_URL } from "./lifecycle.js";

/**
 * Browser E2E for change: bridge-owned-cancellable-steer.
 *
 * Steers sent from the composer while the agent streams are HELD by the bridge
 * (cancellable) and handed to pi at a completed `turn_end`, else drained at
 * settle. Drives the real composer → `send_prompt` → bridge steer buffer →
 * `queue_update` → `PendingSteerCard` → cancel / hand-off chain against the
 * docker harness. Only the LLM is faux.
 *
 * The composer's default delivery is Steer, so Enter mid-stream sends a steer
 * (`sendSteer`). Images are pasted (the composer's own paste path).
 *
 * Covers test-plan rows F1, F2, F3, F4, F5, F6. F5 drives the bridge reload at
 * the wire (the server refuses `/reload` while a session is busy).
 * Exemplars: followup-image-queue.spec.ts, followup-settle-drain.spec.ts.
 */

/** ~22 s single text turn (`slow-stream` lasts ~2 s at the harness's FAUX_TPS). */
const SLOW_STREAM = "[[faux:steer-hold-stream]] go";
const SLOW_STREAM_LAST = "hold-499";
const SLOW_TOOL = "[[faux:slow-tool-steer]] go";
const SLOW_TOOL_FINAL = "slow-tool final answer";

const cards = (page: Page) => byTestId(page, "pendingSteerCard");

/**
 * Spawn a session, select it, and drive it into a streaming turn. Gated on the
 * Stop button, which the composer shows once the run is live server-side.
 */
async function streamingSession(page: Page, prompt = SLOW_STREAM): Promise<void> {
  const card = await spawnFreshGitSession(page);
  await card.click();
  await page.keyboard.press("Escape").catch(() => {});
  await sendPrompt(page, prompt);
  await expect(page.getByTestId("stop-button")).toBeVisible({ timeout: 30_000 });
}

/**
 * Send a steer mid-turn: Enter in the composer follows the delivery state
 * (Steer by default). The send button is not actionable while a run is live,
 * so clicking it would wait out the turn.
 */
async function sendSteer(page: Page, text: string): Promise<void> {
  const composer = page.getByPlaceholder(/message/i).first();
  await composer.fill(text);
  await composer.press("Enter");
  await expect(composer).toHaveValue("", { timeout: 10_000 });
}

/** Paste `count` 1x1 PNGs into the composer through its own paste handler. */
async function pasteImages(page: Page, count: number): Promise<void> {
  await page.evaluate(async (n) => {
    const composer = Array.from(document.querySelectorAll("textarea")).find((t) =>
      /message/i.test(t.getAttribute("placeholder") ?? ""),
    );
    if (!composer) throw new Error("composer textarea not found");
    composer.focus();
    for (let i = 0; i < n; i++) {
      const canvas = document.createElement("canvas");
      canvas.width = 4;
      canvas.height = 4;
      const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b as Blob), "image/png"));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], `shot-${i}.png`, { type: "image/png" }));
      composer.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }
  }, count);
  await expect(page.locator("img[class*='h-16'][src^='data:image/']")).toHaveCount(count, { timeout: 15_000 });
}

test.describe("held steers — cancellable bubbles", () => {
  test("F1: a steer with two images shows one held bubble with an image count of 2 and a cancel control", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await streamingSession(page);

    await pasteImages(page, 2);
    await sendSteer(page, "steer-with-images");

    await expect(cards(page)).toHaveCount(1, { timeout: 15_000 });
    const card = cards(page).first();
    await expect(card).toContainText("steer-with-images");
    await expect(byTestId(page, "pendingSteerAttachments")).toContainText("2");
    await expect(card.locator("[data-testid^='pending-steer-cancel-']")).toHaveCount(1);
  });

  test("F2: cancelling one steer and then clearing the rest leaves none of them in the transcript", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await streamingSession(page);

    for (const text of ["s-a", "s-b", "s-c"]) await sendSteer(page, text);
    await expect(cards(page)).toHaveCount(3, { timeout: 15_000 });

    await cards(page).filter({ hasText: "s-b" }).locator("[data-testid^='pending-steer-cancel-']").click();
    await expect(cards(page)).toHaveCount(2, { timeout: 15_000 });
    await byTestId(page, "pendingSteerClearAll").click();
    await expect(cards(page)).toHaveCount(0, { timeout: 15_000 });

    // The run settles with nothing held: none of the three ever reaches pi.
    await expect(page.getByTestId("stop-button")).toHaveCount(0, { timeout: 120_000 });
    await expect(page.getByText(SLOW_STREAM_LAST).first()).toBeVisible({ timeout: 60_000 });
    for (const text of ["s-a", "s-b", "s-c"]) {
      await expect(page.getByText(text, { exact: true })).toHaveCount(0);
    }
  });

  test("F3: a steer held at the end of a single-turn stream is delivered once, below the assistant text", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await streamingSession(page);

    await sendSteer(page, "s-late");
    await expect(cards(page)).toHaveCount(1, { timeout: 15_000 });

    await expect(cards(page)).toHaveCount(0, { timeout: 120_000 });
    const bubble = page.getByText("s-late", { exact: true });
    await expect(bubble).toHaveCount(1, { timeout: 60_000 });
    expect(await follows(page, "hold-0", "s-late")).toBe(true);
  });

  test("F4: a steer sent during a tool turn lands before the final answer (same boundary)", async ({ page }) => {
    test.setTimeout(240_000);
    await streamingSession(page, SLOW_TOOL);

    await sendSteer(page, "s-mid");
    await expect(cards(page)).toHaveCount(1, { timeout: 15_000 });

    await expect(page.getByText(SLOW_TOOL_FINAL).first()).toBeVisible({ timeout: 120_000 });
    await expect(cards(page)).toHaveCount(0);
    await expect(page.getByText("s-mid", { exact: true })).toHaveCount(1, { timeout: 30_000 });
    expect(await follows(page, "s-mid", SLOW_TOOL_FINAL)).toBe(true);
  });

  test("F5: a reloaded bridge re-announcing empty queues clears a held steer bubble", async ({ page }) => {
    // A held steer exists only mid-run, and the server refuses `/reload` while a
    // session is busy (`dispatchReload`), so the reload is driven at the wire:
    // bridge #1 registers and announces a held steer; bridge #2 (a reloaded
    // instance, same session id) re-registers and re-announces its queues,
    // which a fresh bridge always sends empty (design D7).
    test.setTimeout(120_000);
    await gotoDashboard(page);
    const first = await connectBridge(page, "f5");
    const second = await connectBridge(page, "f5", first.sessionId);
    try {
      first.send({
        type: "queue_update",
        sessionId: first.sessionId,
        steering: [{ id: "old:1", text: "s-reload", imageCount: 0 }],
        followUp: [],
      });
      const card = page.locator(`[data-session-id="${first.sessionId}"]`).first();
      await expect(card).toBeVisible({ timeout: 30_000 });
      await card.click();
      await expect(cards(page)).toHaveCount(1, { timeout: 15_000 });
      await expect(cards(page).first()).toContainText("s-reload");

      // A reload tears the old bridge down before the new instance registers.
      first.close();
      second.register();
      second.send({ type: "queue_update", sessionId: first.sessionId, steering: [], followUp: [] });
      await expect(cards(page)).toHaveCount(0, { timeout: 30_000 });
    } finally {
      first.close();
      second.close();
    }
  });

  test("F6: each cancel ✕ sits at its own bubble's right padding edge, at the same offset", async ({ page }) => {
    test.setTimeout(180_000);
    await streamingSession(page);

    await sendSteer(page, "short steer");
    await pasteImages(page, 1);
    await sendSteer(page, "a longer steer that carries an image attachment");
    await expect(cards(page)).toHaveCount(2, { timeout: 15_000 });

    const offsets = await cards(page).evaluateAll((els) =>
      els.map((card) => {
        const bubble = card.querySelector("[data-testid='pending-steer-bubble']") as HTMLElement;
        const btn = card.querySelector("[data-testid^='pending-steer-cancel-']") as HTMLElement;
        const b = bubble.getBoundingClientRect();
        const padRight = parseFloat(getComputedStyle(bubble).paddingRight);
        const borderRight = parseFloat(getComputedStyle(bubble).borderRightWidth);
        return b.right - padRight - borderRight - btn.getBoundingClientRect().right;
      }),
    );
    expect(offsets).toHaveLength(2);
    for (const off of offsets) expect(Math.abs(off)).toBeLessThanOrEqual(1);
    expect(Math.abs(offsets[0] - offsets[1])).toBeLessThanOrEqual(1);
  });
});

interface RawBridge {
  sessionId: string;
  send: (payload: Record<string, unknown>) => void;
  register: () => void;
  close: () => void;
}

/**
 * A raw bridge socket on the pi gateway (ticketed), as in
 * composer-liveness-reload.spec.ts. Registers immediately unless `sessionId`
 * is passed (then `register()` re-registers that session as a new instance).
 */
async function connectBridge(page: Page, tag: string, sessionId?: string): Promise<RawBridge> {
  const health = (await (await page.request.get("/api/health")).json()) as { piGatewayPort?: number | null };
  const port = health.piGatewayPort ?? null;
  test.skip(!port, "harness health does not expose the bound gateway port");
  const bearer = await pairDeviceBearer(BASE_URL);
  const url = await gatewayUrlWithTicket(BASE_URL, port as number, bearer);
  const ws = await new Promise<WebSocket>((resolve, reject) => {
    const s = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error("open timeout")), 5000);
    s.addEventListener("open", () => { clearTimeout(timer); resolve(s); }, { once: true });
    s.addEventListener("error", () => { clearTimeout(timer); reject(new Error("socket error")); }, { once: true });
  });
  const id = sessionId ?? `e2e-steer-${tag}-${Date.now()}`;
  const send = (payload: Record<string, unknown>) => {
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
    } catch {
      // socket died with the test
    }
  };
  const register = () => {
    send({ type: "session_register", sessionId: id, cwd: FIXTURE_GIT, source: "tui", pid: 426000 + Math.floor(Math.random() * 999) });
    send({ type: "replay_complete", sessionId: id });
  };
  if (!sessionId) register();
  return { sessionId: id, send, register, close: () => { try { ws.close(); } catch { /* closed */ } } };
}

/** DOM order: the first leaf containing `first` precedes the leaf whose text is exactly `second` (or contains it). */
async function follows(page: Page, first: string, second: string): Promise<boolean | null> {
  return page.evaluate(
    ([a, b]) => {
      const leaves = Array.from(document.querySelectorAll("*")).filter((el) => el.children.length === 0);
      const x = leaves.find((el) => el.textContent?.includes(a));
      const y = leaves.find((el) => el.textContent?.trim() === b) ?? leaves.find((el) => el.textContent?.includes(b));
      if (!x || !y) return null;
      return Boolean(x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING);
    },
    [first, second] as const,
  );
}
