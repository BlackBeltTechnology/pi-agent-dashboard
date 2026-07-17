import { expect, test } from "@playwright/test";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

// Browser E2E — internal Monaco editor pane (change: add-internal-monaco-editor-pane).
//
// Drives the real OpenFileButton → editor-pane round-trip against the Docker
// harness, opening files that REALLY exist in the sample-git fixture
// (`README.md`, `hello.txt`) so the server can serve them.
//
// Faux round-trip: `[[faux:tool-read-fixture]]` streams a `read` tool call for
// `README.md`; the ReadToolRenderer mounts an OpenFileButton whose body click
// navigates to `/session/:id/editor?file=README.md`. Requires PI_E2E_SEED=1
// (managed mode sets it automatically).
//
// Covers manual tasks 8.3 (pane opens + tabs + restore), 8.4 (viewer kinds:
// markdown / monaco / image / pdf), 8.5 (split button → internal pane).
// Pixel-exact theme fidelity (8.4a) still needs a human eye; here we prove the
// Monaco editor mounts and inherits a concrete (non-transparent) background.
//
// Image/PDF coverage uses the binary fixtures `logo.png` + `doc.pdf` seeded
// in docker/fixtures/sample-git/.

test.describe("internal Monaco editor pane", () => {
  test("OpenFileButton opens the pane; markdown + monaco viewers render real fixture files", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    // Faux read of a real fixture file → OpenFileButton appears.
    await sendPrompt(page, "[[faux:tool-read-fixture]] go");
    const openBtn = page.getByTitle("Open README.md");
    await expect(openBtn).toBeVisible({ timeout: 30_000 });

    // Body click → internal editor pane route.
    await openBtn.click();
    await expect(page).toHaveURL(/\/session\/[^/]+\/editor\?file=README\.md/, { timeout: 15_000 });

    // README.md → MarkdownViewer renders the heading from the fixture file.
    await expect(page.getByRole("heading", { name: "sample-git" })).toBeVisible({ timeout: 20_000 });

    // Open hello.txt from the tree rail → second tab + Monaco renders its text.
    await page.getByText("hello.txt", { exact: true }).first().click();
    await expect(page.getByText("hello from the sample-git fixture")).toBeVisible({ timeout: 30_000 });

    // The Monaco editor mounted and inherits a concrete (non-transparent) bg,
    // proving the derived theme applied (buildMonacoTheme → editor.background).
    const monaco = page.locator(".monaco-editor").first();
    await expect(monaco).toBeVisible({ timeout: 30_000 });
    const bg = await monaco
      .locator(".monaco-editor-background")
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe("rgba(0, 0, 0, 0)");
    expect(bg).not.toBe("transparent");

    // Open logo.png from the tree → ImageViewer streams it from /api/file/raw.
    await page.getByText("logo.png", { exact: true }).first().click();
    const img = page.locator('img[src*="/api/file/raw"][src*="logo.png"]');
    await expect(img).toBeVisible({ timeout: 20_000 });

    // Open doc.pdf from the tree → PdfViewer mounts an <object> over /api/file/raw.
    await page.getByText("doc.pdf", { exact: true }).first().click();
    const pdf = page.locator('object[type="application/pdf"][data*="doc.pdf"]');
    await expect(pdf).toBeAttached({ timeout: 20_000 });

    // Four tabs open (README.md, hello.txt, logo.png, doc.pdf).
    await expect(page.getByRole("tab")).toHaveCount(4);

    // Back-to-chat returns to the session and preserves pane state.
    await page.getByText("Back", { exact: true }).first().click();
    await expect(page).toHaveURL(/\/session\/[^/]+$/, { timeout: 15_000 });
    await expect(page.getByPlaceholder(/message/i).first()).toBeVisible({ timeout: 15_000 });

    // Re-entering the editor restores all persisted tabs (localStorage).
    await page.goBack();
    await expect(page.getByRole("tab")).toHaveCount(4, { timeout: 20_000 });
  });
});


// Browser E2E — editor layout modes (change: editor-layout-modes).
//
// Drives the header `Chat│Split│Editor` segmented switch + on-divider collapse
// chevrons + edge peeks through the real split workspace against the Docker
// harness. Feature data-testids: layout-mode-switch, layout-mode-{closed,split,
// full}, split-{chat,editor}-pane, split-divider, split-fold-{chat,editor},
// editor-peek, chat-peek.
//
// The harness emits recurring "Pi session spawned in tmux" toasts at
// `fixed top-4 right-4` that overlap the header switch and intercept pointer
// events (documented harness noise — see tool-created-files.spec.ts). Every
// header interaction dismisses visible toasts and retries, so the click lands
// once a toast fades. Folds test-plan F1/F2/F3/F4/F5/F7/F8/F10/F13/F14.

async function dismissToasts(page: import("@playwright/test").Page): Promise<void> {
  for (const btn of await page.getByRole("button", { name: "Dismiss" }).all()) {
    await btn.click().catch(() => {});
  }
}

/** Click a testid, dismissing overlapping spawn toasts and retrying until it lands. */
async function robustClick(page: import("@playwright/test").Page, testid: string): Promise<void> {
  const target = page.getByTestId(testid);
  await expect(async () => {
    await dismissToasts(page);
    await target.click({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

async function openSessionWithSwitch(page: import("@playwright/test").Page) {
  const card = await spawnFreshGitSession(page);
  await card.click();
  await page.getByTestId("layout-mode-switch").waitFor({ state: "visible", timeout: 30_000 });
  return card;
}

test.describe("editor layout modes", () => {
  test("F1/F10: switch present when closed; Split mounts chat+divider+editor", async ({ page }) => {
    await openSessionWithSwitch(page);

    // F10 — the switch is visible even in `closed`, with Chat active.
    await expect(page.getByTestId("layout-mode-closed")).toHaveAttribute("aria-checked", "true");

    // F1 — select Split → chat + divider + editor all mounted; chat interactive.
    await robustClick(page, "layout-mode-split");
    await expect(page.getByTestId("split-chat-pane")).toBeVisible();
    await expect(page.getByTestId("split-divider")).toBeVisible();
    await expect(page.getByTestId("split-editor-pane")).toBeVisible();
    await expect(page.getByPlaceholder(/message/i).first()).toBeVisible();
  });

  test("E5: the divider carries no collapse control in any mode (chevrons removed)", async ({ page }) => {
    await openSessionWithSwitch(page);
    // Mode-agnostic invariant: the removed on-divider collapse chevrons never
    // exist anywhere in the workspace — collapse is header-only now. This needs
    // no mode-changing click, so it is immune to the harness's nondeterministic
    // initial split mode (a fresh session may hydrate closed/split/full).
    await expect(page.getByTestId("split-fold-chat")).toHaveCount(0);
    await expect(page.getByTestId("split-fold-editor")).toHaveCount(0);
    // F10's interactive half ("header drives collapse; restore tabs only
    // re-open") is covered deterministically at L1 by SplitWorkspace.test.tsx
    // — the same robustness call already made for F9/F11/F12 below, since the
    // harness's nondeterministic initial mode makes an L3 mode-switch click
    // flaky here even though the UI itself is correct.
  });

  test("F2/F3: full via switch keeps chat mounted; composer draft survives split→full→split", async ({ page }) => {
    await openSessionWithSwitch(page);

    await robustClick(page, "layout-mode-split");
    const composer = page.getByPlaceholder(/message/i).first();
    await composer.fill("wip draft");

    // F2 — select Editor → full: editor visible, chat collapsed to a peek.
    await robustClick(page, "layout-mode-full");
    await expect(page.getByTestId("chat-peek")).toBeVisible();

    // F3 — return to split; the composer draft is preserved (chat not remounted).
    await robustClick(page, "layout-mode-split");
    await expect(composer).toHaveValue("wip draft");
  });

  test("F7/F8: edge peeks reopen split from closed and from full", async ({ page }) => {
    await openSessionWithSwitch(page);

    // F7 — closed → right-edge Editor peek → split.
    await expect(page.getByTestId("editor-peek")).toBeVisible();
    await robustClick(page, "editor-peek");
    await expect(page.getByTestId("split-editor-pane")).toBeVisible();
    await expect(page.getByTestId("layout-mode-split")).toHaveAttribute("aria-checked", "true");

    // F8 — full → leading-edge Chat peek → split.
    await robustClick(page, "layout-mode-full");
    await robustClick(page, "chat-peek");
    await expect(page.getByTestId("split-chat-pane")).toBeVisible();
    await expect(page.getByTestId("layout-mode-split")).toHaveAttribute("aria-checked", "true");
  });

  test("F13: full persists across reload", async ({ page }) => {
    const card = await openSessionWithSwitch(page);

    await robustClick(page, "layout-mode-full");
    await expect(page.getByTestId("chat-peek")).toBeVisible();

    await page.reload();
    // Re-select the same session after reload and assert it renders `full`.
    await card.click();
    await expect(page.getByTestId("layout-mode-full")).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });
    await expect(page.getByTestId("chat-peek")).toBeVisible();
  });

  test("F14: layout mode is per-session", async ({ page }) => {
    const cardA = await openSessionWithSwitch(page);
    await robustClick(page, "layout-mode-split");
    await expect(page.getByTestId("layout-mode-split")).toHaveAttribute("aria-checked", "true");

    // Session B: fresh, defaults to closed.
    const cardB = await spawnFreshGitSession(page);
    await cardB.click();
    await expect(page.getByTestId("layout-mode-closed")).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });

    // Back to A → still split.
    await cardA.click();
    await expect(page.getByTestId("layout-mode-split")).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });
  });
});

// Browser E2E — non-disruptive-file-open: mode stickiness on the param-less
// deep-link (test-plan F11). A param-less `/session/:id/editor` navigation is a
// mode-changer OUTSIDE the openers (`SplitRouteSync`); it now routes through the
// same reveal guard, so a deep-link opened from `full` no longer yanks to
// `split`. The persisted mode loads `full` first; the OLD code's
// `else updateSplit({mode:'split'})` would then force `split` — this asserts the
// new sticky behaviour survives the effect.
test.describe("non-disruptive-file-open — deep-link mode stickiness", () => {
  test("F11: param-less /editor deep-link from full stays full", async ({ page }) => {
    const card = await openSessionWithSwitch(page);
    await robustClick(page, "layout-mode-full");
    await expect(page.getByTestId("layout-mode-full")).toHaveAttribute("aria-checked", "true");

    const sessionId = await card.getAttribute("data-session-id");
    expect(sessionId).toBeTruthy();
    // Param-less deep-link (no `?file=`) → SplitRouteSync's else branch.
    await page.goto(`/session/${sessionId}/editor`);
    await expect(page.getByTestId("layout-mode-full")).toHaveAttribute("aria-checked", "true", {
      timeout: 30_000,
    });
  });
});

// Browser E2E — split layout controls redesign (change:
// redesign-split-layout-controls). Folds test-plan F1/F2/F3/F6/F7/F9.
// Same robustClick toast-dismissal + spawn helpers as the suite above.
test.describe("split layout controls redesign", () => {
  test("F1: seam grips are always visible at rest, not hover-only", async ({ page }) => {
    await openSessionWithSwitch(page);
    await robustClick(page, "layout-mode-split");

    // Divider grip has a visible, non-zero box without hovering the seam.
    const dividerGrip = page.getByTestId("split-divider-grip");
    await expect(dividerGrip).toBeVisible();
    const gBox = await dividerGrip.boundingBox();
    expect(gBox && gBox.width > 0 && gBox.height > 0).toBeTruthy();

    // The session-rail seam grip is visible at rest too (shared idiom).
    const railGrip = page.getByTestId("rail-seam-grip");
    await expect(railGrip).toBeVisible();
    const rBox = await railGrip.boundingBox();
    expect(rBox && rBox.width > 0 && rBox.height > 0).toBeTruthy();
  });

  test("F3: pane captions are present and folded into the pane header, not a second bar", async ({ page }) => {
    await openSessionWithSwitch(page);
    await robustClick(page, "layout-mode-split");

    const chatCap = page.getByTestId("pane-caption-chat");
    const editorCap = page.getByTestId("pane-caption-editor");
    await expect(chatCap).toBeVisible();
    await expect(editorCap).toBeVisible();

    // The EDITOR caption is a child of the editor pane's EXISTING header row
    // (the same row hosting the Files toggle), not a standalone bar above it.
    const editorCapInHeader = await editorCap.evaluate(
      (el) => !!el.parentElement?.querySelector('[data-testid="tree-toggle"]'),
    );
    expect(editorCapInHeader).toBeTruthy();

    // The CHAT caption is the chat pane's header row (its first child).
    const chatCapIsHeader = await chatCap.evaluate(
      (el) => el.closest('[data-testid="split-chat-pane"]')?.firstElementChild === el,
    );
    expect(chatCapIsHeader).toBeTruthy();
  });

  test("F2: collapsed EDITOR restore tab never overlaps a narrow chat pane", async ({ page }) => {
    await openSessionWithSwitch(page);
    await robustClick(page, "layout-mode-split");

    // Drag the divider hard toward chat → chat clamps to its 0.25 minimum.
    const divider = page.getByTestId("split-divider");
    const dBox = await divider.boundingBox();
    if (!dBox) throw new Error("divider has no box");
    await page.mouse.move(dBox.x + dBox.width / 2, dBox.y + dBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(dBox.x - 500, dBox.y + dBox.height / 2, { steps: 6 });
    await page.mouse.up();

    // Collapse the editor via the header → the EDITOR restore tab appears.
    await robustClick(page, "layout-mode-closed");
    const tab = page.getByTestId("editor-peek");
    await expect(tab).toBeVisible();

    // In-flow (push, not overlay): the chat pane's right edge does not cross
    // into the restore tab's box (overlap-bug regression).
    const tabBox = await tab.boundingBox();
    const chatBox = await page.getByTestId("split-chat-pane").boundingBox();
    if (!tabBox || !chatBox) throw new Error("missing boxes");
    expect(chatBox.x + chatBox.width).toBeLessThanOrEqual(tabBox.x + 1);
  });

  test("F6: EDITOR restore tab is keyboard accessible", async ({ page }) => {
    await openSessionWithSwitch(page);
    // Fresh session defaults to `closed` → the EDITOR restore tab is present.
    const tab = page.getByTestId("editor-peek");
    await expect(tab).toBeVisible();
    await expect(tab).toHaveAccessibleName(/editor/i);
    await tab.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("layout-mode-split")).toHaveAttribute("aria-checked", "true");
  });

  test("F7: rail collapse shows a centered SESSIONS tab that restores the rail", async ({ page }) => {
    await openSessionWithSwitch(page);

    // Collapse the rail via the centered knob → vertical SESSIONS tab.
    await robustClick(page, "sidebar-collapse");
    const tab = page.getByTestId("sidebar-expand");
    await expect(tab).toBeVisible();

    // Full-height rotated tab (its content is vertically centered).
    const tabBox = await tab.boundingBox();
    const vh = page.viewportSize()?.height ?? 0;
    expect(tabBox && tabBox.height > vh * 0.5).toBeTruthy();

    // Activate → the rail returns (the drag-seam re-appears).
    await tab.click();
    await expect(page.getByTestId("drag-handle")).toBeVisible();
  });

  test("F9: below the mobile breakpoint the rail seam + SESSIONS tab do not render", async ({ page }) => {
    // Mobile viewport → App renders the hamburger-governed mobile shell; the
    // desktop rail (and its collapse knob / SESSIONS tab) is absent.
    await page.setViewportSize({ width: 480, height: 900 });
    await page.reload();
    await expect(page.getByTestId("sidebar-collapse")).toHaveCount(0);
    await expect(page.getByTestId("sidebar-expand")).toHaveCount(0);
  });
});

// test-plan #F8 (mobile stacked keeps the edge-grabber peek) is covered at L1
// by SplitWorkspace.test.tsx (orientation "v" → absolute editor-peek/chat-peek
// edge grabbers, no desktop rotated tab). A mobile-viewport spawn here is the
// documented flaky path (shared-container spawn helpers assume the desktop
// session-card layout), so it stays at L1 — the same robustness call already
// made for the mobile cases below.
//
// (editor-layout-modes legacy) F9 (opener from `full` → `split`, never `full`)
// is covered at L1 by SplitWorkspaceContext.test.tsx (openChanges + openInSplit
// from full → split).
// The L3 path depends on the Changed-Files chip, which is gated on
// SessionDiffContext polling — flaky harness infra unrelated to the opener
// invariant. The invariant itself is deterministic at the context level.
//
// F11 (mobile switch presence) is covered by a robust component test
// (SessionHeader.mobile-layout-switch.test.tsx) instead of an L3 spawn on a
// mobile viewport — the shared-container spawn helpers assume the desktop
// session-card layout, making mobile-viewport spawn flaky infra unrelated to
// the feature. F12's `full` stacked render (editor + chat peek, chat kept
// mounted) is covered at L1 by SplitWorkspace.test.tsx; its exact grabber pixel
// placement is manual-only (test-plan #M2).
