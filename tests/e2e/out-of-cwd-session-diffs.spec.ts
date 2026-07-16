import { expect, test } from "@playwright/test";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

/**
 * Browser E2E for change `opt-in-out-of-cwd-session-diffs`.
 *
 * A session that writes a file OUTSIDE its workspace (`/tmp/e2e-out-of-cwd/…`,
 * via the `tool-write-out-of-cwd` faux fixture) surfaces through the per-turn
 * change-summary block (the filesystem rail excludes out-of-cwd paths by
 * construction). This spec drives that block:
 *   F1 — pref OFF (default): the out-of-cwd row is NOT listed.
 *   F2 — pref ON: the row lists, and opening it renders a `diff:` tab from the
 *        captured Write payload (never reading the /tmp file).
 *   F5 — that diff viewer hides the "File" content-view toggle (previewable:
 *        false → the /api/session-file 403 path is unreachable).
 *   F3 — a >4 KB out-of-cwd Write lazy-fetches full fidelity (no persistent
 *        "content truncated" banner).
 *
 * F4 (absolute key does not corrupt the changed-file tree) is covered at the
 * unit level in packages/client/src/lib/__tests__/diff-tree.test.ts — the tree
 * grouping renders in the FileDiffView takeover, not this in-stream surface.
 *
 * The diff derives from the tool EVENT payload, not the file on disk, so these
 * assertions hold whether or not pi materialized the /tmp file.
 */

/** Open the per-session "View options" popover and set a display toggle. */
async function setViewPref(page: import("@playwright/test").Page, label: RegExp, on: boolean) {
  await page.getByTitle("View options").first().click();
  const popover = page.getByTestId("chat-view-popover");
  await expect(popover).toBeVisible({ timeout: 10_000 });
  const box = popover.getByRole("checkbox", { name: label });
  // Controlled checkbox: its `checked` is driven by an async pref round-trip, so
  // `setChecked`'s post-click verification races. Click once when state differs.
  if ((await box.isChecked()) !== on) await box.click();
  await page.getByTitle("View options").first().click();
  await expect(popover).toBeHidden({ timeout: 10_000 });
}

test.describe("out-of-cwd session diffs", () => {
  test("pref gates the out-of-cwd row; opening it renders the payload diff; File toggle hidden", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await setViewPref(page, /Per-turn change summary/, true);
    await setViewPref(page, /Show out-of-workspace diffs/, false);

    await sendPrompt(page, "[[faux:tool-write-out-of-cwd]] write the mockup");

    // The write event lands: the Changed Files chip appears (fed by
    // /api/session-diff, which carries the out-of-cwd entry regardless of pref).
    // Used as the turn-landed signal because the in-stream block correctly
    // renders NOTHING when its only file is a suppressed out-of-cwd entry.
    await expect(page.getByTestId("changed-files-chip")).toBeVisible({ timeout: 30_000 });

    // F1 — pref OFF: the out-of-cwd file is NOT listed in the change block
    // (the block is absent or empty).
    await expect(
      page.getByTestId("change-summary-block").filter({ hasText: "index.html" }),
    ).toHaveCount(0);

    // F2 — pref ON: the row appears and opens a payload-rendered diff tab.
    await setViewPref(page, /Show out-of-workspace diffs/, true);
    const row = page.getByTestId("change-summary-block").getByText(/index\.html/).first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();

    await expect(page.getByRole("tab").filter({ hasText: "diff" }).first()).toBeVisible({
      timeout: 10_000,
    });
    // Renders from change.content, not the empty "No changes" state.
    await expect(page.getByText("out of cwd mockup").first()).toBeVisible({ timeout: 10_000 });

    // F5 — the out-of-cwd diff hides the "File" content-view toggle.
    await expect(page.getByTestId("file-view-toggle")).toHaveCount(0);
  });

  test("F3 — a large out-of-cwd Write carries the full payload with no cap; the session-addressed endpoint serves it", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:tool-write-out-of-cwd-large]] write the big mockup");

    // Locate the session whose /api/session-diff carries the large out-of-cwd
    // Write. Asserts F3 at the API boundary (the in-stream row surface diverges
    // for large client events; F1/F2 cover it for the common case):
    //   - the out-of-cwd entry is carried payload-only (previewable:false),
    //   - its content is the FULL >4 KB payload (no size cap), and
    //   - the session-addressed endpoint (sessionId, toolCallId) serves the
    //     full untruncated payload with no filesystem path input.
    type Entry = { previewable?: boolean; changes: Array<{ content?: string; toolCallId?: string }> };
    const locate = async (): Promise<{ sessionId: string; entry: Entry } | null> => {
      const list = await (await page.request.get("/api/sessions")).json();
      for (const s of list.data ?? []) {
        const sd = await (await page.request.get(`/api/session-diff?sessionId=${s.id}`)).json();
        const entry = (sd.data?.files ?? []).find((f: { path: string }) =>
          f.path.endsWith("/tmp/e2e-out-of-cwd/big.html"),
        );
        if (entry) return { sessionId: s.id, entry };
      }
      return null;
    };

    let found: { sessionId: string; entry: Entry } | null = null;
    for (let i = 0; i < 30 && !found; i++) {
      found = await locate();
      if (!found) await page.waitForTimeout(1000);
    }
    expect(found).not.toBeNull();
    const { sessionId, entry } = found!;
    // Payload-only carry, no fs/git enrichment surface.
    expect(entry.previewable).toBe(false);
    // Full content, no size cap (>4 KB).
    const change = entry.changes[0];
    expect((change.content ?? "").length).toBeGreaterThan(4096);

    // The session-addressed endpoint serves the full untruncated payload.
    const sc = await (
      await page.request.get(`/api/session-change/${sessionId}/${change.toolCallId}`)
    ).json();
    expect(sc.success).toBe(true);
    expect((sc.data.content ?? "").length).toBeGreaterThan(4096);
    expect(sc.data.content).toContain("big out of cwd");
  });
});
