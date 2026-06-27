import { test, expect } from "@playwright/test";
import { spawnFreshGitSession, sendPrompt } from "./helpers/index.js";
import { SCREENSHOT_INLINE } from "../../qa/fixtures/faux-scenarios.js";

// Faux round-trip — inline agent screenshot artifacts (Fix B).
//
// `[[faux:tool-screenshot]]` drives a REAL `bash` tool call that writes a tiny
// valid PNG to an absolute path and echoes `Screenshot saved: <path>`. The
// result text flows through the REAL bridge, where `inlineToolResultImages`
// reads the file at `tool_execution_end`, attaches a `type:"image"` content
// block, and strips the consumed path (D5). The dashboard reducer extracts the
// block and BashToolRenderer (auto-expanded via hasImages) renders it inline.
//
// This proves Fix B end-to-end in a real browser — bridge inline → /ws →
// reducer → renderer — which the unit tests cannot: an inline <img> appears and
// NO path-link is rendered for the consumed screenshot path.
//
// See change: inline-agent-screenshot-artifacts (automates manual task 4.2).
test.describe("faux round-trip — inline agent screenshot", () => {
  test("bash screenshot result renders inline, auto-expanded, with no path-link", async ({
    page,
  }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:tool-screenshot]] go");

    // Settle the turn: the 2-step scenario ends with this text after the tool
    // result, so waiting for it guarantees the bash tool_execution_end (and the
    // bridge inline) has been processed before asserting.
    await expect(page.getByText("screenshot captured").first()).toBeVisible({
      timeout: 30_000,
    });

    // The bridge inlined the PNG (under the artifact root) → an inline <img>
    // with a data:image/png src is visible WITHOUT clicking: ToolCallStep
    // auto-expands when images arrive (live tool_execution_end).
    const img = page.locator('img[src^="data:image/png;base64,"]').first();
    await expect(img).toBeVisible({ timeout: 30_000 });

    // D5: the consumed path is stripped from the RESULT, so no FileLink renders
    // it. A linkified path is an element whose text is EXACTLY the path; the
    // bash command header echoes the path inside the full command string (not
    // an exact-text node), so an exact-text match isolates a result link.
    await expect(
      page.getByText(SCREENSHOT_INLINE.path, { exact: true }),
    ).toHaveCount(0);
  });
});
