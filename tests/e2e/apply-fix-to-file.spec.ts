import { expect, type Page, test } from "./fixtures.js";
import { FIXTURE_GIT, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

// Browser E2E — "Apply fix to file": a rule-repaired mermaid diagram persists its
// fix into the exact block of the on-disk file after a confirmed diff.
//
// Surfaces: FilePreviewOverlay (markdown, fence inside a list item), editor-pane
// `.mmd` viewer, AsciiDoc preview (real asciidoctor, plantuml block untouched),
// and a real mtime race (server 409).
// Fixtures (docker/fixtures/sample-git/apply-fix*.{md,mmd,adoc}) are committed
// READ-ONLY for other specs: every test restores its file in afterEach.
// Exemplars: mermaid-repair.spec.ts, file-preview-survives-churn.spec.ts.
// See change: add-preview-apply-fix-to-file (test-plan F11–F13, X7).

const MD = "apply-fix.md";
const MMD = "apply-fix.mmd";
const MMD_RACE = "apply-fix-race.mmd";
const ADOC = "apply-fix.adoc";
const ALL = [MD, MMD, MMD_RACE, ADOC];

const readUrl = (rel: string) => `/api/file/md-read?cwd=${encodeURIComponent(FIXTURE_GIT)}&path=${encodeURIComponent(rel)}`;

async function readFile(page: Page, rel: string): Promise<{ content: string; mtime: number }> {
  const res = await page.request.get(readUrl(rel));
  expect(res.ok(), `md-read ${rel}`).toBeTruthy();
  return (await res.json()).data;
}

async function writeFile(page: Page, rel: string, content: string, mtime: number) {
  return page.request.post("/api/file/write", { data: { cwd: FIXTURE_GIT, path: rel, content, mtime } });
}

test.describe("apply fix to file", () => {
  // The pristine fixture bytes, captured before each test and restored after it.
  const originals = new Map<string, string>();
  let sessionId: string | null = null;
  const openEditor = (page: Page, file: string) => page.goto(`/session/${sessionId}/editor?file=${file}`);

  test.beforeEach(async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    sessionId = await card.getAttribute("data-session-id");
    await card.click();
    originals.clear();
    for (const rel of ALL) originals.set(rel, (await readFile(page, rel)).content);
  });

  test.afterEach(async ({ page }) => {
    for (const [rel, content] of originals) {
      const cur = await readFile(page, rel);
      if (cur.content !== content) await writeFile(page, rel, content, cur.mtime);
    }
  });

  const applyButton = (page: Page) => page.getByTestId("mermaid-apply-fix-button").first();

  test("F11: markdown overlay — fence inside a list item changes only inside the block", async ({ page }) => {
    await sendPrompt(page, "[[faux:text-realfile-applyfix]] go");
    await page.getByText(`${FIXTURE_GIT}/${MD}`, { exact: true }).first().click();
    const overlay = page.getByTestId("file-preview-overlay");
    await expect(overlay.getByTestId("mermaid-repair-badge")).toBeVisible({ timeout: 30_000 });

    await applyButton(page).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("mermaid-apply-confirm").click();

    // Preview converges: re-rendered from the valid source, no badge.
    await expect(overlay.getByTestId("mermaid-repair-badge")).toHaveCount(0, { timeout: 30_000 });
    await expect(overlay.locator(".mermaid-diagram svg").first()).toBeVisible();

    const before = originals.get(MD)!.split("\n");
    const after = (await readFile(page, MD)).content.split("\n");
    const open = before.findIndex((l) => l.trim().startsWith("```mermaid"));
    const close = before.findIndex((l, i) => i > open && l.trim() === "```");
    expect(after.length).toBe(before.length);
    expect(after.slice(0, open + 1)).toEqual(before.slice(0, open + 1));
    expect(after.slice(close)).toEqual(before.slice(close));
    const inner = after.slice(open + 1, close);
    expect(inner).not.toEqual(before.slice(open + 1, close));
    for (const line of inner) expect(line.startsWith("   ")).toBe(true); // list indentation kept
  });

  test("F12: .mmd tab — whole file replaced, final newline kept, no badge", async ({ page }) => {
    await openEditor(page, MMD);
    await expect(page.getByTestId("mermaid-repair-badge")).toBeVisible({ timeout: 30_000 });
    await applyButton(page).click();
    await page.getByRole("dialog").getByTestId("mermaid-apply-confirm").click();
    await expect(page.getByTestId("mermaid-repair-badge")).toHaveCount(0, { timeout: 30_000 });
    const after = (await readFile(page, MMD)).content;
    expect(after).not.toBe(originals.get(MMD));
    expect(after.endsWith("\n")).toBe(true);
    expect(after.startsWith("flowchart TD\n")).toBe(true);
  });

  test("F13: AsciiDoc preview — only the lines between the mermaid delimiters change", async ({ page }) => {
    await openEditor(page, ADOC);
    const body = page.locator(".asciidoc-body").first();
    await expect(body.getByTestId("mermaid-repair-badge")).toBeVisible({ timeout: 30_000 });
    await applyButton(page).click();
    await page.getByRole("dialog").getByTestId("mermaid-apply-confirm").click();
    await expect(body.getByTestId("mermaid-repair-badge")).toHaveCount(0, { timeout: 30_000 });

    const before = originals.get(ADOC)!.split("\n");
    const after = (await readFile(page, ADOC)).content.split("\n");
    const open = before.findIndex((l) => l === "----");
    const close = before.findIndex((l, i) => i > open && l === "----");
    expect(after.length).toBe(before.length);
    expect(after.slice(0, open + 1)).toEqual(before.slice(0, open + 1));
    expect(after.slice(close)).toEqual(before.slice(close)); // incl. the plantuml block
    expect(after.slice(open + 1, close)).not.toEqual(before.slice(open + 1, close));
  });

  test("X7: real mtime race — server 409 shows 'file changed — reload', disk keeps the external edit", async ({ page }) => {
    await openEditor(page, MMD_RACE);
    await expect(page.getByTestId("mermaid-repair-badge")).toBeVisible({ timeout: 30_000 });
    await applyButton(page).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // An external writer wins the race after the diff dialog opened.
    const cur = await readFile(page, MMD_RACE);
    const external = "flowchart TD\n  X-->Y\n";
    const ext = await writeFile(page, MMD_RACE, external, cur.mtime);
    expect(ext.ok()).toBeTruthy();

    await dialog.getByTestId("mermaid-apply-confirm").click();
    await expect(page.getByText(/file changed — reload/i)).toBeVisible({ timeout: 15_000 });
    expect((await readFile(page, MMD_RACE)).content).toBe(external);
  });
});
