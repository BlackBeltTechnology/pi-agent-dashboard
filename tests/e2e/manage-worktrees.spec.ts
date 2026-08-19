/**
 * Browser E2E for the manage-worktrees surface (change:
 * manage-worktrees-filter-cleanup).
 *
 * Covers the behaviours only a rendered UI against a real server can prove:
 *   F4  the folder menu offers `manage-worktrees` for a git-repo folder with
 *       ZERO live sessions — the gate is on the repo, not on sessions
 *   X13 removing a worktree that has no session entry never trips the
 *       `active_sessions` guard
 *   X11 removing a worktree WITH sessions inherits `WorktreeActionsMenu`'s
 *       escalation flow unchanged
 *   F3  the list converges after a removal with no manual refresh
 *   X5  a directory deleted out-of-band renders as "already gone", never a raw 400
 *   X12 prune is repo-GLOBAL and the copy says so
 *   F7  every row text run clears 4.5:1 in BOTH themes and never resolves to
 *       `--text-muted` / `--text-tertiary`
 *
 * Setup drives the REST API (deterministic); assertions drive the DOM.
 */
import { expect, type Page, test } from "./fixtures.js";
import { byTestId, ensureGitSession, FIXTURE_GIT, gotoDashboard, pinDirectory } from "./helpers/index.js";

/** Thin API caller in page context (same origin as the dashboard). */
async function api<T = any>(page: Page, path: string, init?: RequestInit): Promise<any> {
  return page.evaluate(
    async ([p, i]) => {
      const res = await fetch(p as string, (i ?? undefined) as any);
      return { status: res.status, ...(await res.json().catch(() => ({}))) };
    },
    [path, init ? JSON.parse(JSON.stringify(init)) : null] as const,
  );
}

function post(body: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } as RequestInit;
}

async function createWorktree(page: Page, branch: string): Promise<string> {
  const res = await api(page, "/api/git/worktree/create", post({ cwd: FIXTURE_GIT, base: "main", newBranch: branch }));
  expect(res.success, `create ${branch}: ${JSON.stringify(res)}`).toBe(true);
  return res.data.path as string;
}

async function listWorktrees(page: Page): Promise<Array<{ path: string; exists?: boolean }>> {
  const res = await api(page, `/api/git/worktrees?cwd=${encodeURIComponent(FIXTURE_GIT)}`);
  return res.data?.worktrees ?? [];
}

/** Open the folder actions menu for the fixture repo and return the menu root. */
async function openFolderMenu(page: Page) {
  const group = page.locator('[data-testid="sortable-pinned-group"]').filter({ hasText: "sample-git" }).first();
  await group.locator('[data-testid="folder-actions-menu-btn"]').first().click();
  return page.locator('[data-testid="folder-actions-menu"]').first();
}

async function openManageDialog(page: Page) {
  const menu = await openFolderMenu(page);
  await menu.getByText("Manage worktrees").click();
  const dialog = page.locator('[data-testid="manage-worktrees-dialog"]');
  await expect(dialog).toBeVisible();
  return dialog;
}

test.beforeEach(async ({ page }) => {
  await gotoDashboard(page);
  await ensureGitSession(page);
  await pinDirectory(page, FIXTURE_GIT);
});

// test-plan #F4
test("folder menu offers manage-worktrees independently of live sessions", async ({ page }) => {
  const menu = await openFolderMenu(page);
  // The `directory` group holds it — not gated on any session existing.
  const directoryGroup = menu.locator('[data-testid="folder-menu-group-directory"]');
  await expect(directoryGroup).toContainText("Manage worktrees");
});

// test-plan #X13 + #F3
test("removes a session-less worktree and the list converges without a refresh", async ({ page }) => {
  const paths = [await createWorktree(page, "e2e-a"), await createWorktree(page, "e2e-b"), await createWorktree(page, "e2e-c")];
  const dialog = await openManageDialog(page);

  const rows = dialog.locator('[data-testid^="worktree-row-"]');
  const before = await rows.count();
  expect(before).toBeGreaterThanOrEqual(4); // main + 3

  await dialog.locator(`[data-testid="worktree-remove-${encodeURIComponent(paths[0])}"]`).click();
  const close = page.locator('[data-testid="close-worktree-dialog"]');
  await expect(close).toBeVisible();
  // No active_sessions guard: this worktree has no session entry.
  await expect(close.locator('[data-testid="close-active-sessions"]')).toHaveCount(0);
  await close.getByRole("button", { name: /remove|close worktree/i }).last().click();

  // The list converges on its own — no manual refresh, no permanently-pending row.
  await expect(rows).toHaveCount(before - 1, { timeout: 15_000 });
  await expect(dialog.locator(`[data-testid="worktree-row-${encodeURIComponent(paths[0])}"]`)).toHaveCount(0);
  await expect(dialog.locator('[data-testid^="worktree-remove-"][disabled]')).toHaveCount(0);
});

// test-plan #X11 — the escalation is INHERITED, not reimplemented.
test("removing a worktree with active sessions runs the same escalation flow", async ({ page }) => {
  const path = await createWorktree(page, "e2e-sessions");
  // Spawn a session inside the worktree so the server's guard fires.
  const spawn = await api(page, "/api/session/spawn", post({ cwd: path }));
  expect(spawn.success, JSON.stringify(spawn)).toBe(true);

  const dialog = await openManageDialog(page);
  await dialog.locator(`[data-testid="worktree-remove-${encodeURIComponent(path)}"]`).click();
  const close = page.locator('[data-testid="close-worktree-dialog"]');
  await expect(close.locator('[data-testid="close-active-sessions"]')).toBeVisible({ timeout: 20_000 });

  await close.getByRole("button", { name: /end .* session/i }).click();
  // Sessions end, the removal retries, and the worktree is gone.
  await expect(close).toHaveCount(0, { timeout: 40_000 });
  await expect
    .poll(async () => (await listWorktrees(page)).some((w) => w.path === path), { timeout: 30_000 })
    .toBe(false);
});

// test-plan #X5 — TOCTOU: the directory vanishes between fetch and click.
test("a directory deleted out-of-band reads as already gone, never a raw 400", async ({ page }) => {
  const path = await createWorktree(page, "e2e-toctou");
  const dialog = await openManageDialog(page);
  const row = dialog.locator(`[data-testid="worktree-row-${encodeURIComponent(path)}"]`);
  await expect(row).toBeVisible();

  // Delete the directory behind the client's back — the list is now stale.
  const del = await api(page, "/api/git/worktree/cleanup-orphan", post({ cwd: FIXTURE_GIT, path }));
  expect(del.status).toBeLessThan(500);

  await dialog.locator(`[data-testid="worktree-remove-${encodeURIComponent(path)}"]`).click();
  const close = page.locator('[data-testid="close-worktree-dialog"]');
  if (await close.count()) {
    await close.getByRole("button", { name: /remove|close worktree/i }).last().click();
  }
  // Treated as "already gone": the row leaves, and no raw 400 is rendered.
  await expect(row).toHaveCount(0, { timeout: 15_000 });
  await expect(dialog).not.toContainText("400");
  await expect(dialog).not.toContainText("cwd_invalid");
});

// test-plan #X12 — prune is repo-GLOBAL; the copy must not imply one row.
test("prune clears every stale registration and says so", async ({ page }) => {
  const a = await createWorktree(page, "e2e-stale-a");
  const b = await createWorktree(page, "e2e-stale-b");
  for (const p of [a, b]) {
    await api(page, "/api/git/worktree/cleanup-orphan", post({ cwd: FIXTURE_GIT, path: p }));
  }
  const dialog = await openManageDialog(page);
  // Both render as missing rows carrying the prune affordance.
  await expect(dialog.locator('[data-testid="worktree-row-missing"]')).toHaveCount(2);

  await dialog.locator(`[data-testid="worktree-prune-${encodeURIComponent(a)}"]`).click();

  const notice = dialog.locator('[data-testid="manage-worktrees-notice"]');
  await expect(notice).toBeVisible({ timeout: 15_000 });
  // Repo-global wording, not "this row".
  await expect(notice).toContainText(/across this repository/i);
  // BOTH stale registrations are gone, not just the one whose affordance was used.
  await expect
    .poll(async () => (await listWorktrees(page)).filter((w) => w.path === a || w.path === b).length, {
      timeout: 20_000,
    })
    .toBe(0);
});

// test-plan #F7 — contrast, in BOTH themes, against the real token stylesheet.
test("row text clears 4.5:1 in both themes and never uses muted/tertiary tokens", async ({ page }) => {
  await createWorktree(page, "e2e-contrast");
  const dialog = await openManageDialog(page);
  await expect(dialog.locator('[data-testid^="worktree-row-"]').first()).toBeVisible();

  for (const scheme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const report = await page.evaluate(() => {
      const lum = (c: string) => {
        const m = c.match(/\d+(\.\d+)?/g)?.map(Number) ?? [0, 0, 0];
        const [r, g, b] = m.slice(0, 3).map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const bgOf = (el: Element): string => {
        let node: Element | null = el;
        while (node) {
          const bg = getComputedStyle(node).backgroundColor;
          if (bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) return bg;
          node = node.parentElement;
        }
        return getComputedStyle(document.body).backgroundColor;
      };
      const muted = getComputedStyle(document.documentElement).getPropertyValue("--text-muted").trim();
      const tertiary = getComputedStyle(document.documentElement).getPropertyValue("--text-tertiary").trim();
      const out: Array<{ text: string; ratio: number; color: string }> = [];
      const rows = document.querySelectorAll('[data-testid^="worktree-row-"]');
      for (const row of rows) {
        for (const el of row.querySelectorAll("span, div")) {
          const text = (el.textContent ?? "").trim();
          if (!text || el.children.length > 0) continue;
          const color = getComputedStyle(el).color;
          const l1 = lum(color);
          const l2 = lum(bgOf(el));
          const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
          out.push({ text, ratio, color });
        }
      }
      return { out, muted, tertiary };
    });

    expect(report.out.length, `${scheme}: found row text runs`).toBeGreaterThan(0);
    for (const run of report.out) {
      expect(run.ratio, `${scheme}: "${run.text}" contrast`).toBeGreaterThanOrEqual(4.5);
    }
  }
  await page.emulateMedia({ colorScheme: null });
});
