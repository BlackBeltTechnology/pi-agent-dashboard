import { expect, test } from "./fixtures.js";
import { byTestId, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

/**
 * Browser E2E for change: fix-bridge-followup-image-drop.
 *
 * Drives the real `send_prompt → bridge buffer → queue_update → server →
 * reducer → chip` round-trip against the docker harness. Only the LLM is faux;
 * the buffer, the wire shape and the rendering are all real — exactly the chain
 * this change rewrites.
 *
 * Image-bearing follow-ups are posted through the dashboard's OWN same-origin
 * REST (`POST /api/session/:id/prompt`, which accepts `images` and defaults to
 * `followUp` delivery). A browser paste is not scriptable, and the REST route
 * reaches the identical bridge handler — the buffer cannot tell the two apart.
 *
 * Covers test-plan rows F1, F2, F3, F5, F6, F7, F8.
 */

/** 1x1 PNG. Small, valid, and its mime passes the bridge allow-list. */
const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const png = (data = PNG_1PX) => ({ type: "image", data, mimeType: "image/png" });
/** Rejected by the allow-list — the bridge drops it and reports the drop. */
const svg = () => ({ type: "image", data: PNG_1PX, mimeType: "image/svg+xml" });

/** The faux scenario that keeps a session streaming long enough to queue into. */
const SLOW_STREAM = "[[faux:slow-stream]] go";

/** Read the selected session's id off the URL the card click navigated to. */
async function selectedSessionId(page: import("@playwright/test").Page): Promise<string> {
  const id = await page.evaluate(() => /\/session\/([^/?#]+)/.exec(window.location.pathname)?.[1]);
  expect(id, "a session must be selected before posting to it").toBeTruthy();
  return id as string;
}

/** POST a prompt (optionally with images) through the same-origin REST route. */
async function postFollowUp(
  page: import("@playwright/test").Page,
  sessionId: string,
  text: string,
  images?: unknown[],
): Promise<number> {
  return page.evaluate(
    async ([id, body]) => {
      const r = await fetch(`/api/session/${id}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return r.status;
    },
    [sessionId, { text, ...(images ? { images } : {}) }] as const,
  );
}

/** Spawn a session, select it, and drive it into a long streaming turn. */
async function streamingSession(page: import("@playwright/test").Page): Promise<string> {
  const card = await spawnFreshGitSession(page);
  await card.click();
  await sendPrompt(page, SLOW_STREAM);
  // Streaming has begun once the first scripted chunk renders.
  await expect(page.getByText("slow-chunk-0").first()).toBeVisible({ timeout: 30_000 });
  return selectedSessionId(page);
}

test.describe("follow-up queue — attachment indicator", () => {
  test("F1: a chip for an image-bearing follow-up shows the attachment count, not a thumbnail", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const sessionId = await streamingSession(page);

    expect(await postFollowUp(page, sessionId, "describe these", [png(), png()])).toBeLessThan(400);

    await expect(byTestId(page, "queueChipFollowup").first()).toContainText("describe these", {
      timeout: 15_000,
    });
    const indicator = byTestId(page, "queueFollowupAttachments").first();
    await expect(indicator).toBeVisible({ timeout: 15_000 });
    await expect(indicator).toContainText("2");
    // Bytes never cross the wire, so the chip has nothing to render an <img> from.
    await expect(byTestId(page, "queuePanel").locator("img")).toHaveCount(0);
  });

  test("F2: a text-only follow-up chip carries no indicator at all", async ({ page }) => {
    test.setTimeout(180_000);
    const sessionId = await streamingSession(page);

    expect(await postFollowUp(page, sessionId, "plain queued prompt")).toBeLessThan(400);

    await expect(byTestId(page, "queueChipFollowup").first()).toContainText("plain queued prompt", {
      timeout: 15_000,
    });
    // Absent from the DOM — not merely hidden.
    await expect(byTestId(page, "queueFollowupAttachments")).toHaveCount(0);
  });

  test("F3: editing a chip's text preserves its attachment indicator", async ({ page }) => {
    test.setTimeout(180_000);
    const sessionId = await streamingSession(page);

    expect(await postFollowUp(page, sessionId, "describe it", [png()])).toBeLessThan(400);
    await expect(byTestId(page, "queueFollowupAttachments").first()).toContainText("1", {
      timeout: 15_000,
    });

    await byTestId(page, "queueFollowupEdit").first().click();
    await byTestId(page, "queueFollowupEditor").fill("describe it in detail");
    await byTestId(page, "queueFollowupEditorSubmit").click();

    // The edit replaces TEXT only; the bridge keeps the entry's images.
    await expect(byTestId(page, "queueChipFollowup").first()).toContainText(
      "describe it in detail",
      { timeout: 15_000 },
    );
    await expect(byTestId(page, "queueFollowupAttachments").first()).toContainText("1");
  });

  test("F7: an attachment dropped by the allow-list is visible in chat and excluded from the count", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const sessionId = await streamingSession(page);

    expect(
      await postFollowUp(page, sessionId, "three attachments", [png(), svg(), png()]),
    ).toBeLessThan(400);

    // Two survive the allow-list; the SVG is dropped.
    await expect(byTestId(page, "queueFollowupAttachments").first()).toContainText("2", {
      timeout: 15_000,
    });
    // And the drop is REPORTED — a silent strip is the defect class this change closes.
    await expect(page.getByText(/attachment\(s\) dropped/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe("follow-up queue — wire-shape skew", () => {
  test("F5: a legacy string[] payload still renders readable chip text", async ({ page }) => {
    test.setTimeout(180_000);

    // Downgrade every server→client follow-up array to the PRE-change `string[]`
    // shape, reproducing a browser tab left open across an extension reload.
    // Installed before the dashboard opens its socket.
    await page.routeWebSocket(/.*/, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((m) => server.send(m));
      server.onMessage((m) => {
        if (typeof m !== "string" || !m.includes("followUp")) return ws.send(m);
        try {
          const parsed = JSON.parse(m);
          const downgrade = (queues: { followUp?: unknown[] } | undefined) => {
            if (!queues || !Array.isArray(queues.followUp)) return;
            queues.followUp = queues.followUp.map((e) =>
              e && typeof e === "object" ? (e as { text?: string }).text ?? "" : e,
            );
          };
          downgrade(parsed?.updates?.pendingQueues);
          downgrade(parsed?.pendingQueues);
          if (Array.isArray(parsed?.followUp)) {
            parsed.followUp = parsed.followUp.map((e: unknown) =>
              e && typeof e === "object" ? (e as { text?: string }).text ?? "" : e,
            );
          }
          ws.send(JSON.stringify(parsed));
        } catch {
          ws.send(m);
        }
      });
    });

    const sessionId = await streamingSession(page);
    expect(await postFollowUp(page, sessionId, "hello")).toBeLessThan(400);

    const panel = byTestId(page, "queuePanel");
    await expect(byTestId(page, "queueChipFollowup").first()).toContainText("hello", {
      timeout: 15_000,
    });
    await expect(panel).not.toContainText("[object Object]");
    await expect(byTestId(page, "queueFollowupAttachments")).toHaveCount(0);
  });
});

test.describe("follow-up queue — refusal is user-visible", () => {
  test("F6: a send refused at the queue-depth cap surfaces in chat and does not grow the queue", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const sessionId = await streamingSession(page);

    // Fill the buffer to its 20-entry cap.
    for (let i = 0; i < 20; i++) {
      expect(await postFollowUp(page, sessionId, `queued-${i}`)).toBeLessThan(400);
    }
    await expect(byTestId(page, "queueFollowupPosition").first()).toContainText(/20/, {
      timeout: 20_000,
    });

    // The 21st is refused — and the user is told, rather than it vanishing.
    expect(await postFollowUp(page, sessionId, "one-too-many")).toBeLessThan(400);

    await expect(page.getByText(/queue is full/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(byTestId(page, "queueFollowupPosition").first()).toContainText(/20/);
    await expect(byTestId(page, "queuePanel")).not.toContainText("one-too-many");
  });
});

test.describe("follow-up queue — drained delivery", () => {
  test("F8: a drained image-bearing follow-up renders a chat row instead of vanishing", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const sessionId = await streamingSession(page);

    // An image large enough to bust the 256 KiB per-event ceiling: the store must
    // preserve the message envelope and strip only the bytes, so the row still
    // renders. Guards the display half closed by fix-pasted-image-message-vanishes
    // against this change's new drain payload.
    const bigPng = png("A".repeat(400 * 1024));
    expect(
      await postFollowUp(page, sessionId, "drained-image-probe", [bigPng]),
    ).toBeLessThan(400);

    await expect(byTestId(page, "queueFollowupAttachments").first()).toBeVisible({
      timeout: 20_000,
    });

    // When the streaming turn ends the buffer drains as a fresh turn, and the
    // drained prompt must appear in the transcript — text AND an image slot.
    await expect(page.getByText("drained-image-probe").first()).toBeVisible({ timeout: 120_000 });
    await expect(byTestId(page, "queuePanel")).toHaveCount(0);
  });
});
