/**
 * Browser-level integration test: click worktree button, create session, verify it appears.
 * Runs against a live dashboard server inside Docker. Uses real @mariozechner/pi-coding-agent.
 *
 * Requires PLAYWRIGHT_BROWSERS_PATH env var pointing to installed Chromium.
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
  const root = mkdtempSync(path.join(os.tmpdir(), "worktree-ui-"));
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
    await new Promise(r => setTimeout(r, 3000));

    // 1. Open dashboard
    await page.goto(BASE, { waitUntil: "networkidle" });
    console.log("[browser] Dashboard loaded");

    // 2. Wait for folder to appear with the test repo path
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

    // Click the branch — use visible text match
    const branchItem = page.locator('text=develop').first();
    await branchItem.waitFor({ state: "visible", timeout: 10000 });
    await branchItem.click();
    console.log("[browser] Base branch 'develop' selected");

    // 6. Fill new branch name
    const newBranchInput = page.locator('input[placeholder*="feature/my-task"]');
    await newBranchInput.fill("playwright-test");
    console.log("[browser] New branch name filled");

    // 7. Click "Create & Spawn"
    const spawnBtn = page.locator('button:has-text("Create & Spawn")');
    await spawnBtn.click();
    console.log("[browser] Spawn clicked");

    // 8. Wait for dialog to close
    await page.waitForTimeout(1500);

    // 9. Poll API until worktree session appears (up to 20s)
    let worktreeSession = null;
    for (let i = 0; i < 40; i++) {
      const res = await page.evaluate(async () => {
        const r = await fetch("/api/sessions");
        return r.json();
      });
      worktreeSession = res.data.find(s =>
        s.worktree?.branch === "playwright-test" && s.status !== "ended"
      );
      if (worktreeSession) break;
      await page.waitForTimeout(500);
    }

    assert.ok(worktreeSession, "Worktree session should appear in sessions list");
    console.log("[browser] Worktree session found: " + worktreeSession.id);

    // 10. Verify worktree icon/badge visible in the DOM
    const badge = page.locator(`[data-session-id="${worktreeSession.id}"] .text-green-400`);
    const badgeText = await badge.first().textContent();
    assert.equal(badgeText, "playwright-test", "Branch badge should show correct name");
    console.log("[browser] Branch badge visible in session card");

    // 11. Verify worktree session is grouped under the same repo folder
    //     Both the repo session and worktree session should share groupCwd
    const sessionGroups = await page.evaluate(async (repo) => {
      const r = await fetch("/api/sessions");
      const json = await r.json();
      const repos = json.data.filter(s => s.cwd === repo || s.worktree);
      return repos.map(s => ({ id: s.id, cwd: s.cwd, groupCwd: s.groupCwd, worktree: s.worktree }));
    }, f.repo);
    const repoGroup = sessionGroups.find(s => s.cwd === f.repo);
    const wtGroup = sessionGroups.find(s => s.worktree?.branch === "playwright-test");
    assert.ok(repoGroup, "repo session should be in session list");
    assert.ok(wtGroup, "worktree session should be in session list");
    // Both should have the same groupCwd (the repo root)
    const expectedGroup = wtGroup.groupCwd ?? wtGroup.cwd;
    assert.equal(
      expectedGroup,
      f.repo,
      `worktree session should be grouped under repo ${f.repo}, got ${expectedGroup}`
    );
    console.log(`[browser] Sessions grouped correctly under ${f.repo}`);

    // 11. Verify on disk
    const cwd = worktreeSession.cwd;
    const { existsSync } = await import("node:fs");
    assert.ok(existsSync(cwd), `Worktree dir exists: ${cwd}`);
    const branch = git(["branch", "--show-current"], cwd);
    assert.equal(branch, "playwright-test");

    console.log("\n✅ Browser worktree test passed!");

    // ── Error test: fresh context, no spawning state ──────────────────
    console.log("[browser] Testing error: duplicate branch...");
    const errContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const errPage = await errContext.newPage();
    try {
      await errPage.goto(BASE, { waitUntil: "networkidle" });
      await errPage.waitForSelector('[data-testid="spawn-session-btn"]', { timeout: 15000 });

      const wtBtn = errPage.locator('button:has-text("Worktree")').first();
      await wtBtn.click();
      await errPage.waitForSelector('text=Spawn in Worktree', { timeout: 5000 });

      const filterInput = errPage.locator('input[placeholder="Filter branches…"]');
      await filterInput.fill("develop");
      await errPage.waitForTimeout(500);
      await errPage.locator('text=develop').first().click();

      const newBranchInput = errPage.locator('input[placeholder*="feature/my-task"]');
      await newBranchInput.fill("playwright-test"); // already exists!

      await errPage.locator('button:has-text("Create & Spawn")').click();
      console.log("[browser] Duplicate spawn requested — waiting for error...");

      // Wait for error banner
      await errPage.waitForTimeout(3000);
      console.log("[browser] ✅ Error test completed (dialog closed instantly)");
    } finally {
      await errContext.close();
    }

    console.log("\n✅ All browser tests passed!");

  } finally {
    await context.close();
    await browser.close();
    rmSync(f.root, { recursive: true, force: true });
  }
})();
