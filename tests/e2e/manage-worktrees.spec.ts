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
import { execFileSync } from "node:child_process";
import { expect, type Page, test } from "./fixtures.js";
import { ensureGitSession, FIXTURE_GIT, gotoDashboard, pinDirectory } from "./helpers/index.js";
import { DASHBOARD_PORT } from "./lifecycle.js";

/**
 * Resolve the harness container by the dashboard port it publishes —
 * `test-up.sh` hash-derives a per-worktree compose project, so the name is not
 * knowable here but the port is. Same pattern as `tmux-session-shutdown.spec.ts`.
 */
function resolveContainer(): string {
  const out = execFileSync(
    "docker",
    ["ps", "--filter", `publish=${DASHBOARD_PORT}`, "--format", "{{.Names}}"],
    { encoding: "utf8" },
  ).trim();
  const name = out.split("\n").filter(Boolean)[0];
  if (!name) throw new Error(`no running container publishes port ${DASHBOARD_PORT}`);
  return name;
}

/**
 * Delete a worktree directory OUT-OF-BAND, leaving its git registration
 * behind. `orphan-cleanup` cannot do this — it refuses a registered worktree
 * with `not_orphan`, which is exactly the state these scenarios need.
 */
function deleteDirOutOfBand(absPath: string): void {
  execFileSync("docker", ["exec", resolveContainer(), "sh", "-c", `rm -rf '${absPath}'`], {
    encoding: "utf8",
  });
}

interface ApiResult {
  status: number;
  success?: boolean;
  error?: string;
  data?: Record<string, unknown>;
}

/** Thin API caller in page context (same origin as the dashboard). */
async function api(page: Page, path: string, init?: RequestInit): Promise<ApiResult> {
  return page.evaluate(
    async ([p, i]) => {
      const res = await fetch(p as string, (i ?? undefined) as RequestInit | undefined);
      return { status: res.status, ...(await res.json().catch(() => ({}))) };
    },
    [path, init ? (JSON.parse(JSON.stringify(init)) as RequestInit) : null] as const,
  );
}

function post(body: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } as RequestInit;
}

async function listWorktrees(page: Page): Promise<Array<{ path: string; exists?: boolean }>> {
  const res = await api(page, `/api/git/worktrees?cwd=${encodeURIComponent(FIXTURE_GIT)}`);
  return (res.data?.worktrees ?? []) as Array<{ path: string; exists?: boolean }>;
}

/** The fixture's default branch is not assumed — read it off the main entry. */
async function baseBranch(page: Page): Promise<string> {
  const entries = await listWorktrees(page);
  const main = entries.find((e) => (e as { isMain?: boolean }).isMain);
  const branch = (main as { branch?: string | null } | undefined)?.branch;
  if (!branch) throw new Error(`could not resolve the fixture's base branch: ${JSON.stringify(entries)}`);
  return branch;
}

/**
 * Every worktree this spec creates, so `afterEach` can clear it. Specs share
 * ONE container, so a leftover `.worktrees/<name>` from a previous run makes
 * the next `create` fail `path_exists` — the spec must be re-runnable.
 */
const created = new Set<string>();
const branchesCreated = new Set<string>();

async function createWorktree(page: Page, name: string): Promise<string> {
  const base = await baseBranch(page);
  // Unique per run: the fixture repo persists across spec runs in one container.
  const branch = `${name}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const res = await api(page, "/api/git/worktree", post({ cwd: FIXTURE_GIT, base, newBranch: branch }));
  expect(res.success, `create ${branch}: ${JSON.stringify(res)}`).toBe(true);
  const path = res.data?.path as string;
  created.add(path);
  branchesCreated.add(branch);
  return path;
}

/** Open the folder actions menu for the fixture repo and return the menu root. */
async function openFolderMenu(page: Page) {
  await page.locator(`[data-testid="folder-actions-menu-${FIXTURE_GIT}"]`).first().click();
  return page.locator(`[data-testid="folder-actions-menu-panel-${FIXTURE_GIT}"]`).first();
}

async function openManageDialog(page: Page) {
  const menu = await openFolderMenu(page);
  await menu.locator('[data-testid="folder-menu-item-manage-worktrees"]').click();
  const dialog = page.locator('[data-testid="manage-worktrees-dialog"]');
  await expect(dialog).toBeVisible();
  // The list fetches async — never count rows before the fetch settles.
  await expect(dialog.locator('[data-testid="manage-worktrees-loading"]')).toHaveCount(0, { timeout: 20_000 });
  await expect(dialog.locator('[data-testid="worktree-row-main"]')).toHaveCount(1, { timeout: 20_000 });
  return dialog;
}

test.beforeEach(async ({ page }) => {
  await gotoDashboard(page);
  await ensureGitSession(page);
  await pinDirectory(page, FIXTURE_GIT);
});

test.afterEach(() => {
  // Best-effort teardown IN the container: force-remove anything this test
  // created, drop its branch, then prune the registrations left by the
  // out-of-band directory deletions. Never fails the test.
  const container = resolveContainer();
  const cmds: string[] = [];
  for (const p of created) cmds.push(`git -C ${FIXTURE_GIT} worktree remove --force '${p}' 2>/dev/null || true`);
  for (const b of branchesCreated) cmds.push(`git -C ${FIXTURE_GIT} branch -D '${b}' 2>/dev/null || true`);
  cmds.push(`git -C ${FIXTURE_GIT} worktree prune || true`);
  try {
    execFileSync("docker", ["exec", container, "sh", "-c", cmds.join("; ")], { encoding: "utf8" });
  } catch {
    // teardown is advisory
  }
  created.clear();
  branchesCreated.clear();
});

// test-plan #F4
test("folder menu offers manage-worktrees independently of live sessions", async ({ page }) => {
  const menu = await openFolderMenu(page);
  // The `directory` group holds it — not gated on any session existing.
  const directoryGroup = menu.locator('[data-testid="folder-menu-group-directory"]');
  await expect(directoryGroup.locator('[data-testid="folder-menu-item-manage-worktrees"]')).toHaveCount(1);
});

// test-plan #X13 + #F3
test("removes a session-less worktree and the list converges without a refresh", async ({ page }) => {
  const paths = [await createWorktree(page, "e2e-a"), await createWorktree(page, "e2e-b"), await createWorktree(page, "e2e-c")];
  const dialog = await openManageDialog(page);

  const rows = dialog.locator('[data-testid^="worktree-row-"]');
  for (const p of paths) {
    await expect(dialog.locator(`[data-testid="worktree-row-${encodeURIComponent(p)}"]`)).toHaveCount(1);
  }
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
  // Spawning a real pi session + ending it is well past the 60 s default.
  test.setTimeout(180_000);
  const path = await createWorktree(page, "e2e-sessions");
  // Spawn a REAL session inside the worktree so the server's guard fires.
  // There is no REST spawn endpoint (spawning is over the browser WS bus), so
  // this drives the same sidebar affordance a user would: pin the worktree,
  // then spawn into it.
  await pinDirectory(page, path);
  // Scope the spawn button to the WORKTREE's own folder cluster — an unscoped
  // `.first()` would spawn into the fixture repo instead.
  const body = page.locator(`[data-testid="folder-body-${path}"]`);
  await expect(body).toBeVisible({ timeout: 30_000 });
  await body.locator('[data-testid="folder-spawn-session-btn"]').first().click();
  // Wait until the server actually reports an ACTIVE session under that path —
  // the guard keys on that, not on the click.
  await expect
    .poll(
      async () => {
        const res = await api(page, "/api/sessions");
        const sessions = (res.data?.sessions ?? res.data ?? []) as Array<{ cwd?: string; status?: string }>;
        return sessions.filter((x) => x.cwd === path && x.status !== "ended").length;
      },
      { timeout: 90_000 },
    )
    .toBeGreaterThan(0);

  const dialog = await openManageDialog(page);
  await dialog.locator(`[data-testid="worktree-remove-${encodeURIComponent(path)}"]`).click();
  const close = page.locator('[data-testid="close-worktree-dialog"]');
  await expect(close).toBeVisible();
  // Confirm once — the server's `active_sessions` guard fires on THAT post,
  // not on opening the dialog.
  await close.getByRole("button", { name: /remove|close worktree/i }).last().click();
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
  deleteDirOutOfBand(path);

  await dialog.locator(`[data-testid="worktree-remove-${encodeURIComponent(path)}"]`).click();
  const close = page.locator('[data-testid="close-worktree-dialog"]');
  await expect(close).toBeVisible();
  await close.getByRole("button", { name: /remove|close worktree/i }).last().click();

  // The server 400s `cwd_invalid` (validateCwd rejects a nonexistent path
  // before git runs). "Already gone" means the confirm dialog DISMISSES and no
  // raw 400 surfaces — it must not become a dead end.
  await expect(close).toHaveCount(0, { timeout: 15_000 });
  await expect(dialog).not.toContainText("400");
  await expect(dialog).not.toContainText("cwd_invalid");

  // Per design D8 the registration still exists, so the row does NOT vanish —
  // it converts to a prune candidate: the `✕` is replaced by a prune
  // affordance and the row is excluded from selection.
  await expect(row).toHaveCount(1);
  await expect(dialog.locator(`[data-testid="worktree-remove-${encodeURIComponent(path)}"]`)).toHaveCount(0, { timeout: 15_000 });
  await expect(dialog.locator(`[data-testid="worktree-prune-${encodeURIComponent(path)}"]`)).toHaveCount(1);
  await expect(dialog.locator(`[data-testid="worktree-select-${encodeURIComponent(path)}"]`)).toHaveCount(0);
});

// test-plan #X12 — prune is repo-GLOBAL; the copy must not imply one row.
test("prune clears every stale registration and says so", async ({ page }) => {
  const a = await createWorktree(page, "e2e-stale-a");
  const b = await createWorktree(page, "e2e-stale-b");
  for (const p of [a, b]) deleteDirOutOfBand(p);
  const dialog = await openManageDialog(page);
  // Both of THIS test's rows render as missing, carrying the prune affordance.
  // Asserted per-row, not as a global count — the container is shared.
  for (const p of [a, b]) {
    await expect(dialog.locator(`[data-testid="worktree-prune-${encodeURIComponent(p)}"]`)).toHaveCount(1);
  }

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
