import { execFileSync } from "node:child_process";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { contrastRatio, elementColors, setThemeMode } from "./helpers/computed-contrast.js";
import { harnessContainer } from "./helpers/folder-collapse.js";
import { expandFolder, FIXTURE_GIT, gotoDashboard, pinDirectory, setSearch } from "./helpers/index.js";
import { BASE_URL } from "./lifecycle.js";

/**
 * Desktop session-card header zone: rows 2–4 share the session name's text
 * column, the git / title / meta rows stay inside a 260 px card, and the dirty
 * pill meets AA contrast on a card and on a folder header.
 *
 * Sessions are SYNTHETIC: registered over the gateway from inside the harness
 * container (loopback, so they are local), then decorated with `git_info_update`,
 * `cwd_missing`, `usage_recorded` and `session_moved`. A real spawned pi cannot
 * be put into "60-character branch + open PR + 12 dirty files" on demand.
 *
 * F4 limitation (recorded per test-plan "New infra needed"): the seeded chips
 * are Moved (+ long model, context bar, cost). The origin-device chip needs a
 * paired remote bridge and the driver chip needs a configured ACP agent; both
 * are covered at L1 (`SessionCard.header.test.tsx` E12) and only the Moved chip
 * is exercised for geometry here.
 *
 * Covers test-plan #F1–#F4, #X3.
 * See change: compact-session-card-header.
 */

const TOL = 1;
const LONG_BRANCH = `os/${"very-long-branch-segment-".repeat(3)}end`.slice(0, 60);
const LONG_NAME = "a deliberately long session name that cannot possibly fit in a narrow card".padEnd(70, "x");

interface Seed {
  id: string;
  name: string;
  /** Worktree session of FIXTURE_GIT (groups under the main folder; gets a git row without `showGitInfo`). */
  worktree?: boolean;
  branch?: string;
  pr?: { number: number; state: "open"; checks: "passing" };
  gitStatus?: { dirtyCount: number; ahead: number; behind: number };
  model?: string;
  cost?: number;
  cwdMissing?: boolean;
  moved?: boolean;
}

async function gatewayPort(): Promise<number> {
  const health = (await (await fetch(`${BASE_URL}/api/health`)).json()) as { piGatewayPort?: number | string | null };
  if (typeof health.piGatewayPort !== "number") throw new Error(`harness gateway is not on a TCP port (${JSON.stringify(health.piGatewayPort)})`);
  return health.piGatewayPort;
}

/** Register + decorate one synthetic session from INSIDE the container (loopback = local origin). */
async function seed(s: Seed): Promise<void> {
  const cwd = s.worktree ? `${FIXTURE_GIT}/.worktrees/${s.id}` : FIXTURE_GIT;
  const msgs: Array<Record<string, unknown>> = [
    {
      type: "session_register",
      sessionId: s.id,
      name: s.name,
      cwd,
      source: "tui",
      pid: 700000 + Math.floor(Math.random() * 90000),
      ...(s.model ? { model: s.model, thinkingLevel: "high" } : {}),
    },
  ];
  if (s.branch) {
    msgs.push({
      type: "git_info_update",
      sessionId: s.id,
      gitBranch: s.branch,
      ...(s.pr ? { gitPrNumber: s.pr.number, gitPrState: s.pr.state, gitPrChecks: s.pr.checks, gitPrDraft: false } : {}),
      ...(s.worktree ? { gitWorktree: { mainPath: FIXTURE_GIT, name: s.id, base: "develop" } } : {}),
      ...(s.gitStatus ? { gitStatus: { ...s.gitStatus, staged: 0, unstaged: s.gitStatus.dirtyCount, untracked: 0 } } : {}),
    });
  }
  if (s.cost) {
    msgs.push({
      type: "usage_recorded",
      sessionId: s.id,
      kind: "usage:e2e",
      usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: { total: s.cost } },
    });
  }
  if (s.cwdMissing) msgs.push({ type: "cwd_missing", sessionId: s.id });
  if (s.moved) msgs.push({ type: "session_moved", instanceId: "e2e-other-instance" });
  const port = await gatewayPort();
  const script = [
    `const msgs=${JSON.stringify(msgs)};`,
    `const ws=new WebSocket("ws://127.0.0.1:${port}");`,
    `ws.addEventListener("open",async()=>{`,
    `for(const m of msgs){ws.send(JSON.stringify(m));await new Promise(r=>setTimeout(r,400));}`,
    `setTimeout(()=>{ws.close();process.exit(0);},800);});`,
    `ws.addEventListener("error",e=>{console.error("ERR",String(e));process.exit(1);});`,
  ].join("");
  execFileSync("docker", ["exec", harnessContainer(), "node", "-e", script], { encoding: "utf8", timeout: 60_000 });
}

const cardOf = (page: Page, id: string): Locator => page.locator(`[data-testid="session-card-desktop"][data-session-id="${id}"]`);

/** Dashboard on the fixture folder, the seeded session's card revealed (search also expands the ended tier). */
async function reveal(page: Page, id: string, name: string): Promise<Locator> {
  await gotoDashboard(page);
  const home = page.getByTestId(`folder-home-row-${FIXTURE_GIT}`).first();
  if (!(await home.isVisible().catch(() => false))) await pinDirectory(page, FIXTURE_GIT);
  await home.waitFor({ state: "visible", timeout: 30_000 });
  if ((await page.getByTestId(`folder-body-${FIXTURE_GIT}`).count()) === 0) await expandFolder(page, FIXTURE_GIT);
  await setSearch(page, "sessions", name);
  const card = cardOf(page, id);
  await expect(card).toBeVisible({ timeout: 30_000 });
  return card;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
const box = (loc: Locator): Promise<Box> =>
  loc.evaluate((e) => {
    const r = e.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  });

/** The card's content box: its border box minus padding. */
const contentBox = (card: Locator): Promise<Box> =>
  card.evaluate((e) => {
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return {
      left: r.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth),
      top: r.top,
      right: r.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth),
      bottom: r.bottom,
    };
  });

const inside = (inner: Box, outer: Box): boolean => inner.left >= outer.left - TOL && inner.right <= outer.right + TOL;

/** Make the card ~`target` px wide by writing the sidebar width, then correcting by the measured delta. */
async function sizeCard(page: Page, id: string, name: string, target: number): Promise<Locator> {
  let width = target + 60;
  // localStorage is unreadable on about:blank — land on the dashboard origin first.
  await gotoDashboard(page);
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.evaluate((w) => localStorage.setItem("dashboard:sidebar-width", String(w)), width);
    await page.reload();
    const card = await reveal(page, id, name);
    const actual = (await box(card)).right - (await box(card)).left;
    if (Math.abs(actual - target) <= 2) return card;
    width = Math.max(180, Math.round(width - (actual - target)));
  }
  const card = cardOf(page, id);
  const actual = (await box(card)).right - (await box(card)).left;
  throw new Error(`could not size card to ${target}px (got ${actual}px at sidebar width ${width}); sidebar min is 180px`);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

test.afterEach(async ({ page }) => {
  await page.evaluate(() => localStorage.removeItem("dashboard:sidebar-width")).catch(() => undefined);
});

test.describe("desktop card header — geometry and contrast", () => {
  test.setTimeout(180_000);

  // F1 — rows 2–4 start at the name's left edge.
  test("F1: status, git and meta rows share the session name's left edge", async ({ page }) => {
    const id = `e2e-hdr-f1-${Date.now().toString(36)}`;
    await seed({
      id,
      name: id,
      worktree: true,
      branch: "os/feat-x",
      pr: { number: 812, state: "open", checks: "passing" },
      model: "anthropic/claude-opus-4-1",
      cost: 1.84,
    });
    const card = await reveal(page, id, id);
    const name = card.getByTestId("session-card-title-row").locator("span.font-semibold").first();
    const nameLeft = (await box(name)).left;
    for (const row of ["status", "git", "meta"] as const) {
      const loc = card.getByTestId(`session-card-${row}-row`);
      await expect(loc, `${row} row rendered`).toBeVisible();
      expect(Math.abs((await box(loc)).left - nameLeft), `${row} row left vs name`).toBeLessThanOrEqual(TOL);
    }
  });

  // F2 — narrow git row: branch truncates, pills stay inside.
  test("F2: 260 px card — branch ellipsized (≥ 6ch), pills inside the content box", async ({ page }) => {
    const id = `e2e-hdr-f2-${Date.now().toString(36)}`;
    await seed({
      id,
      name: id,
      worktree: true,
      branch: LONG_BRANCH,
      pr: { number: 812, state: "open", checks: "passing" },
      gitStatus: { dirtyCount: 12, ahead: 4, behind: 1 },
    });
    await page.route("**/api/git/status**", (route) =>
      route.fulfill({
        json: { success: true, data: { dirtyCount: 12, staged: 0, unstaged: 12, untracked: 0, ahead: 4, behind: 1 } },
      }),
    );
    const card = await sizeCard(page, id, id, 260);
    const content = await contentBox(card);
    const gitRow = card.getByTestId("session-card-git-row");
    const branch = gitRow.locator(`[title="${LONG_BRANCH}"]`);
    await expect(branch).toBeVisible();
    const branchTruncated = await branch.evaluate((e) => e.scrollWidth > e.clientWidth);
    expect(branchTruncated, "branch ellipsized").toBe(true);
    const sixCh = await branch.evaluate((e) => parseFloat(getComputedStyle(e).fontSize) * 0.5 * 6);
    expect((await box(branch)).right - (await box(branch)).left, "branch ≥ 6ch").toBeGreaterThanOrEqual(sixCh);
    for (const id2 of ["worktree-pill", "worktree-pr-segment", "git-dirty-pill"]) {
      expect(inside(await box(gitRow.getByTestId(id2)), content), `${id2} inside content box`).toBe(true);
    }
    expect(inside(await box(branch), content), "branch inside content box").toBe(true);
  });

  // F3 — narrow title row: name shrinks, missing-folder pill stays.
  test("F3: 260 px card — long name ellipsized, folder-missing pill fully inside", async ({ page }) => {
    const id = `e2e-hdr-f3-${Date.now().toString(36)}`;
    await seed({ id, name: LONG_NAME, cwdMissing: true });
    const card = await sizeCard(page, id, LONG_NAME.slice(0, 20), 260);
    const content = await contentBox(card);
    const name = card.getByTestId("session-card-title-row").locator("span.font-semibold").first();
    expect(await name.evaluate((e) => e.scrollWidth > e.clientWidth), "name ellipsized").toBe(true);
    const pill = card.getByTestId("cwd-gone-pill");
    await expect(pill).toBeVisible();
    expect(inside(await box(pill), content), "pill inside content box").toBe(true);
  });

  // F4 — narrow meta row with chips + context bar + cost (Moved chip only at L3; see header note).
  test("F4: 260 px card — every meta-row element inside the content box", async ({ page }) => {
    const id = `e2e-hdr-f4-${Date.now().toString(36)}`;
    await seed({
      id,
      name: id,
      model: "anthropic/claude-opus-4-1-with-a-very-long-model-identifier-2026",
      cost: 4.1,
      moved: true,
    });
    const card = await sizeCard(page, id, id, 260);
    const content = await contentBox(card);
    const meta = card.getByTestId("session-card-meta-row");
    await expect(meta).toBeVisible();
    await expect(meta.locator(`[data-testid^="session-moved-badge-"]`)).toBeVisible();
    // The context bar (preference on in the standard display preset) and the cost are measured too.
    const bar = meta.getByTestId("context-usage-bar");
    const cost = meta.getByText("$4.10");
    await expect(bar, "context bar rendered").toBeVisible();
    await expect(cost, "cost rendered").toBeVisible();
    expect(inside(await box(bar), content), "context bar inside content box").toBe(true);
    expect(inside(await box(cost), content), "cost inside content box").toBe(true);
    const kids = await meta.locator(":scope > *").all();
    expect(kids.length).toBeGreaterThanOrEqual(2);
    for (const [i, kid] of kids.entries()) expect(inside(await box(kid), content), `meta child ${i}`).toBe(true);
  });

  // X3 — the dirty pill clears AA on a card and on a folder header, light + dark.
  test("X3: dirty pill text ≥ 4.5:1 on a card and a folder header, base light and base dark", async ({ page }) => {
    const stamp = Date.now().toString(36);
    const ids = [`e2e-hdr-x3a-${stamp}`, `e2e-hdr-x3b-${stamp}`];
    for (const id of ids) {
      await seed({ id, name: id, worktree: true, branch: `os/${id}`, gitStatus: { dirtyCount: 5, ahead: 2, behind: 1 } });
    }
    await page.route("**/api/git/status**", (route) =>
      route.fulfill({ json: { success: true, data: { dirtyCount: 5, staged: 0, unstaged: 5, untracked: 0, ahead: 2, behind: 1 } } }),
    );
    for (const mode of ["light", "dark"] as const) {
      await gotoDashboard(page);
      await setThemeMode(page, mode, "base");
      // `reveal` pins/expands the fixture folder and un-collapses the seeded session's card.
      const home = page.getByTestId(`folder-home-row-${FIXTURE_GIT}`).first();
      await home.waitFor({ state: "visible", timeout: 30_000 });
      if ((await page.getByTestId(`folder-body-${FIXTURE_GIT}`).count()) === 0) await expandFolder(page, FIXTURE_GIT);
      const cardPill = cardOf(page, ids[0]).getByTestId("git-dirty-pill");
      // The folder header's pill: any dirty pill that is not inside a session card.
      const headerPill = page.locator('[data-testid="git-dirty-pill"]:not([data-testid="session-card-desktop"] *)').first();
      for (const [where, pill] of [
        ["card", cardPill],
        ["folder header", headerPill],
      ] as const) {
        await expect(pill, `${where} pill visible (${mode})`).toBeVisible({ timeout: 30_000 });
        for (const part of ["git-dirty-count", "git-ahead", "git-behind"]) {
          // `elementColors` composites the ancestor background stack, so the pill's own
          // (semi-transparent) fill is part of the background each chip is measured against.
          const { fg, bg } = await elementColors(pill.getByTestId(part));
          const ratio = contrastRatio(fg, bg);
          expect(ratio, `${where} ${part} ${mode}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});

// F3 (session-header): the SESSION header (content pane), not the card header.
// Covers test-plan #F3. See change: reorganize-session-header.
test.describe("desktop session header — one 48 px row", () => {
  test.setTimeout(180_000);

  test("F3: row height 48–56 px and every control label is at least 12 px", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    const id = `e2e-hdr-f3-${Date.now().toString(36)}`;
    await seed({ id, name: id, model: "anthropic/claude-opus-4-1" });
    const card = await reveal(page, id, id);
    await card.click();

    const row = page.getByTestId("session-header-row");
    await expect(row).toBeVisible({ timeout: 30_000 });
    const h = (await row.boundingBox())!.height;
    expect(h, "header row height").toBeGreaterThanOrEqual(48);
    expect(h, "header row height").toBeLessThanOrEqual(56);

    const targets = [
      page.getByTestId("session-title-menu"),
      page.getByTestId("layout-mode-closed"),
      page.getByTitle("View options").first(),
    ];
    // Changed Files only exists once the session has file changes.
    const changed = page.getByTestId("changed-files-chip");
    if (await changed.isVisible().catch(() => false)) targets.push(changed);
    for (const t of targets) {
      await expect(t).toBeVisible();
      const px = await t.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
      expect(px, "font-size px").toBeGreaterThanOrEqual(12);
    }
  });
});
