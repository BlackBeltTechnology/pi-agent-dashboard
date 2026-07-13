import { expect, type Page, test } from "@playwright/test";
import { byTestId, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

/**
 * Browser-layer gate for change `reduce-chat-render-cpu-umbrella`.
 *
 * Covers the umbrella's OWN surface that jsdom/vitest cannot reach and that the
 * sibling `chat-transcript-virtualization.spec.ts` does NOT already gate:
 *   - Phase 1 reduced-motion contract (tasks 2.7 / 5.3): the decorative FX the
 *     audit converted (streaming glow-pulse + sweep) are STRIPPED when the OS
 *     asks for reduced motion — verified as real Chrome computed style, not CSS
 *     source inspection.
 *   - task 4.3 "auto-scroll follow" bullet: while pinned at the bottom, an
 *     overflowing transcript that keeps growing keeps the viewport pinned (the
 *     Step-A `content-visibility` intrinsic-size estimate must not break
 *     bottom-follow). The scroll-UP lock, jump-to-turn and windowing-bound
 *     bullets of 4.3 are already gated by `chat-transcript-virtualization.spec.ts`;
 *     this only adds the un-gated follow bullet.
 *
 * FIXTURES: test 1 uses `[[faux:slow-stream]]` (a single long body) so
 * `.chat-stream-live` stays mounted for a comfortable FX window — no racing a 2s
 * tool sleep. Test 2 uses `[[faux:long-transcript]]` (~120 turns) because
 * slow-stream is a single message that never overflows the viewport, so there is
 * nothing to follow; only the long transcript grows past several viewports while
 * streaming. Needs PI_E2E_SEED=1 (managed sets it).
 */

const SLOW = "[[faux:slow-stream]] go";
const LONG = "[[faux:long-transcript]] go";
const streamLive = (page: Page) => page.locator(".chat-stream-live");
const chatScroll = (page: Page) => byTestId(page, "chatScrollContainer");

/** Computed `animation-name` of a pseudo-element on the live streaming bubble. */
function pseudoAnimName(page: Page, pseudo: "::before" | "::after"): Promise<string> {
  return streamLive(page)
    .first()
    .evaluate(
      (el, p) => getComputedStyle(el, p).animationName,
      pseudo,
    );
}

async function scrollMetrics(page: Page) {
  return chatScroll(page).evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    overflow: el.scrollHeight - el.clientHeight,
    distanceFromBottom: el.scrollHeight - el.scrollTop - el.clientHeight,
  }));
}

test.describe("chat render — Phase 1 FX + auto-follow (umbrella gate)", () => {
  // ── Phase 1: reduced-motion strips the streaming FX (tasks 2.7 / 5.3) ──────
  test("reduced-motion strips streaming glow-pulse + sweep animations", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await sendPrompt(page, SLOW);

    // Catch the live streaming bubble mid-stream.
    await streamLive(page).first().waitFor({ state: "attached", timeout: 60_000 });

    // Default (no reduced-motion): the audited FX run as keyframed animations.
    expect(await pseudoAnimName(page, "::before")).toBe("chat-stream-glow-pulse");
    expect(await pseudoAnimName(page, "::after")).toBe("tool-group-sweep");

    // Ask for reduced motion — the media query must strip BOTH to `none` live.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect
      .poll(() => pseudoAnimName(page, "::before"), { timeout: 5_000 })
      .toBe("none");
    expect(await pseudoAnimName(page, "::after")).toBe("none");
  });

  // ── task 4.3 (auto-scroll follow bullet): pinned bottom follows new content ─
  test("auto-follow: pinned at bottom, viewport tracks streamed content", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await sendPrompt(page, LONG);
    await chatScroll(page).waitFor({ state: "visible" });

    // Wait until the transcript overflows the viewport (something to follow) and
    // capture the pinned baseline. Auto-follow keeps us at the bottom as it grows.
    await expect
      .poll(async () => (await scrollMetrics(page)).overflow, { timeout: 60_000 })
      .toBeGreaterThan(400);
    const start = await scrollMetrics(page);
    expect(start.distanceFromBottom).toBeLessThan(60); // pinned while growing

    // The transcript keeps growing by hundreds of px, and the viewport stays
    // pinned to the bottom (Step-A intrinsic-size must not desync bottom-follow).
    await expect
      .poll(async () => (await scrollMetrics(page)).scrollHeight, { timeout: 60_000 })
      .toBeGreaterThan(start.scrollHeight + 200);
    expect((await scrollMetrics(page)).distanceFromBottom).toBeLessThan(80);
  });
});
