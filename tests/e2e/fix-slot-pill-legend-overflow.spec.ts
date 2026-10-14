import type { BusClient } from "@blackbelt-technology/pi-dashboard-bus-client";
import type { Locator, Page } from "@playwright/test";
import { kbPillStates, showing, statsAre } from "./fixtures/retro-ux/kb-pill.js";
import { connectBus, expect, shutdownSession, test } from "./fixtures.js";
import { contrastRatio, elementColors, overflowFailures, setThemeMode } from "./helpers/computed-contrast.js";
import { inContainer } from "./helpers/folder-collapse.js";
import { expandFolder, FIXTURE_GIT, gotoDashboard, pinDirectory } from "./helpers/index.js";
import { type CaptureResult, captureStates, RETRO_UX_THEMES, RETRO_UX_WIDTHS } from "./helpers/ui-capture.js";
import { BASE_URL } from "./lifecycle.js";

/**
 * Capsule legends at 11 px + the KB pill's stale marker staying INSIDE the pill,
 * in the sidebar folder card and in the desktop worktree session card.
 *
 * Sidebar rows run at 375/768/1440; the card rows run at 768/1440 only — below
 * 768 px `useMobile` renders the mobile card, which has no KB slot.
 *
 * `RETRO_UX_CAPTURE=1` writes after-screenshots into this change's
 * `mockups/after/`; a plain run writes nothing.
 *
 * Covers test-plan #F1–#F5, #X1, #X2.
 * See change: fix-slot-pill-legend-and-stale-overflow.
 */

const CHANGE = "fix-slot-pill-legend-and-stale-overflow";
const THEMES = RETRO_UX_THEMES;
const CARD_WIDTHS = [768, 1440] as const;
const LEGEND = "[data-slot-pill-legend]";
const TOL = 0.5;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Unclipped, transform-inclusive border box (a clipped element's `boundingBox()` waits for visibility). */
function box(loc: Locator): Promise<Box> {
  return loc.evaluate((e) => {
    const r = e.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  });
}

const inside = (inner: Box, outer: Box): boolean =>
  inner.left >= outer.left - TOL && inner.right <= outer.right + TOL && inner.top >= outer.top - TOL && inner.bottom <= outer.bottom + TOL;

const cell = (r: CaptureResult) => `${r.state} ${r.theme}-${r.mode} ${r.width}px`;
const failures = (results: CaptureResult[]): string[] =>
  results.flatMap((r) => [
    ...r.contrast.map((f) => `${cell(r)} contrast: ${f}`),
    ...r.size.map((f) => `${cell(r)} size: ${f}`),
    ...r.focus.map((f) => `${cell(r)} focus: ${f}`),
    ...r.overflow.map((f) => `${cell(r)} overflow: ${f}`),
  ]);

/** Re-install the stats stub (drops the previous one), then bring the folder card's KB pill up in `state`. */
async function sidebarPill(page: Page, over: Record<string, unknown>, state: string): Promise<Locator> {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await statsAre(over)(page);
  await page.goto("/");
  await showing(state)(page);
  return page.getByTestId("folder-kb-open-settings").first();
}

test.describe("slot-pill legend + stale marker — sidebar folder card", () => {
  // F1 — every KB pill state passes contrast / size / focus / overflow probes.
  test("F1: every state × theme × width passes the probes, overflow included", async ({ page }) => {
    test.setTimeout(kbPillStates.length * THEMES.length * RETRO_UX_WIDTHS.length * 12_000);
    await gotoDashboard(page);
    const results = await captureStates(page, { change: CHANGE, surface: "kb-pill", states: kbPillStates });
    expect(results).toHaveLength(kbPillStates.length * THEMES.length * RETRO_UX_WIDTHS.length);
    for (const r of results) expect(r.measured, `${cell(r)} measured text nodes`).toBeGreaterThan(0);
    expect(failures(results)).toEqual([]);
  });

  // F2 — the stale marker + the unabbreviated number stay inside the pill.
  test("F2: stale marker stays inside the pill; 19,397 is untruncated; count is legible", async ({ page }) => {
    test.setTimeout(THEMES.length * RETRO_UX_WIDTHS.length * 20_000);
    await gotoDashboard(page);
    for (const tm of THEMES) {
      for (const width of RETRO_UX_WIDTHS) {
        const at = `${tm.theme}-${tm.mode} ${width}px`;
        await page.setViewportSize({ width, height: 900 });
        const root = await sidebarPill(page, { staleCount: 3 }, "stale");
        await setThemeMode(page, tm.mode, tm.theme);
        await showing("stale")(page);

        const marker = root.getByTestId("folder-kb-stale");
        // Poll: the pill can still be settling right after the theme reload.
        await expect.poll(async () => inside(await box(marker), await box(root)), { message: `${at} marker inside pill` }).toBe(true);

        const chunks = root.getByTestId("folder-kb-chunks");
        expect(await chunks.textContent(), at).toBe((19397).toLocaleString("en-US"));
        await expect.poll(() => chunks.evaluate((e) => e.scrollWidth <= e.clientWidth), { message: `${at} number not truncated` }).toBe(true);

        const { fg, bg } = await elementColors(marker.locator('span[aria-hidden="true"]'));
        expect(contrastRatio(fg, bg), `${at} stale count contrast`).toBeGreaterThanOrEqual(4.5);
        await expect(root, at).toHaveAccessibleName(/3 stale/);
      }
    }
  });

  // F3 — the 11 px legend (overhang -top-2) clears the content row at 1 and 2 columns.
  test("F3: legend clears the glyph chip and the count line at 1 and 2 columns", async ({ page }) => {
    await gotoDashboard(page);
    for (const [width, columns] of [
      [375, 1],
      [768, 2],
      [1440, 2],
    ] as const) {
      await page.setViewportSize({ width, height: 900 });
      const root = await sidebarPill(page, {}, "populated");
      const cols = await root.evaluate((e) => {
        for (let n: HTMLElement | null = e.parentElement; n; n = n.parentElement) {
          const cs = getComputedStyle(n);
          if (cs.display === "grid") return cs.gridTemplateColumns.split(" ").length;
        }
        return 0;
      });
      expect(cols, `${width}px grid columns`).toBe(columns);
      const legend = await box(root.locator(LEGEND));
      const chip = await box(root.locator("span.w-\\[26px\\]"));
      const count = await box(root.getByTestId("folder-kb-count"));
      expect(legend.bottom, `${width}px legend ≤ glyph chip`).toBeLessThanOrEqual(chip.top + TOL);
      expect(legend.bottom, `${width}px legend ≤ count line`).toBeLessThanOrEqual(count.top + TOL);
    }
  });

  // X1 — a long failure message never leaves the pill; it lives only in the title.
  test("X1: error state keeps 'index failed' inside the pill; long message only in the title", async ({ page }) => {
    const message = "walk failed: ".concat("x".repeat(287));
    await gotoDashboard(page);
    await page.setViewportSize({ width: 375, height: 900 });
    const root = await sidebarPill(page, { jobStatus: "error", lastError: message }, "error");
    await setThemeMode(page, "dark", "base");
    await showing("error")(page);
    const failed = root.getByText("index failed");
    expect(inside(await box(failed), await box(root))).toBe(true);
    expect(await overflowFailures(root, LEGEND)).toEqual([]);
    expect(await root.getAttribute("title")).toContain(message);
    expect(await root.innerText()).not.toContain("xxxxxxxx");
  });
});

// ---------------------------------------------------------------------------
// Card placement — a real git worktree + a real spawned session (setup as
// folder-collapse-worktree.spec.ts). `/api/kb/stats` is stubbed for every cwd.
// ---------------------------------------------------------------------------

interface SessionRow {
  id: string;
  cwd: string;
  gitWorktree?: { mainPath: string; name: string };
}

async function apiGet<T>(path: string): Promise<T> {
  return (await (await fetch(`${BASE_URL}${path}`)).json()) as T;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

const BRANCH = `e2e-legend-${Date.now().toString(36)}`;

/** The fixture's default branch, read off the `isMain` entry — never assumed. */
async function baseBranch(): Promise<string> {
  const wts = await apiGet<{ data?: { worktrees?: Array<{ isMain?: boolean; branch?: string | null }> } }>(
    `/api/git/worktrees?cwd=${encodeURIComponent(FIXTURE_GIT)}`,
  );
  const base = (wts.data?.worktrees ?? []).find((w) => w.isMain)?.branch;
  if (!base) throw new Error(`no base branch: ${JSON.stringify(wts)}`);
  return base;
}

async function awaitWorktreeSessionId(cwd: string): Promise<string> {
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    const rows = (await apiGet<{ data?: SessionRow[] }>("/api/sessions")).data ?? [];
    const row = rows.find((s) => s.cwd === cwd && s.gitWorktree?.mainPath === FIXTURE_GIT);
    if (row) return row.id;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error("worktree session never reported gitWorktree.mainPath");
}

let worktreePath = "";
let sessionId = "";
let setupError = "";

/** Setup failure is a FAILURE with the recorded cause — never a silent skip or a timeout (X2). */
function requireSetup(): void {
  if (setupError) throw new Error(`worktree session setup failed: ${setupError}`);
}

test.describe("slot-pill legend + stale marker — desktop worktree session card", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(240_000);

  // Spawned in beforeAll ON PURPOSE: a session created inside a test body is in
  // that test's reap delta and would be shut down before the next test runs.
  test.beforeAll(async () => {
    try {
      const created = await apiPost<{ success?: boolean; data?: { path?: string } }>("/api/git/worktree", {
        cwd: FIXTURE_GIT,
        base: await baseBranch(),
        newBranch: BRANCH,
      });
      worktreePath = created.data?.path ?? "";
      if (!created.success || !worktreePath) throw new Error(`worktree create: ${JSON.stringify(created)}`);
      const spawned = await apiPost<{ success?: boolean; error?: string }>("/api/session/spawn", { cwd: worktreePath });
      if (spawned.success === false) throw new Error(`session spawn: ${JSON.stringify(spawned)}`);
      sessionId = await awaitWorktreeSessionId(worktreePath);
    } catch (err) {
      setupError = String(err);
    }
  });

  test.afterAll(async () => {
    let client: BusClient | undefined;
    try {
      client = await connectBus();
      if (sessionId) await shutdownSession(client, sessionId);
    } catch {
      /* best effort */
    } finally {
      client?.close();
    }
    try {
      inContainer(
        [
          worktreePath ? `git -C ${FIXTURE_GIT} worktree remove --force '${worktreePath}' 2>/dev/null || rm -rf '${worktreePath}'` : "true",
          `git -C ${FIXTURE_GIT} branch -D '${BRANCH}' 2>/dev/null || true`,
          `git -C ${FIXTURE_GIT} worktree prune || true`,
        ].join("; "),
      );
    } catch {
      /* best effort */
    }
  });

  /** Dashboard with the worktree session's card laid out under the main folder, in `tm`. */
  async function sessionCard(page: Page, over: Record<string, unknown>, state: string, tm: (typeof THEMES)[number]): Promise<Locator> {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await statsAre(over)(page);
    await gotoDashboard(page);
    await setThemeMode(page, tm.mode, tm.theme);
    const home = page.getByTestId(`folder-home-row-${FIXTURE_GIT}`).first();
    if (!(await home.isVisible().catch(() => false))) await pinDirectory(page, FIXTURE_GIT);
    await home.waitFor({ state: "visible", timeout: 30_000 });
    // The card renders under the MAIN folder (a worktree never gets its own card). Address it by
    // session id — `folderCard` needs a sortable wrapper not every layout renders; expand only if collapsed.
    const card = page.locator(`[data-session-id="${sessionId}"]`);
    if ((await page.getByTestId(`folder-body-${FIXTURE_GIT}`).count()) === 0) await expandFolder(page, FIXTURE_GIT);
    await expect(card).toHaveCount(1, { timeout: 30_000 });
    await card.locator(`[data-testid="folder-kb-section"][data-state="${state}"]`).waitFor({ state: "visible", timeout: 20_000 });
    return card;
  }

  // X2 — the card rows depend on the worktree session; a setup failure must fail loudly.
  test("X2: worktree session setup succeeded (else every card row fails with this cause)", () => {
    requireSetup();
    expect(sessionId).not.toBe("");
  });

  // F4 — populated → stale in the card: marker + number stay inside the pill, reindex control stays outside.
  test("F4: card pill stays inside its root in populated and stale, in every theme", async ({ page }) => {
    requireSetup();
    test.setTimeout(CARD_WIDTHS.length * THEMES.length * 2 * 40_000);
    for (const width of CARD_WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      for (const tm of THEMES) {
        for (const [state, over] of [
          ["populated", {}],
          ["stale", { staleCount: 3 }],
        ] as const) {
          const at = `${state} ${tm.theme}-${tm.mode} ${width}px`;
          const card = await sessionCard(page, over, state, tm);
          const root = card.getByTestId("folder-kb-open-settings");
          expect(await overflowFailures(root, LEGEND), `${at} overflow`).toEqual([]);
          expect(await root.getByTestId("folder-kb-chunks").textContent(), at).toBe((19397).toLocaleString("en-US"));
          expect(await root.getByTestId("folder-kb-chunks").evaluate((e) => e.scrollWidth <= e.clientWidth), `${at} number`).toBe(true);
          const rootBox = await box(root);
          if (state === "stale") {
            await expect.poll(async () => inside(await box(root.getByTestId("folder-kb-stale")), await box(root)), { message: `${at} marker inside pill` }).toBe(true);
          }
          const control = await box(card.getByTestId("folder-kb-card-reindex"));
          const disjoint =
            control.right <= rootBox.left + TOL || control.left >= rootBox.right - TOL || control.bottom <= rootBox.top + TOL || control.top >= rootBox.bottom - TOL;
          expect(disjoint, `${at} reindex control outside the pill`).toBe(true);
        }
      }
    }
  });

  // F5 — stacked capsule legends never reach into the element above or down into their own content.
  test("F5: every legend clears the element above and its own panel content", async ({ page }) => {
    requireSetup();
    test.setTimeout(CARD_WIDTHS.length * 60_000);
    for (const width of CARD_WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      const card = await sessionCard(page, {}, "populated", THEMES[0]);
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one self-contained in-page geometry read.
      const rows = await card.evaluate((cardEl) => {
        const out: Array<{ title: string; aboveGap: number | null; contentGap: number | null }> = [];
        // Legends: SlotPill / mirror carry `data-slot-pill-legend`; SessionSubcard's is the `-top-2` capsule.
        const legends = [...cardEl.querySelectorAll("span")].filter(
          (s) => s.hasAttribute("data-slot-pill-legend") || (s.className.includes("-top-2") && s.className.includes("rounded-full")),
        );
        for (const legend of legends) {
          const panel = legend.parentElement as HTMLElement;
          const lr = legend.getBoundingClientRect();
          // Element above: previous sibling of the panel, else of the nearest ancestor that has one.
          let n: Element | null = panel;
          while (n && n !== cardEl && !n.previousElementSibling) n = n.parentElement;
          const above = n && n !== cardEl ? n.previousElementSibling : null;
          const content = [...panel.children].find((c) => c !== legend && c.getBoundingClientRect().height > 0);
          out.push({
            title: (legend.textContent ?? "").trim(),
            aboveGap: above ? lr.top - above.getBoundingClientRect().bottom : null,
            contentGap: content ? content.getBoundingClientRect().top - lr.bottom : null,
          });
        }
        return out;
      });
      expect(rows.length, `${width}px legends found`).toBeGreaterThanOrEqual(2);
      for (const r of rows) {
        if (r.aboveGap !== null) expect(r.aboveGap, `${width}px ${r.title} legend vs element above`).toBeGreaterThanOrEqual(-TOL);
        if (r.contentGap !== null) expect(r.contentGap, `${width}px ${r.title} legend vs own content`).toBeGreaterThanOrEqual(-TOL);
      }
    }
  });
});
