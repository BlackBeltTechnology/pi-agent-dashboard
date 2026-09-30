import { AxeBuilder } from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "./fixtures.js";
import {
  buttonBoxes,
  buttonsWithoutFocusIndicator,
  colorDistance,
  contrastFailures,
  measureText,
  ownBackground,
  resolveColor,
  setThemeMode,
  sizeFailures,
} from "./helpers/computed-contrast.js";
import { ensureGitSession, FIXTURE_GIT, gotoDashboard, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";
import { openIdleGrid } from "./helpers/flow-card-grid.js";
import { unpinViaBus } from "./helpers/folder-collapse.js";
import { BOARD_FIXTURE, openBoard } from "./helpers/openspec-board.js";

/**
 * L3 — live action surfaces follow the theme-token recipe
 * (change: align-ui-with-theme-tokens; test-plan F1–F9, F11, E10, X1).
 *
 * Ports `mockups/ux-probe.cjs` to the Docker harness: COMPUTED contrast (canvas-
 * resolved colours, ancestor backgrounds composited — axe passes text on
 * semi-transparent fills), text-size floors, 44/32 px targets, focus
 * indicators and axe, all scoped to the changed surfaces so unrelated
 * components cannot fail this change.
 *
 * Seeding: the goal and the automation are served by `page.route` fixtures
 * (a goal with 2 verdicts + 1 linked session; an automation whose file
 * trigger has no path), the select/confirm prompts by the faux model
 * (`[[faux:ask-select]]`, `[[faux:ask-confirm]]`) and the worktree
 * `branch_exists` error by a routed `/api/git/worktree` reply — nothing is
 * written to the shared container.
 */

const MODES = ["dark", "light"] as const;
const AA = 4.5;
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

/** base64url of the cwd — the goal/automation overlay routes' folder segment. */
function encodeFolder(cwd: string): string {
  return Buffer.from(cwd, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function axeViolations(page: Page, selector: string): Promise<string[]> {
  const r = await new AxeBuilder({ page }).include(selector).withTags(AXE_TAGS).analyze();
  return r.violations.map((v) => `${v.id}×${v.nodes.length}: ${v.nodes[0]?.target.join(" ")}`);
}

async function expectTint(page: Page, el: Locator, hue: string): Promise<void> {
  // Park the pointer off the control: a prior click leaves it hovering, and the
  // hover recipe mixes the bg toward the border. Wait out transition-colors.
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  const want = await resolveColor(page, `var(--tint-${hue}-bg)`);
  const got = await ownBackground(el);
  expect(colorDistance(got, want), `bg ${got} vs --tint-${hue}-bg ${want}`).toBeLessThanOrEqual(1);
}

async function readable(scope: Locator, floor = AA): Promise<void> {
  const ms = await measureText(scope);
  expect(ms.length, "measured no text — wrong scope?").toBeGreaterThan(0);
  expect(contrastFailures(ms, floor)).toEqual([]);
  expect(sizeFailures(ms)).toEqual([]);
}

async function folderBody(page: Page): Promise<Locator> {
  // ensureGitSession waits for the DESKTOP card, so pin at desktop width and
  // restore the caller's viewport afterwards.
  const vp = page.viewportSize();
  if (vp && vp.width < 768) await page.setViewportSize({ width: 1280, height: vp.height });
  await ensureGitSession(page);
  if (vp && vp.width < 768) {
    await page.setViewportSize(vp);
    // Mobile: the opened session pane covers the sidebar; go back to the list.
    await page.goto("/");
  }
  const body = page.getByTestId(`folder-body-${FIXTURE_GIT}`);
  await body.waitFor({ state: "visible", timeout: 30_000 });
  return body;
}

// ── F1 / F7 / F8 — new-session tray ───────────────────────────────────────
test.describe("new-session tray (F1)", () => {
  test.setTimeout(180_000);

  test("New Session / New Worktree: tint on its own bg, ≥ 4.5:1, focus ring, axe clean — dark + light", async ({ page }) => {
    await gotoDashboard(page);
    for (const mode of MODES) {
      await setThemeMode(page, mode);
      const body = await folderBody(page);
      const session = body.getByTestId("folder-spawn-session-btn");
      const worktree = body.getByTestId("folder-spawn-worktree-btn");
      await expect(session).toBeVisible();
      await expect(worktree).toBeVisible();

      await readable(session);
      await readable(worktree);
      await expectTint(page, session, "green");
      await expectTint(page, worktree, "orange");

      const tray = session.locator("xpath=..");
      expect(await buttonsWithoutFocusIndicator(page, tray), `${mode}: no focus indicator`).toEqual([]);
      expect(await axeViolations(page, `[data-testid="folder-body-${FIXTURE_GIT}"] [data-testid="folder-spawn-session-btn"]`), mode).toEqual([]);
    }
  });

  test("tray targets are ≥ 44×44 at 375 px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    const body = await folderBody(page);
    await body.getByTestId("folder-spawn-session-btn").waitFor({ state: "visible", timeout: 30_000 });
    const boxes = await buttonBoxes(body.getByTestId("folder-spawn-session-btn").locator("xpath=.."));
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.filter((b) => b.w < 44 || b.h < 44)).toEqual([]);
  });
});

// ── F2 / F9 — session card chips ──────────────────────────────────────────
test.describe("session card action chips (F2, F9)", () => {
  test.setTimeout(180_000);

  test("chips: tint bg, ≥ 4.5:1, ≥ 12 px, ≥ 32 px tall at 1280 — dark + light", async ({ page }) => {
    await gotoDashboard(page);
    for (const mode of MODES) {
      await setThemeMode(page, mode);
      const card = await ensureGitSession(page);
      const sibling = card.getByTestId("session-card-spawn-sibling");
      const wt = card.getByTestId("session-card-spawn-worktree");
      await expect(sibling).toBeVisible();

      await readable(sibling);
      await expectTint(page, sibling, "green");
      if (await wt.isVisible()) {
        await readable(wt);
        await expectTint(page, wt, "orange");
      }
      const fork = card.getByRole("button", { name: /^Fork$/ });
      if (await fork.isVisible()) {
        await readable(fork);
        await expectTint(page, fork, "blue");
      }

      const row = sibling.locator("xpath=..");
      const boxes = await buttonBoxes(row);
      expect(boxes.filter((b) => b.h < 32), `${mode}: chips under 32 px`).toEqual([]);
      expect(await buttonsWithoutFocusIndicator(page, row), `${mode}: no focus indicator`).toEqual([]);

      // The card's meta line (status word, timestamps) stays readable too.
      const meta = card.getByTestId("session-card-meta");
      if ((await measureText(meta)).length > 0) {
        expect(contrastFailures(await measureText(meta))).toEqual([]);
      }
    }
  });

  test("F9: at a 320 px sidebar the chip row wraps instead of clipping", async ({ page }) => {
    await gotoDashboard(page);
    await page.evaluate(() => localStorage.setItem("dashboard:sidebar-width", "320"));
    await page.reload();
    const card = await ensureGitSession(page);
    const sibling = card.getByTestId("session-card-spawn-sibling");
    await expect(sibling).toBeVisible();
    const overflow = await card.evaluate((el) => {
      const cardBox = el.getBoundingClientRect();
      const clipped = [...el.querySelectorAll("button")]
        .filter((b) => (b as HTMLElement).offsetParent !== null)
        .map((b) => b.getBoundingClientRect())
        .filter((r) => r.right > cardBox.right + 1 || r.left < cardBox.left - 1).length;
      // scrollWidth would count the selected-card glow layers (card-glow-mask /
      // card-glow-fx / card-ring-fx), which bleed past the edge by design;
      // measure content only. See change: fix-selected-card-light-wash.
      const overhang = Math.max(
        0,
        ...[...el.querySelectorAll("*")]
          .filter((c) => !c.closest("[class*='card-glow-mask'],[class*='card-glow-fx'],[class*='card-ring-fx']"))
          .map((c) => c.getBoundingClientRect())
          .filter((r) => r.width > 0)
          .map((r) => r.right - cardBox.right),
      );
      return { scroll: overhang, clipped };
    });
    expect(overflow.clipped, "buttons outside the card box").toBe(0);
    expect(overflow.scroll, "card content overhangs the card box").toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.evaluate(() => localStorage.removeItem("dashboard:sidebar-width"));
  });
});

// ── F3 / X1 / E10 — worktree dialog ───────────────────────────────────────
async function openWorktreeDialog(page: Page): Promise<Locator> {
  const body = await folderBody(page);
  await body.getByTestId("folder-spawn-worktree-btn").click();
  const dialog = page.getByTestId("worktree-spawn-dialog");
  await dialog.getByTestId("worktree-source-fork").waitFor({ state: "visible", timeout: 30_000 });
  return dialog;
}

test.describe("worktree dialog (F3, X1, E10)", () => {
  test.setTimeout(240_000);

  for (const width of [375, 1280]) {
    test(`headings, toggle, collision, Create — dark + light at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await gotoDashboard(page);
      for (const mode of MODES) {
        await setThemeMode(page, mode);
        const dialog = await openWorktreeDialog(page);

        // Headings: ≥ 12 px, ≥ 4.5:1.
        for (const id of ["worktree-dialog-existing", "worktree-dialog-create"]) {
          const h = dialog.getByTestId(id).locator("h4").first();
          await readable(h);
        }

        // Source toggle targets.
        const toggles = await buttonBoxes(dialog.getByTestId("worktree-source-toggle"));
        const min = width < 640 ? 44 : 32;
        expect(toggles.filter((b) => b.h < min || (width < 640 && b.w < 44)), `${mode}@${width}`).toEqual([]);

        // Fork mode, a fresh branch name → Create enabled: --accent-solid + white.
        await dialog.getByTestId("worktree-source-fork").click();
        await dialog.getByTestId("worktree-new-branch-input").fill("e2e/token-probe-branch");
        const create = dialog.getByTestId("worktree-dialog-create-submit");
        await expect(create).toBeEnabled();
        await readable(create);
        expect(colorDistance(await ownBackground(create), await resolveColor(page, "var(--accent-solid)"))).toBeLessThanOrEqual(1);

        // A colliding branch (the base branch, checked out at the repo root) → warning block.
        const baseBranch = ((await dialog.getByRole("combobox", { name: "Base branch" }).textContent()) ?? "").replace("▾", "").trim();
        expect(baseBranch, "base branch name").not.toBe("");
        await dialog.getByTestId("worktree-new-branch-input").fill(baseBranch);
        const collision = dialog.getByTestId("worktree-fork-collision");
        await expect(collision).toBeVisible();
        expect(colorDistance(await ownBackground(collision), await resolveColor(page, "var(--severity-warning-bg)"))).toBeLessThanOrEqual(1);
        await readable(collision);

        expect(await buttonsWithoutFocusIndicator(page, dialog), `${mode}@${width}: no focus indicator`).toEqual([]);
        if (width === 1280) {
          expect(await axeViolations(page, '[data-testid="worktree-spawn-dialog"]'), mode).toEqual([]);
        }
        await dialog.getByTestId("worktree-dialog-cancel").click();
        await expect(dialog).toBeHidden();
      }
    });
  }

  test("X1: branch_exists error text is --severity-error-fg, ≥ 12 px, ≥ 4.5:1 — dark + light", async ({ page }) => {
    await page.route("**/api/git/worktree", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ success: false, code: "branch_exists", error: "a branch named 'e2e/x1' already exists" }),
      });
    });
    await gotoDashboard(page);
    for (const mode of MODES) {
      await setThemeMode(page, mode);
      const dialog = await openWorktreeDialog(page);
      await dialog.getByTestId("worktree-source-fork").click();
      await dialog.getByTestId("worktree-new-branch-input").fill("e2e/x1-probe");
      await dialog.getByTestId("worktree-dialog-create-submit").click();
      const err = dialog.getByTestId("worktree-dialog-error");
      await expect(err).toContainText("branch_exists");
      const line = err.locator("div").first();
      const colour = await line.evaluate((e) => getComputedStyle(e).color);
      const want = await resolveColor(page, "var(--severity-error-fg)");
      const got = await page.evaluate((c) => {
        const cv = document.createElement("canvas").getContext("2d")!;
        cv.fillStyle = c;
        cv.fillRect(0, 0, 1, 1);
        return [...cv.getImageData(0, 0, 1, 1).data].slice(0, 3);
      }, colour);
      expect(colorDistance(got, want)).toBeLessThanOrEqual(1);
      await readable(line);
      await dialog.getByTestId("worktree-dialog-cancel").click();
    }
  });

  test("E10: headings, labels and help ≥ 3:1 in every named theme, ≥ 4.5:1 in default dark + light", async ({ page }) => {
    const THEMES = ["base", "dracula", "nord", "github", "catppuccin", "tokyo-night", "rose-pine", "solarized", "gruvbox"];
    await gotoDashboard(page);
    const failures: string[] = [];
    for (const theme of THEMES) {
      for (const mode of MODES) {
        await setThemeMode(page, mode, theme);
        const dialog = await openWorktreeDialog(page);
        await dialog.getByTestId("worktree-source-fork").click();
        const scope = dialog.getByTestId("worktree-dialog-create");
        const ms = (await measureText(scope)).filter((m) => !m.where.startsWith("button")); // text, not controls
        const floor = theme === "base" ? AA : 3;
        failures.push(...contrastFailures(ms, floor).map((f) => `${theme}/${mode}: ${f}`));
        await dialog.getByTestId("worktree-dialog-cancel").click();
      }
    }
    expect(failures).toEqual([]);
  });
});

// ── F4 — goal detail ───────────────────────────────────────────────────────
test.describe("goal detail controls (F4)", () => {
  test.setTimeout(180_000);

  test("controls ≥ 44×44 at 375, focus ring, delete red / new-session purple, ≥ 4.5:1 — dark + light", async ({ page }) => {
    const card = await ensureGitSession(page);
    const sessionId = (await card.getAttribute("data-session-id")) ?? "s-missing";
    const goal = {
      id: "g-e2e-tokens",
      cwd: FIXTURE_GIT,
      objective: "Ship the token-aligned surfaces",
      criteria: [{ text: "Probe passes in both themes", done: false }],
      status: "pursuing",
      budget: { maxTurns: 10, maxSpendUsd: 5 },
      verdicts: [
        { turn: 1, at: Date.now() - 60_000, verdict: "continue", note: "tray fixed" },
        { turn: 2, at: Date.now() - 30_000, verdict: "paused", note: "waiting on review" },
      ],
      sessionIds: [sessionId],
      driverSessionId: sessionId,
      totalSpendUsd: 0.4,
      createdAt: Date.now() - 120_000,
      updatedAt: Date.now(),
    };
    await page.route("**/api/folders/goals?**", async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ success: true, data: [goal] }) });
    });
    await page.setViewportSize({ width: 375, height: 900 });

    for (const mode of MODES) {
      await page.goto(`/folder/${encodeFolder(FIXTURE_GIT)}/goals/${goal.id}`);
      await setThemeMode(page, mode);
      const detail = page.getByTestId("goal-detail-page");
      await expect(detail.getByTestId("goal-loop-controls")).toBeVisible({ timeout: 30_000 });

      const small = (await buttonBoxes(detail)).filter((b) => b.w < 44 || b.h < 44);
      expect(small, `${mode}: goal controls under 44×44`).toEqual([]);
      expect(await buttonsWithoutFocusIndicator(page, detail.getByTestId("goal-loop-controls")), mode).toEqual([]);

      await expectTint(page, detail.getByTestId("goal-detail-delete"), "red");
      await expectTint(page, detail.getByTestId("goal-new-session"), "purple");
      await expect(detail.getByTestId("goal-verdict-row")).toHaveCount(2);

      const ms = await measureText(detail);
      expect(contrastFailures(ms), mode).toEqual([]);
      expect(sizeFailures(ms), mode).toEqual([]);
      expect(await axeViolations(page, '[data-testid="goal-detail-page"]'), mode).toEqual([]);
    }
  });
});

// ── F5 — select / confirm prompt ──────────────────────────────────────────
test.describe("select / confirm prompt (F5)", () => {
  test.setTimeout(240_000);

  test("select options ≥ 44 px tall at 375, ≥ 12 px, ≥ 4.5:1 — dark + light", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await sendPrompt(page, "[[faux:ask-select]] go");
    const alpha = page.getByRole("button", { name: /alpha/i }).first();
    await expect(alpha).toBeVisible({ timeout: 30_000 });
    const selectCard = alpha.locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");

    for (const mode of MODES) {
      await setThemeMode(page, mode);
      await page.setViewportSize({ width: 375, height: 900 });
      await expect(alpha).toBeVisible({ timeout: 30_000 });
      const boxes = await buttonBoxes(selectCard);
      expect(boxes.length).toBeGreaterThanOrEqual(2);
      expect(boxes.filter((b) => b.h < 44), `${mode}: options under 44 px`).toEqual([]);
      await readable(selectCard);
      await page.setViewportSize({ width: 1280, height: 900 });
    }

    await alpha.click();
  });

  // Separate test (own page + session): the faux select turn does not go idle,
  // and a second session in the same page makes the composer lookup ambiguous.
  test("confirm buttons ≥ 44×44 at 375, ≥ 12 px, ≥ 4.5:1 — dark + light", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await sendPrompt(page, "[[faux:ask-confirm]] go");
    const yes = page.getByRole("button", { name: /^Yes$/ }).first();
    await expect(yes).toBeVisible({ timeout: 30_000 });
    const confirmCard = yes.locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
    for (const mode of MODES) {
      await setThemeMode(page, mode);
      await page.setViewportSize({ width: 375, height: 900 });
      await expect(yes).toBeVisible({ timeout: 30_000 });
      const boxes = await buttonBoxes(confirmCard);
      expect(boxes.length).toBeGreaterThanOrEqual(3);
      expect(boxes.filter((b) => b.h < 44 || b.w < 44), `${mode}: confirm buttons under 44×44`).toEqual([]);
      await readable(confirmCard);
      await page.setViewportSize({ width: 1280, height: 900 });
    }
    await page.getByRole("button", { name: /^No$/ }).first().click();
  });
});

// ── F6 / X1 — automation dialog ───────────────────────────────────────────
test.describe("automation dialog help + error (F6, X1)", () => {
  test.setTimeout(180_000);

  test("help ≥ 12 px --text-secondary, error --severity-error-fg, armed badge --tint-green-* — dark + light", async ({ page }) => {
    const name = "e2e-inbox-watch";
    const config = {
      on: { kind: "file", events: ["created"] },
      action: { kind: "prompt", prompt: "./prompt.md" },
      model: "@fast",
      mode: "local",
      sandbox: "workspace-write",
      concurrency: "skip",
    };
    await page.route("**/api/plugins/automation/list**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ automations: [{ name, scope: "folder", dir: `${FIXTURE_GIT}/.pi/automation/${name}`, valid: true, config }] }),
      }),
    );
    await page.route("**/api/plugins/automation/definition**", (route) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify({ config, promptBody: "Summarise the new file." }) }),
    );
    // The File trigger ships as "planned" (disabled); advertise it enabled so the
    // editor renders its path field, help and missing-path error.
    await page.route("**/api/plugins/automation/trigger-kinds**", async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as { categories?: Array<{ category: string; status: string; events?: Array<{ status?: string }> }> };
      for (const c of body.categories ?? []) {
        if (c.category !== "file") continue;
        c.status = "enabled";
        for (const e of c.events ?? []) if (e.status) e.status = "enabled";
      }
      await route.fulfill({ response: res, json: body });
    });
    await page.route("**/api/plugins/automation/runs**", (route) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify({ runs: [] }) }),
    );
    await ensureGitSession(page);

    for (const mode of MODES) {
      await page.goto(`/folder/${encodeFolder(FIXTURE_GIT)}/automations`);
      await setThemeMode(page, mode);
      await page.getByTestId(`overflow-${name}`).click({ timeout: 30_000 });
      await page.getByTestId(`edit-${name}`).click();
      const subtitle = page.getByTestId("editor-subtitle");
      await expect(subtitle).toBeVisible();
      const dialog = subtitle.locator("xpath=ancestor::div[contains(@class,'max-w-lg')][1]");

      for (const id of ["editor-subtitle", "create-name-locked", "create-file-path-help"]) {
        await readable(page.getByTestId(id));
      }
      const missing = page.getByTestId("file-path-missing");
      await expect(missing).toBeVisible();
      await readable(missing);
      const err = await missing.evaluate((e) => getComputedStyle(e).color);
      const errWant = await resolveColor(page, "var(--severity-error-fg)");
      expect(colorDistance(await resolveColor(page, err), errWant), `${mode}: missing-path colour`).toBeLessThanOrEqual(1);

      // A path arms the automation → the enabled badge is the green identity tint.
      await page.getByTestId("create-file-path").fill("/spool/inbox");
      const chip = page.getByTestId("armed-chip");
      await expect(chip).toBeVisible();
      await expectTint(page, chip, "green");
      await readable(chip);

      // Scheduled → next-run help.
      await page.getByTestId("trigger-cat-scheduled").click();
      await readable(page.getByTestId("create-next-run"));

      expect(await buttonsWithoutFocusIndicator(page, dialog), `${mode}: no focus indicator`).toEqual([]);
      await page.keyboard.press("Escape");
    }
  });
});

// ── F11 — secondary surfaces ──────────────────────────────────────────────
test.describe("secondary surfaces (F11)", () => {
  test.setTimeout(180_000);
  // openBoard pins the board fixture; leave the shared harness as found, or its
  // "Set up" banner leaks into page-global banner assertions in later specs.
  test.afterAll(async () => {
    await unpinViaBus(BOARD_FIXTURE);
  });

  for (const width of [375, 1280]) {
    test(`dashboard tray + OpenSpec new-proposal controls at ${width} — dark + light`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await gotoDashboard(page);
      for (const mode of MODES) {
        await setThemeMode(page, mode);
        const addFolder = page.getByTestId("dashboard-add-folder-btn").first();
        await expect(addFolder).toBeVisible({ timeout: 30_000 });
        await readable(addFolder);
        await expectTint(page, addFolder, "blue");
        const box = (await addFolder.boundingBox())!;
        expect(box.height, `${mode}@${width}`).toBeGreaterThanOrEqual(width < 640 ? 44 : 32);
      }
    });
  }

  test("OpenSpec board: card New session / New worktree + new-proposal dialog — dark + light", async ({ page }) => {
    await gotoDashboard(page);
    for (const mode of MODES) {
      await setThemeMode(page, mode);
      await openBoard(page, 1);
      const newSession = page.locator('[data-testid^="card-new-session-"]').first();
      const newWorktree = page.locator('[data-testid^="card-new-worktree-"]').first();
      await expect(newSession).toBeVisible();
      await readable(newSession);
      await expectTint(page, newSession, "green");
      await expectTint(page, newWorktree, "orange");
      expect((await newSession.boundingBox())!.height, mode).toBeGreaterThanOrEqual(32);

      await page.getByTestId("board-new-proposal").click();
      const dialog = page.getByTestId("new-proposal-dialog");
      await expect(dialog).toBeVisible();
      await dialog.getByTestId("np-name").fill("e2e-token-probe");
      const create = dialog.getByTestId("np-create");
      await readable(create);
      expect(colorDistance(await ownBackground(create), await resolveColor(page, "var(--accent-solid)"))).toBeLessThanOrEqual(1);
      await readable(dialog.locator("p").first());
      expect(await buttonsWithoutFocusIndicator(page, dialog), mode).toEqual([]);
      await dialog.getByTestId("np-cancel").click();
    }
  });

  test("Manage Worktrees list inherits the WorktreeList restyle — dark + light", async ({ page }) => {
    await ensureGitSession(page);
    for (const mode of MODES) {
      await setThemeMode(page, mode);
      await page.locator(`[data-testid="folder-actions-menu-${FIXTURE_GIT}"]`).first().click();
      await page.locator(`[data-testid="folder-actions-menu-panel-${FIXTURE_GIT}"] [data-testid="folder-menu-item-manage-worktrees"]`).first().click();
      const dialog = page.locator('[data-testid="manage-worktrees-dialog"]');
      await expect(dialog.locator('[data-testid="worktree-row-main"]')).toHaveCount(1, { timeout: 20_000 });
      const list = dialog.locator('[data-testid="worktree-list-manage"]');
      const ms = await measureText(list);
      expect(contrastFailures(ms), mode).toEqual([]);
      expect(sizeFailures(ms), mode).toEqual([]);
      expect((await buttonBoxes(list)).filter((b) => b.h < 32), mode).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }
  });
});

// ── Flow card control-row targets (consolidate-flow-agent-cards, #E16) ───────
// WCAG 2.2 SC 2.5.8: the handler and agent-source file controls present a
// ≥24×24 hit target with the icon glyph size unchanged; the Details button is
// ≥24px tall. Scoped to a code card carrying BOTH file targets.
test.describe("flow card control targets (#E16)", () => {
  test("file controls and Details clear the 24px floor with the glyph unchanged", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const { panel } = await openIdleGrid(page);

    // `load-ticket` is a code step with a routed handler; it also carries the
    // agent doc? No — a code card's doc button renders only with `sourcePath`,
    // so `fill-form` (agent) supplies the doc control; assert both kinds.
    const code = panel.locator("[data-step='load-ticket']");
    await expect(code).toBeVisible();

    const handler = code.getByTitle("Open handler in editor");
    await expect(handler).toBeVisible();
    const hb = await handler.boundingBox();
    expect(hb!.width, "handler control width").toBeGreaterThanOrEqual(24);
    expect(hb!.height, "handler control height").toBeGreaterThanOrEqual(24);

    // Glyph unchanged: the mdi icon renders at 0.45 * 24 = 10.8px.
    const glyph = await handler.locator("svg").boundingBox();
    expect(glyph!.width).toBeGreaterThanOrEqual(10);
    expect(glyph!.width).toBeLessThanOrEqual(12);

    // The Details button is ≥24px tall.
    const details = code.getByRole("button", { name: /details/i });
    const db = await details.boundingBox();
    expect(db!.height, "Details button height").toBeGreaterThanOrEqual(24);

    // Every button in the card's control row clears 24×24.
    const undersized = (await buttonBoxes(code)).filter((b) => b.w < 24 || b.h < 24);
    expect(undersized, "controls below 24×24").toEqual([]);
  });
});
