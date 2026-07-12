import { test, expect } from "@playwright/test";
import { spawnFreshGitSession, sendPrompt } from "./helpers/index.js";

// Faux round-trip — copy buttons resolve payloads at CLICK time.
//
// The `copy-surfaces` faux scenario (qa/fixtures/faux-scenarios.ts) streams an
// assistant message with a GFM table + a fenced code block. MarkdownContent is
// React.memo, so a completed message renders ONCE — the exact condition that
// froze the old eager `text={copyMarkdown()}` read at `""`. This spec drives the
// real pipeline → bridge → /ws → ChatView → MarkdownContent and reads the REAL
// clipboard (grantPermissions) to prove every copy button lands non-empty
// content on a single render. Automates manual task 5.1.
// See change: fix-table-copy-empty-clipboard.

const readClipboard = (page: import("@playwright/test").Page) =>
  page.evaluate(() => navigator.clipboard.readText());

test.describe("faux round-trip — copy buttons resolve at click time", () => {
  test("table md/TSV, code-block, and message plain-text copy real content", async ({
    page,
    context,
  }) => {
    // Chromium/Chrome permit programmatic clipboard read once granted; the
    // harness serves on localhost (a secure context) so navigator.clipboard is
    // live. workers:1 means no cross-test clipboard races.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:copy-surfaces]] go");

    // Wait for the WHOLE message to finish streaming, not just the first table
    // row. The code block streams LAST and its "Copy code" button only mounts
    // once the fence is complete (isFencedBlockComplete) — so its visibility
    // proves the table before it has fully streamed (avoids a partial-table
    // read mid-stream).
    await expect(page.getByTitle("Copy code")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("table").first()).toBeVisible();

    // ── Table copy buttons ──────────────────────────────────────────────
    // The message footer ALSO has a "Copy as Markdown"; scope to the table's
    // button group via its unique "Copy as TSV" sibling.
    const tsvBtn = page.getByTitle("Copy as TSV");
    await expect(tsvBtn).toBeVisible();
    const tableGroup = tsvBtn.locator("xpath=..");
    const tableMdBtn = tableGroup.getByTitle("Copy as Markdown");

    await tableMdBtn.click();
    await expect
      .poll(() => readClipboard(page), { timeout: 5_000 })
      .toContain("| Name | Age |");
    let md = await readClipboard(page);
    expect(md).toContain("| Alice | 30 |");
    expect(md).toContain("| Bob | 25 |");
    expect(md).not.toBe("");

    await tsvBtn.click();
    await expect.poll(() => readClipboard(page), { timeout: 5_000 }).toContain("Alice\t30");
    const tsv = await readClipboard(page);
    expect(tsv).toContain("Name\tAge");
    expect(tsv).toContain("Bob\t25");

    // ── Code-block copy ─────────────────────────────────────────────────
    await page.getByTitle("Copy code").first().click();
    await expect
      .poll(() => readClipboard(page), { timeout: 5_000 })
      .toContain("const x = 1");

    // ── Message "Copy as plain text" ────────────────────────────────────
    // Pre-fix this degraded to the raw markdown (contentRef null at render →
    // `?? content` fallback). Post-fix it reads rendered innerText at click
    // time: contains the cell text but NOT the markdown separator row.
    // The USER prompt bubble ALSO has a plain-text button (first); the assistant
    // message is last in the transcript, so scope with `.last()`.
    await page.getByTitle("Copy as plain text").last().click();
    await expect.poll(() => readClipboard(page), { timeout: 5_000 }).toContain("Alice");
    const plain = await readClipboard(page);
    expect(plain).toContain("Bob");
    expect(plain).not.toContain("| --- |");
  });
});
