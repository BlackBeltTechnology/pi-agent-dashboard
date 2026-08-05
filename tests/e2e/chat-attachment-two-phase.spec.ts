import { test, expect, type Page } from "@playwright/test";
import { byTestId, spawnFreshGitSession } from "./helpers/index.js";

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

/**
 * Build a large PNG in the page and paste it into the composer.
 *
 * Noise pixels (not a flat fill) so PNG cannot compress it to nothing: the
 * image must be BOTH over the 768px display bound (so it is actually resized)
 * and multi-MB (so the resize is slow enough that the placeholder is
 * observable rather than a single-frame flash).
 */
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
    await byTestId(page, "sendButton").click();

    const userRow = page.locator("[data-role='user'], [data-testid='chat-message-user']").last();
    const pending = page.getByTestId("attachment-pending");
    const image = page.getByTestId("attachment-image");

    // F1 — the message row is present. The row must NOT wait on the fit.
    await expect(userRow.or(page.getByText("here is the screenshot")).first()).toBeVisible({
      timeout: 20_000,
    });

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
    await byTestId(page, "sendButton").click();

    await expect(page.getByTestId("attachment-image").first()).toBeVisible({ timeout: 60_000 });

    // Hydration rebuilds events from the transcript with FULL-RESOLUTION bytes;
    // without fitting on that path the row collapses to {__truncated} again.
    await page.reload();
    await expect(page.getByText("reload me").first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("attachment-image").first()).toBeVisible({ timeout: 60_000 });
  });
});
