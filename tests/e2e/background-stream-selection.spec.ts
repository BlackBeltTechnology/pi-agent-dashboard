import { PLAIN_TEXT_MARKER } from "../../qa/fixtures/faux-scenarios.js";
import { expect, type Page, test } from "./fixtures.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

/**
 * L3 for change: fix-long-session-ux-degradation (test-plan #F11, capability
 * `chat-selection-preservation`).
 *
 * jsdom has no layout engine and no real Selection, so the unit layer can only
 * assert DOM node identity (MarkdownContent.test.tsx #F9/#P2). THIS layer is
 * where the user-visible symptom lives: a text selection held in the FOREGROUND
 * transcript must survive a DIFFERENT, unselected session streaming in the
 * background.
 *
 * Pre-fix mechanism: `MarkdownContent` passed an inline `components={{…}}`, so
 * every re-render minted new `p`/`code`/`a`/`table` component TYPES. React
 * unmounted and recreated the DOM, and the browser collapsed the anchored
 * selection. A background session's events re-render the whole app (its state
 * lives in the same `sessionStates` map), so unrelated activity alone retargeted
 * the foreground selection.
 *
 * The background stream is driven through the REST prompt endpoint rather than
 * the composer so B can stream while A stays SELECTED — the whole point of the
 * scenario. `subagent-streaming-inner` is the documented sustained-streaming
 * fixture (~14 s of token-by-token assistant output), so the hold window is
 * exercised well past a single update; the run is aborted in `finally` so it
 * cannot leak into the next spec on the shared container.
 */

interface AnchorStash {
  __e2eAnchorNode?: Node | null;
  __e2eAnchorEl?: Element | null;
}

/** Select the first ~12 chars of the marker's text node in the chat scroller. */
async function createForegroundSelection(page: Page, marker: string) {
  return page.evaluate((m) => {
    const scroller = document.querySelector("[data-testid='chat-scroll-container']");
    if (!scroller) throw new Error("chat scroller is not mounted");
    const walker = document.createTreeWalker(scroller, NodeFilter.SHOW_TEXT);
    let target: Text | null = null;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node as Text;
      if ((text.textContent ?? "").includes(m)) {
        target = text;
        break;
      }
    }
    if (!target) throw new Error("foreground marker text node not found");

    const range = document.createRange();
    range.setStart(target, 0);
    range.setEnd(target, Math.min(12, target.textContent?.length ?? 0));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    const stash = window as unknown as AnchorStash;
    stash.__e2eAnchorNode = selection?.anchorNode ?? null;
    stash.__e2eAnchorEl = selection?.anchorNode?.parentElement ?? null;

    return { text: selection?.toString() ?? "", collapsed: selection?.isCollapsed ?? true };
  }, marker);
}

/** Re-read the live selection and compare it to the stashed anchor identity. */
async function readSelection(page: Page) {
  return page.evaluate(() => {
    const selection = window.getSelection();
    const stash = window as unknown as AnchorStash;
    const stashedEl = stash.__e2eAnchorEl ?? null;
    return {
      text: selection?.toString() ?? "",
      collapsed: selection?.isCollapsed ?? true,
      anchorSame: selection?.anchorNode != null && selection.anchorNode === stash.__e2eAnchorNode,
      // A replaced DOM leaves the stashed element detached (document.contains
      // false) even if Chromium re-anchors the selection onto the new node.
      anchorElConnected: stashedEl != null && document.contains(stashedEl),
    };
  });
}

test.describe("background stream does not disturb a foreground selection", () => {
  test("F11: selection in the selected session survives another session streaming", async ({ page }) => {
    test.setTimeout(120_000);

    // Count B's assistant-output frames off the browser socket. Registered
    // BEFORE the first navigation so it sees the socket the app opens.
    let backgroundFrames = 0;
    let backgroundSessionId = "";
    page.on("websocket", (ws) => {
      ws.on("framereceived", (frame) => {
        if (!backgroundSessionId) return;
        const payload =
          typeof frame.payload === "string" ? frame.payload : frame.payload.toString("utf8");
        if (payload.includes(backgroundSessionId) && payload.includes("message_update")) {
          backgroundFrames++;
        }
      });
    });

    // 1. Foreground session A with a short, stable assistant paragraph.
    const cardA = await spawnFreshGitSession(page);
    await cardA.click();
    await sendPrompt(page, "[[faux:plain-text]] go");
    await expect(page.getByText(PLAIN_TEXT_MARKER).first()).toBeVisible({ timeout: 60_000 });

    // 2. A second, UNRELATED session B (the background streamer).
    const cardB = await spawnFreshGitSession(page);
    backgroundSessionId = (await cardB.getAttribute("data-session-id")) ?? "";
    expect(backgroundSessionId).not.toBe("");

    // 3. Put the foreground session back in view before selecting in it.
    await cardA.click();
    await expect(page.getByText(PLAIN_TEXT_MARKER).first()).toBeVisible({ timeout: 30_000 });

    // 4. Hold a real selection in A's transcript.
    const before = await createForegroundSelection(page, PLAIN_TEXT_MARKER);
    expect(before.collapsed, "selection should start non-collapsed").toBe(false);
    expect(before.text.length).toBeGreaterThan(3);

    try {
      // 5. Stream assistant output into B — a session the user is NOT viewing.
      const res = await page.request.post(`/api/session/${backgroundSessionId}/prompt`, {
        data: { text: "[[faux:subagent-streaming-inner]] go" },
      });
      expect(res.ok(), `background prompt rejected: ${res.status()}`).toBeTruthy();

      // 6. Wait until B has actually pushed several assistant deltas while A is
      //    selected and the selection is held. This is the load-bearing guard:
      //    if the fixture never streamed, the assertions below would be vacuous.
      await expect.poll(() => backgroundFrames, { timeout: 30_000 }).toBeGreaterThan(5);

      // 7. The foreground selection is still anchored and non-collapsed.
      const after = await readSelection(page);
      expect(after.collapsed, "foreground selection collapsed under background churn").toBe(false);
      expect(after.text, "foreground selection text changed").toBe(before.text);
      expect(after.anchorSame, "foreground selection anchor node was replaced").toBe(true);
      expect(after.anchorElConnected, "foreground markdown element was unmounted").toBe(true);
    } finally {
      // 8. Stop B so a long stream cannot leak into the next spec.
      await page.request
        .post(`/api/session/${backgroundSessionId}/abort`)
        .catch(() => undefined);
    }
  });
});
