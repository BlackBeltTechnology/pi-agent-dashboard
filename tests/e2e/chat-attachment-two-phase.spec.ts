import { expect, type Page, test } from "@playwright/test";
import { spawnFreshGitSession } from "./helpers/index.js";

// Two-phase attachment render (change: fit-attachments-for-display).
//
// A pasted screenshot used to blow the event store's per-event serialized
// ceiling, collapse the event to {__truncated}, and take the user's whole
// message row with it — the message vanished silently. The server now stores
// the row immediately with a bounded PLACEHOLDER and swaps in a 768px display
// derivative when the off-loop fit completes.
//
// F1 — the row renders before any image, placeholder in the attachment slot.
// F2 — the fitted image replaces the placeholder in the same position, and the
//      surrounding message + row count are unchanged.
//
// The attachment is injected through the REAL user path: a synthetic
// ClipboardEvent carrying a File, which is exactly what useImagePaste's
// `handlePaste` consumes (`e.clipboardData.items`).
//
// Sends are driven with Enter rather than clicking the send button: holding a
// multi-MB base64 in composer state makes the button's actionability check
// intermittently stall (visible+enabled+stable, but the click never lands),
// while Enter is both a real user path and immune to that.

/**
 * Build a large PNG in the page and paste it into the composer.
 *
 * Noise pixels (not a flat fill) so PNG cannot compress it to nothing: the
 * image must be BOTH over the 768px display bound (so it is actually resized)
 * and multi-MB (so the resize is slow enough that the placeholder is
 * observable rather than a single-frame flash).
 */
/**
 * Scroll the virtualized transcript top-to-bottom and report which
 * `image message N` rows were seen carrying a RESOLVED attachment image.
 *
 * Needed because rows outside the viewport are unmounted: asserting all N at
 * once can only ever observe the tail. Returns the set of indices whose row
 * rendered an `attachment-image`.
 */
async function sweepTranscriptRows(page: Page, total: number): Promise<Set<number>> {
  const scroller = page.getByTestId("chat-scroll-container");
  const withImage = new Set<number>();

  await scroller.evaluate((el) => {
    el.scrollTop = 0;
  });

  // Bounded: each step advances ~80% of a viewport, and the loop also exits on
  // reaching the bottom. The cap only guards against a non-scrolling container.
  for (let step = 0; step < 200; step++) {
    for (const [idx, hasImg] of await page.evaluate(() => {
      const rows: Array<[number, boolean]> = [];
      // Scan per MESSAGE, not per virtualized row: ChatView groups messages
      // into turns, so one `[data-index]` row holds many labels and matching
      // it against the row's whole textContent reports only the first.
      for (const p of document.querySelectorAll("p")) {
        const m = /^image message (\d+)$/.exec((p.textContent ?? "").trim());
        if (!m) continue;
        // Walk up to the smallest ancestor that owns an attachment image AND
        // exactly one label — i.e. this message's own bubble, not the turn.
        let hasImg = false;
        let el: HTMLElement | null = p.parentElement;
        for (let hops = 0; el && hops < 4; hops++, el = el.parentElement) {
          if (el.querySelector("[data-testid='attachment-image']") === null) continue;
          if ((el.textContent ?? "").match(/image message \d+/g)?.length === 1) {
            hasImg = true;
            break;
          }
        }
        rows.push([Number(m[1]), hasImg]);
      }
      return rows;
    })) {
      if (hasImg) withImage.add(idx);
    }
    if (withImage.size === total) break;

    const atBottom = await scroller.evaluate((el) => {
      const done = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
      if (!done) el.scrollTop += el.clientHeight * 0.8;
      return done;
    });
    if (atBottom) break;
    // Let the virtualizer mount the newly-exposed window and its images decode.
    await page.waitForTimeout(250);
  }
  return withImage;
}

async function pasteLargeImage(page: Page, w = 1600, h = 1200): Promise<number> {
  return await page.evaluate(
    async ([width, height]) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      const img = ctx.createImageData(width, height);
      for (let i = 0; i < img.data.length; i += 4) {
        img.data[i] = (i * 7) % 255;
        img.data[i + 1] = (i * 13) % 255;
        img.data[i + 2] = (i * 29) % 255;
        img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);

      const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), "image/png"));
      const file = new File([blob], "screenshot.png", { type: "image/png" });

      // Target the composer textarea specifically (CommandInput binds onPaste
      // there); a bare `textarea` selector can match an unrelated field.
      const composer = Array.from(document.querySelectorAll("textarea")).find((t) =>
        /message/i.test(t.getAttribute("placeholder") ?? ""),
      );
      if (!composer) throw new Error("composer textarea not found");
      composer.focus();

      const dt = new DataTransfer();
      dt.items.add(file);
      composer.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
      );
      return blob.size;
    },
    [w, h] as const,
  );
}

test.describe("chat attachments — two-phase render", () => {
  // Generating a multi-MB noise PNG in-page, base64-ing it through FileReader,
  // and round-tripping it through the fit worker all cost real time.
  test.setTimeout(180_000);

  test("F1/F2: row renders with a placeholder, then the fitted image swaps in", async ({
    page,
  }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    const composer = page.getByPlaceholder(/message/i).first();
    await composer.waitFor({ state: "visible", timeout: 30_000 });

    const bytes = await pasteLargeImage(page);
    expect(bytes, "fixture image should be large enough to require fitting").toBeGreaterThan(
      200_000,
    );

    // Paste landed: ImagePreviewStrip renders a 64px thumbnail per pending image.
    await expect(page.locator("img[class*='h-16'][src^='data:image/']").first()).toBeVisible({
      timeout: 15_000,
    });

    await composer.fill("here is the screenshot");

    // Latch the PENDING phase before it can disappear. Asserting visibility of
    // `attachment-pending` directly would race a fast fit; a MutationObserver
    // armed before send records that the phase EVER existed, which is the
    // actual two-phase invariant. Without it, a regression that withholds
    // `message_start` until fitting completes still satisfies F1/F2.
    await page.evaluate(() => {
      const w = window as unknown as { __sawPending?: boolean };
      w.__sawPending = false;
      const seen = () => document.querySelector("[data-testid='attachment-pending']") !== null;
      if (seen()) {
        w.__sawPending = true;
        return;
      }
      new MutationObserver(() => {
        if (seen()) w.__sawPending = true;
      }).observe(document.body, { childList: true, subtree: true });
    });

    await composer.press("Enter");

    const userRow = page.locator("[data-role='user'], [data-testid='chat-message-user']").last();
    const pending = page.getByTestId("attachment-pending");
    const image = page.getByTestId("attachment-image");

    // F1 — the message row is present. The row must NOT wait on the fit.
    await expect(userRow.or(page.getByText("here is the screenshot")).first()).toBeVisible({
      timeout: 20_000,
    });

    // F1b — the row was delivered in its PENDING phase, i.e. before the fit
    // finished. This is what makes F1 meaningful rather than incidental.
    await expect
      .poll(
        async () =>
          await page.evaluate(() => (window as unknown as { __sawPending?: boolean }).__sawPending),
        { timeout: 60_000 },
      )
      .toBe(true);

    // F2 — convergence: whatever the interleaving, the transcript settles on a
    // real <img> with no placeholder left pending. Asserted as convergence
    // rather than an instantaneous snapshot so a fast fit cannot make it flaky.
    await expect(image.first()).toBeVisible({ timeout: 60_000 });
    await expect(pending).toHaveCount(0, { timeout: 60_000 });

    // The surrounding message survived — this is the actual regression: the
    // row used to disappear entirely.
    await expect(page.getByText("here is the screenshot").first()).toBeVisible();

    // Converges on the FITTED derivative. Polled rather than sampled once:
    // immediately after send the client renders its own optimistic echo of the
    // pasted file (full resolution, never round-tripped through the server),
    // and only once `message_start` + `attachment_fitted` land does the row
    // show the server's 768px derivative.
    await expect
      .poll(
        async () =>
          await image
            .first()
            .evaluate((el) => (el as HTMLImageElement).naturalWidth)
            .catch(() => -1),
        { timeout: 90_000, message: "transcript image should converge on the fitted derivative" },
      )
      .toBeLessThanOrEqual(768);

    expect(
      await image.first().evaluate((el) => (el as HTMLImageElement).naturalWidth),
    ).toBeGreaterThan(0);
  });

  test("F7: the image still renders after a reload (replay path is fitted too)", async ({
    page,
  }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    const composer = page.getByPlaceholder(/message/i).first();
    await composer.waitFor({ state: "visible", timeout: 30_000 });
    await pasteLargeImage(page, 1600, 1200);
    await expect(page.locator("img[class*='h-16'][src^='data:image/']").first()).toBeVisible({
      timeout: 15_000,
    });
    await composer.fill("reload me");
    await composer.press("Enter");

    await expect(page.getByTestId("attachment-image").first()).toBeVisible({ timeout: 60_000 });

    // Hydration rebuilds events from the transcript with FULL-RESOLUTION bytes;
    // without fitting on that path the row collapses to {__truncated} again.
    await page.reload();
    await expect(page.getByText("reload me").first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("attachment-image").first()).toBeVisible({ timeout: 60_000 });
  });

  test("F3: undecodable bytes resolve to an explicit failed state, not a stuck placeholder", async ({
    page,
  }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    const composer = page.getByPlaceholder(/message/i).first();
    await composer.waitFor({ state: "visible", timeout: 30_000 });

    // A File that CLAIMS image/png but carries garbage. The client accepts it
    // (mime is allow-listed), so the server is the first thing that actually
    // tries to decode it — which is the failure this scenario is about.
    await page.evaluate(() => {
      const file = new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])], "broken.png", {
        type: "image/png",
      });
      const composerEl = Array.from(document.querySelectorAll("textarea")).find((t) =>
        /message/i.test(t.getAttribute("placeholder") ?? ""),
      )!;
      composerEl.focus();
      const dt = new DataTransfer();
      dt.items.add(file);
      composerEl.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
      );
    });

    await expect(page.locator("img[class*='h-16'][src^='data:image/']").first()).toBeVisible({
      timeout: 15_000,
    });
    await composer.fill("this one is broken");
    await composer.press("Enter");

    // The message row must survive regardless — the attachment failing is not
    // allowed to take the message with it.
    await expect(page.getByText("this one is broken").first()).toBeVisible({ timeout: 60_000 });

    // And the attachment must reach an EXPLICIT failed state; a placeholder
    // left pending forever is the specific regression this guards.
    await expect(page.getByTestId("attachment-failed").first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("attachment-pending")).toHaveCount(0, { timeout: 60_000 });
  });

  test("F5: clicking the fitted image opens the full-resolution original", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    const composer = page.getByPlaceholder(/message/i).first();
    await composer.waitFor({ state: "visible", timeout: 30_000 });
    await pasteLargeImage(page, 1600, 1200);
    await expect(page.locator("img[class*='h-16'][src^='data:image/']").first()).toBeVisible({
      timeout: 15_000,
    });
    await composer.fill("open me full size");
    await composer.press("Enter");

    const image = page.getByTestId("attachment-image");
    // Wait for the SERVER's fitted derivative (not the optimistic echo).
    await expect
      .poll(
        async () =>
          await image.first().evaluate((el) => (el as HTMLImageElement).naturalWidth).catch(() => -1),
        { timeout: 90_000 },
      )
      .toBeLessThanOrEqual(768);

    await image.first().click();

    const lightbox = page.getByTestId("lightbox-image");
    await expect(lightbox).toBeVisible({ timeout: 15_000 });
    // Zoom targets the session-scoped originals endpoint, not the inline data URL.
    await expect(lightbox).toHaveAttribute("src", /\/api\/sessions\/.+\/attachments\/[0-9a-f]{64}/);
    // ...and it really is the ORIGINAL: larger than the 768px display bound.
    await expect
      .poll(
        async () => await lightbox.evaluate((el) => (el as HTMLImageElement).naturalWidth),
        { timeout: 30_000, message: "lightbox should load the full-resolution original" },
      )
      .toBeGreaterThan(768);
  });

  test("F6: a failing original degrades only the zoom, never the transcript", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    const composer = page.getByPlaceholder(/message/i).first();
    await composer.waitFor({ state: "visible", timeout: 30_000 });
    await pasteLargeImage(page, 1600, 1200);
    await expect(page.locator("img[class*='h-16'][src^='data:image/']").first()).toBeVisible({
      timeout: 15_000,
    });
    await composer.fill("original will 404");
    await composer.press("Enter");

    const image = page.getByTestId("attachment-image");
    await expect
      .poll(
        async () =>
          await image.first().evaluate((el) => (el as HTMLImageElement).naturalWidth).catch(() => -1),
        { timeout: 90_000 },
      )
      .toBeLessThanOrEqual(768);

    // Force the originals endpoint to fail for the zoom request only.
    await page.route("**/api/sessions/*/attachments/*", (route) =>
      route.fulfill({ status: 404, contentType: "application/json", body: '{"success":false}' }),
    );

    await image.first().click();
    const lightbox = page.getByTestId("lightbox-image");
    await expect(lightbox).toBeVisible({ timeout: 15_000 });

    // The zoom falls back to the fitted derivative instead of an empty frame.
    await expect(lightbox).toHaveAttribute("data-degraded", "true", { timeout: 20_000 });
    await expect
      .poll(async () => await lightbox.evaluate((el) => (el as HTMLImageElement).naturalWidth), {
        timeout: 20_000,
      })
      .toBeGreaterThan(0);

    // The transcript image itself is untouched — only the zoom degraded.
    await expect(image.first()).toBeVisible();
  });

  test("F4: reloading mid-fit still yields a resolved attachment, never a stuck placeholder", async ({
    page,
  }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    const composer = page.getByPlaceholder(/message/i).first();
    await composer.waitFor({ state: "visible", timeout: 30_000 });
    // Deliberately large so the fit is still in flight when we reload.
    await pasteLargeImage(page, 2000, 1500);
    await expect(page.locator("img[class*='h-16'][src^='data:image/']").first()).toBeVisible({
      timeout: 20_000,
    });
    await composer.fill("reload mid fit");
    await composer.press("Enter");

    // Reload as soon as the row exists — do NOT wait for the fitted image, so
    // the reload races the in-flight resize.
    await expect(page.getByText("reload mid fit").first()).toBeVisible({ timeout: 60_000 });
    await page.reload();

    // The row must come back...
    await expect(page.getByText("reload mid fit").first()).toBeVisible({ timeout: 60_000 });
    // ...and the attachment must SETTLE either way. What is forbidden is an
    // indefinite placeholder: a fit interrupted by reload must still converge.
    await expect
      .poll(
        async () =>
          (await page.getByTestId("attachment-image").count()) +
          (await page.getByTestId("attachment-failed").count()),
        { timeout: 90_000, message: "attachment should settle to ready or failed after reload" },
      )
      .toBeGreaterThan(0);
    await expect(page.getByTestId("attachment-pending")).toHaveCount(0, { timeout: 90_000 });
  });

  test("F8: an image row keeps its height when scrolled out of the window and back", async ({
    page,
  }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    const composer = page.getByPlaceholder(/message/i).first();
    await composer.waitFor({ state: "visible", timeout: 30_000 });

    await pasteLargeImage(page, 1200, 900);
    await expect(page.locator("img[class*='h-16'][src^='data:image/']").first()).toBeVisible({
      timeout: 20_000,
    });
    await composer.fill("height anchor row");
    await composer.press("Enter");

    const image = page.getByTestId("attachment-image");
    await expect
      .poll(
        async () =>
          await image.first().evaluate((el) => (el as HTMLImageElement).naturalWidth).catch(() => -1),
        { timeout: 90_000 },
      )
      .toBeLessThanOrEqual(768);

    // Measure while the row is definitely mounted. Measuring after the filler
    // turns would race the virtualizer, which may already have unmounted it.
    const anchorRow = page.getByText("height anchor row").first();
    await expect(anchorRow).toBeVisible({ timeout: 30_000 });
    const before = await anchorRow.boundingBox();
    expect(before, "anchor row should be measurable while mounted").not.toBeNull();

    // Push the image row out of the window with filler turns.
    for (let i = 0; i < 6; i++) {
      await composer.fill(`filler ${i}`);
      await composer.press("Enter");
      await expect(page.getByText(`filler ${i}`).first()).toBeVisible({ timeout: 60_000 });
    }

    const scroller = page.getByTestId("chat-scroll-container");
    await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page.waitForTimeout(500);
    await scroller.evaluate((el) => { el.scrollTop = 0; });
    await page.waitForTimeout(1000);

    // Scrolling back must REMOUNT the row; wait for that rather than assuming.
    await expect(anchorRow).toBeVisible({ timeout: 30_000 });
    const after = await anchorRow.boundingBox();
    expect(after, "anchor row should still be measurable after scrolling back").not.toBeNull();
    // The virtualized row must not collapse when remeasured post-decode; a
    // near-zero height here is the overlap regression the chat-view invariant
    // exists to prevent.
    expect(after!.height).toBeGreaterThan(0);
    expect(Math.abs(after!.height - before!.height)).toBeLessThanOrEqual(4);
    await expect(image.first()).toBeVisible();
  });

  // Regression guard for the task-9.4 reducer defect: identical images share one
  // content hash, so ONE attachment_fitted resolves several rows. This spec
  // originally failed because the reducer stopped at the first match.
  test("P5: an image-heavy session replays without dropping a gateway frame", async ({
    page,
    request,
  }) => {
    // test-plan #P5 specifies 20 image-bearing messages; 8 is used here to keep
    // the in-page PNG generation within a sane runtime while still exercising
    // many image rows through one replay. The invariant asserted is identical.
    const MESSAGES = 8;

    const card = await spawnFreshGitSession(page);
    await card.click();
    const composer = page.getByPlaceholder(/message/i).first();
    await composer.waitFor({ state: "visible", timeout: 30_000 });

    for (let i = 0; i < MESSAGES; i++) {
      await pasteLargeImage(page, 900, 700);
      await expect(page.locator("img[class*='h-16'][src^='data:image/']").first()).toBeVisible({
        timeout: 20_000,
      });
      await composer.fill(`image message ${i}`);
      await composer.press("Enter");
      await expect(page.getByText(`image message ${i}`).first()).toBeVisible({ timeout: 60_000 });
    }

    const healthBefore = await (await request.get("/api/health")).json();
    const droppedBefore = healthBefore?.droppedFrames?.serverToBrowser?.total ?? 0;

    // Replay the whole image-bearing session.
    await page.reload();
    await expect(page.getByText(`image message ${MESSAGES - 1}`).first()).toBeVisible({
      timeout: 120_000,
    });
    // Every replayed row AND its attachment — not just the last row and "at
    // least one" image, which a replay that dropped 7 of 8 rows still passed.
    //
    // The transcript is VIRTUALIZED (@tanstack/react-virtual, overscan 6), so
    // off-screen rows are unmounted and no single-shot assertion can see more
    // than the tail. Sweep from the top and accumulate what each row showed.
    await expect(page.getByTestId("attachment-pending")).toHaveCount(0, { timeout: 120_000 });
    const withImage = await sweepTranscriptRows(page, MESSAGES);
    const missing = Array.from({ length: MESSAGES }, (_, i) => i).filter((i) => !withImage.has(i));
    expect(missing, `replayed rows missing a resolved attachment: ${missing.join(", ")}`).toEqual(
      [],
    );

    const healthAfter = await (await request.get("/api/health")).json();
    const droppedAfter = healthAfter?.droppedFrames?.serverToBrowser?.total ?? 0;
    // Fitting bounds every frame well under MAX_WS_BUFFER, so replay must not
    // shed a single frame under back-pressure.
    expect(droppedAfter).toBe(droppedBefore);
  });
});

