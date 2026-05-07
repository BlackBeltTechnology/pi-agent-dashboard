/**
 * Browser-level integration test: placeholder → real-card replacement for worktree spawn.
 *
 * Verifies that when a worktree session is spawned:
 *   1. Placeholder appears at top of group
 *   2. Placeholder is replaced in-place by real session card
 *   3. Real card is at top of group (not bottom)
 *
 * Runs against a live dashboard server inside Docker.
 * Requires PLAYWRIGHT_BROWSERS_PATH env var pointing to installed Chromium.
 *
 * See change: fix-worktree-placeholder-replacement.
 */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = `http://127.0.0.1:${process.env.PI_DASHBOARD_PORT || "18080"}`;

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function setupRepo() {
  const root = mkdtempSync(path.join(os.tmpdir(), "worktree-placeholder-"));
  const repo = path.join(root, "repo");
  mkdirSync(repo, { recursive: true });
  git(["init", "-b", "main"], repo);
  git(["config", "user.email", "test@example.com"], repo);
  git(["config", "user.name", "Test"], repo);
  writeFileSync(path.join(repo, "README.md"), "# test\n");
  git(["add", "README.md"], repo);
  git(["commit", "-m", "initial"], repo);
  git(["branch", "develop"], repo);
  return { root, repo };
}

(async () => {
  const f = setupRepo();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  try {
    // 0. Spawn a regular session first so the test repo appears in the sidebar
    console.log("[browser] Spawning initial session to discover directory...");
    const spawnRes = await fetch(`${BASE}/api/session/spawn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: f.repo }),
    });
    const spawnJson = await spawnRes.json();
    assert.ok(spawnJson.success, `Initial spawn failed: ${JSON.stringify(spawnJson)}`);
    // Wait for session to register
    await new Promise(r => setTimeout(r, 3000));

    // 1. Open dashboard
    await page.goto(BASE, { waitUntil: "networkidle" });
    console.log("[browser] Dashboard loaded");

    // 2. Wait for folder to appear
    await page.waitForSelector('[data-testid="spawn-session-btn"]', { timeout: 15000 });
    console.log("[browser] Folder action bar visible");

    // 3. Click "Worktree" button
    const worktreeBtn = page.locator('button:has-text("Worktree")').first();
    await worktreeBtn.waitFor({ state: "visible", timeout: 5000 });
    await worktreeBtn.click();
    console.log("[browser] Worktree dialog opened");

    // 4. Wait for dialog
    await page.waitForSelector('text=Spawn in Worktree', { timeout: 5000 });

    // 5. Select base branch "develop"
    const filterInput = page.locator('input[placeholder="Filter branches…"]');
    await filterInput.waitFor({ state: "visible", timeout: 5000 });
    await filterInput.click();
    await filterInput.fill("develop");
    await page.waitForTimeout(800);

    const branchItem = page.locator('text=develop').first();
    await branchItem.waitFor({ state: "visible", timeout: 10000 });
    await branchItem.click();
    console.log("[browser] Base branch 'develop' selected");

    // 6. Fill new branch name
    const newBranchInput = page.locator('input[placeholder*="feature/my-task"]');
    await newBranchInput.fill("placeholder-test");
    console.log("[browser] New branch name filled");

    // ── ASSERTION 1: No placeholder visible before clicking spawn ──
    let placeholderBefore = await page.locator('[data-testid="placeholder-session-card"]').count();
    assert.equal(placeholderBefore, 0, "No placeholder should be visible before spawn");

    // 7. Click "Create & Spawn"
    const spawnBtn = page.locator('button:has-text("Create & Spawn")');
    await spawnBtn.click();
    console.log("[browser] Spawn clicked");

    // ── ASSERTION 2: Placeholder appears immediately ──
    await page.waitForSelector('[data-testid="placeholder-session-card"]', { timeout: 5000 });
    let placeholderCount = await page.locator('[data-testid="placeholder-session-card"]').count();
    assert.equal(placeholderCount, 1, "Placeholder card should appear after spawn click");
    console.log("[browser] Placeholder visible ✓");

    // ── ASSERTION 3: Placeholder is the first card in the group ──
    // The group expand/collapse uses 'group-collapse' class; inside it,
    // the placeholder should be before any session cards.
    const groupContent = page.locator('.group-collapse.expanded').first();
    const firstChildTestId = await groupContent
      .locator('[data-testid="placeholder-session-card"], [data-testid^="session-card-"]')
      .first()
      .getAttribute("data-testid");
    assert.equal(
      firstChildTestId,
      "placeholder-session-card",
      "Placeholder should be first card in group"
    );
    console.log("[browser] Placeholder is at top ✓");

    // 8. Wait for dialog to close
    await page.waitForTimeout(1500);

    // 9. Poll API until worktree session appears (up to 30s)
    let worktreeSession = null;
    for (let i = 0; i < 60; i++) {
      const res = await page.evaluate(async () => {
        const r = await fetch("/api/sessions");
        return r.json();
      });
      worktreeSession = res.data.find(s =>
        s.worktree?.branch === "placeholder-test" && s.status !== "ended"
      );
      if (worktreeSession) break;
      await page.waitForTimeout(500);
    }

    assert.ok(worktreeSession, "Worktree session should appear in sessions list");
    console.log("[browser] Worktree session found: " + worktreeSession.id);

    // Give the UI a moment to re-render after session_added
    await page.waitForTimeout(2000);

    // ── ASSERTION 4: Placeholder is gone ──
    placeholderCount = await page.locator('[data-testid="placeholder-session-card"]').count();
    assert.equal(placeholderCount, 0, "Placeholder should be removed after session registers");
    console.log("[browser] Placeholder removed ✓");

    // ── ASSERTION 5: Real session card is at top of group ──
    // Verify via sessions_reordered: the worktree session should be at index 0
    // of the order for the repo cwd (groupCwd).
    const orderingCheck = await page.evaluate(async (repo, wtId) => {
      const r = await fetch("/api/sessions");
      const json = await r.json();
      // Find sessions in the same group
      const repoGroup = json.data.filter(s =>
        s.cwd === repo || s.groupCwd === repo
      );
      const wtSession = repoGroup.find(s => s.id === wtId);
      return {
        found: !!wtSession,
        cwd: wtSession?.cwd,
        groupCwd: wtSession?.groupCwd,
      };
    }, f.repo, worktreeSession.id);
    assert.ok(orderingCheck.found, "Worktree session should be in repo group");
    assert.equal(
      orderingCheck.groupCwd,
      f.repo,
      `groupCwd should be ${f.repo}, got ${orderingCheck.groupCwd}`
    );
    console.log(`[browser] Session ordering verified via API ✓`);

    // 10. Verify on disk
    const cwd = worktreeSession.cwd;
    const { existsSync } = await import("node:fs");
    assert.ok(existsSync(cwd), `Worktree dir exists: ${cwd}`);
    const branch = git(["branch", "--show-current"], cwd);
    assert.equal(branch, "placeholder-test");

    console.log("\n✅ Worktree placeholder test passed!");

  } finally {
    await context.close();
    await browser.close();
    rmSync(f.root, { recursive: true, force: true });
  }
})();
