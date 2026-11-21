import { expect, type Page, test } from "./fixtures.js";
import { ensureGitSession, FIXTURE_GIT, spawnFreshGitSession } from "./helpers/index.js";

// Image-only send (change: fix-input-state-consistency, #1136).
//
// A pasted image with no text used to leave the Send button disabled and Enter
// a no-op. Now the chat composer sends `("", [image])`; the directory-home
// composer (spawn takes text only) keeps requiring text.
//
// S63 — directory home: image only → send stays disabled, no session spawns.
// S17 — chat: image only → Send enabled, optimistic bubble shows the image and
//       no empty text row; repeated with Enter.
//
// The image is injected through the REAL user path: a synthetic ClipboardEvent
// carrying a File, which is exactly what useImagePaste's `handlePaste` consumes.

/** Paste a 1x1 PNG into the composer textarea. */
async function pasteTinyImage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const b64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bytes], "tiny.png", { type: "image/png" });
    const composer = Array.from(document.querySelectorAll("textarea")).find((t) =>
      /message/i.test(t.getAttribute("placeholder") ?? ""),
    );
    if (!composer) throw new Error("composer textarea not found");
    composer.focus();
    const dt = new DataTransfer();
    dt.items.add(file);
    composer.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.locator("img[class*='h-16'][src^='data:image/']").first()).toBeVisible({ timeout: 15_000 });
}

function encodeFolderPath(cwd: string): string {
  const bytes = new TextEncoder().encode(cwd);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

test.describe("image-only send", () => {
  test.setTimeout(120_000);

  test("S63: directory home still needs text — image only never spawns a session", async ({ page }) => {
    await ensureGitSession(page);
    const openBtn = page.getByTestId(`folder-home-row-${FIXTURE_GIT}`);
    await expect(openBtn).toBeVisible({ timeout: 15_000 });
    await openBtn.click();
    await expect(page).toHaveURL(new RegExp(`/folder/${encodeFolderPath(FIXTURE_GIT)}$`), { timeout: 15_000 });

    const composer = page.getByPlaceholder(/message/i).first();
    await composer.waitFor({ state: "visible", timeout: 15_000 });
    const cardsBefore = await page.locator('[data-testid="session-card-desktop"]').count();

    await pasteTinyImage(page);
    const send = page.getByTestId("send-button");
    await expect(send).toBeDisabled();
    await composer.press("Enter");

    // Still on the folder home, and no new session card appeared.
    await expect(page).toHaveURL(new RegExp(`/folder/${encodeFolderPath(FIXTURE_GIT)}$`));
    await expect(page.locator('[data-testid="session-card-desktop"]')).toHaveCount(cardsBefore);
  });

  test("S17: chat image-only send — enabled, optimistic bubble shows the image, no empty text row", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    const composer = page.getByPlaceholder(/message/i).first();
    await composer.waitFor({ state: "visible", timeout: 30_000 });

    for (const via of ["click", "enter"] as const) {
      await pasteTinyImage(page);
      const send = page.getByTestId("send-button");
      await expect(send).toBeEnabled();
      const before = await page.locator("[data-testid='attachment-image'], [data-testid='pending-prompt-card'] img").count();
      if (via === "click") await send.click();
      else await composer.press("Enter");

      // The composer drops its thumbnail, and an image shows in the transcript.
      await expect(page.locator("img[class*='h-16'][src^='data:image/']")).toHaveCount(0, { timeout: 15_000 });
      await expect
        .poll(() => page.locator("[data-testid='attachment-image'], [data-testid='pending-prompt-card'] img").count(), {
          timeout: 30_000,
        })
        .toBeGreaterThan(before);
      // The optimistic bubble, while it lasts, never carries an empty Markdown row.
      const pending = page.getByTestId("pending-prompt-card");
      if (await pending.count()) {
        await expect(pending.locator(".flex-1").first().locator("> *")).toHaveCount(0);
      }
      // Wait for the turn to end before the next iteration.
      await expect(page.getByTestId("send-button")).toBeVisible({ timeout: 60_000 });
    }
  });
});
