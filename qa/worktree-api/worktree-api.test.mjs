/**
 * Docker-based API integration tests for worktree-session-spawn.
 *
 * Runs against a live dashboard server inside a Docker container.
 * Uses fake-pi to simulate pi sessions and controlled git for error simulation.
 *
 * See change: worktree-session-spawn
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// ── Config ─────────────────────────────────────────────────────────────────
const base = `http://127.0.0.1:${process.env.PI_DASHBOARD_PORT || "18080"}`;
const GIT = "git";

// ── Helpers ───────────────────────────────────────────────────────────────

function git(args, cwd) {
  return execFileSync(GIT, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function tryGit(args, cwd) {
  try { return git(args, cwd); } catch { return undefined; }
}

/**
 * Create an isolated git repo for testing.
 * Returns { root, repo, subdir } where:
 *   - root: temp directory containing the repo
 *   - repo: the repo directory (with main, feature-x, feature-y branches)
 *   - subdir: a nested directory inside the repo (for testing nested cwd resolution)
 */
function setupRepo() {
  const root = mkdtempSync(path.join(os.tmpdir(), "worktree-api-"));
  const repo = path.join(root, "repo");
  mkdirSync(repo, { recursive: true });
  git(["init", "-b", "main"], repo);
  git(["config", "user.email", "test@example.com"], repo);
  git(["config", "user.name", "Test User"], repo);
  writeFileSync(path.join(repo, "README.md"), "# test\n");
  git(["add", "README.md"], repo);
  git(["commit", "-m", "initial"], repo);
  // Create branches for testing
  git(["branch", "feature-x"], repo);
  git(["branch", "feature-y"], repo);
  // Create a nested subdirectory for repo-root resolution test
  const subdir = path.join(repo, "nested", "dir");
  mkdirSync(subdir, { recursive: true });
  return { root, repo, subdir };
}

async function request(method, endpoint, body) {
  const res = await fetch(`${base}${endpoint}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  return { status: res.status, json };
}

/**
 * Poll until condition is met. Used to wait for async server-side effects
 * (e.g., fake-pi session registration with worktree metadata).
 */
async function waitFor(fn, label, timeoutMs = 15000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (err) {
      last = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${label}${last ? `: ${last.message}` : ""}`);
}

async function getSessions() {
  const { json } = await request("GET", "/api/sessions");
  assert.equal(json.success, true);
  return json.data;
}

// ── Test runner ───────────────────────────────────────────────────────────

async function main() {
  const fixtures = [];
  try {
    await testListWorktreesOutsideGit();
    console.log("  ✓ list worktrees outside git repo");

    fixtures.push(await testSpawnListDeleteAndDetection());
    console.log("  ✓ spawn, list, delete, and worktree detection");

    fixtures.push(await testErrorResponses());
    console.log("  ✓ error responses");

    console.log("\n✅ All worktree API integration tests passed!");
  } finally {
    // Cleanup fixtures
    for (const f of fixtures) {
      if (f?.root) rmSync(f.root, { recursive: true, force: true });
    }
  }
}

// ── Test 1: List worktrees outside git repo ───────────────────────────────

async function testListWorktreesOutsideGit() {
  const nonGit = mkdtempSync(path.join(os.tmpdir(), "not-git-"));
  try {
    const { status, json } = await request("GET",
      `/api/git/worktrees?cwd=${encodeURIComponent(nonGit)}`);
    assert.equal(status, 200);
    assert.equal(json.success, true);
    assert.deepEqual(json.data.worktrees, []);
  } finally {
    rmSync(nonGit, { recursive: true, force: true });
  }
}

// ── Test 2: Spawn, list, delete, and worktree detection ───────────────────

async function testSpawnListDeleteAndDetection() {
  const f = setupRepo();

  // 2a. List worktrees before spawn — only main worktree
  let res = await request("GET",
    `/api/git/worktrees?cwd=${encodeURIComponent(f.repo)}`);
  assert.equal(res.json.success, true);
  const beforeCount = res.json.data.worktrees.length;
  assert.ok(beforeCount >= 1, "should have at least main worktree");
  const mainWt = res.json.data.worktrees.find(w => w.isMain);
  assert.ok(mainWt, "main worktree should be present");

  // 2b. Spawn a regular session first so repo appears in session list
  await request("POST", "/api/session/spawn", {
    cwd: f.repo,
  });
  await new Promise(r => setTimeout(r, 2000));

  // 2c. Spawn session in worktree — returns 202 Accepted immediately
  res = await request("POST", "/api/session/spawn", {
    cwd: f.subdir,
    spawnMode: "worktree",
    branch: "my-feature",
    baseBranch: "feature-x",
  });
  assert.equal(res.status, 202, `spawn should return 202, got ${res.status}: ${JSON.stringify(res.json)}`);
  assert.equal(res.json.success, true);
  assert.equal(res.json.data.status, "spawning");
  console.log("  202 Accepted — waiting for background spawn...");

  // Poll until worktree session appears (server does work in background)
  let worktreePath = null;
  for (let i = 0; i < 60; i++) {
    const sessionsRes = await request("GET", "/api/sessions");
    const wt = sessionsRes.json.data.find(s =>
      s.worktree?.branch === "my-feature" && s.status !== "ended"
    );
    if (wt) {
      worktreePath = wt.worktree.path;
      break;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  assert.ok(worktreePath, "worktree session should appear within 60s");

  // Verify worktree exists on disk
  assert.ok(existsSync(worktreePath), `worktree path should exist: ${worktreePath}`);

  // Verify path follows naming convention
  assert.ok(worktreePath.includes(`${path.sep}.pi${path.sep}worktrees${path.sep}my-feature-`),
    `worktree path should include '.pi/worktrees/my-feature-': ${worktreePath}`);

  // Verify it's checked out on the NEW branch
  assert.equal(git(["branch", "--show-current"], worktreePath), "my-feature");

  // Verify .gitignore was created at repo root (not nested dir)
  assert.ok(readFileSync(path.join(f.repo, ".gitignore"), "utf8").includes(".pi/"),
    "repo root .gitignore should contain .pi/");
  assert.ok(!existsSync(path.join(f.subdir, ".gitignore")),
    "nested cwd should NOT have received .gitignore");

  // 2d. Verify session worktree metadata (placeholder replaced by real session)
  const session = await getSessions().then(s => s.find(x => x.cwd === worktreePath));
  assert.ok(session, "placeholder should be replaced by real session");
  assert.equal(session.worktree.branch, "my-feature");
  assert.equal(session.status, "active", "session should be active after spawn");

  // 2d. Verify the worktree session is grouped under the parent repo folder
  //     (not as a separate .pi-worktrees/ folder). See: worktree-session-spawn §7.2
  const parentCwd = path.normalize(path.dirname(path.dirname(worktreePath)));
  const allSessions = await getSessions();
  const repoSession = allSessions.find(s => s.cwd === f.repo);
  const wtSession = allSessions.find(s => s.worktree?.branch === "my-feature");
  assert.ok(repoSession, "should have repo session");
  assert.ok(wtSession, "should have worktree session");
  // Worktree session should appear in the same folder group as the repo.
  // groupCwd is the server-populated field for UI folder grouping.
  assert.equal(
    wtSession.groupCwd ?? wtSession.cwd,
    f.repo,
    `worktree session should be grouped under repo folder ${f.repo}, got ${wtSession.groupCwd ?? wtSession.cwd}`
  );

  // 2e. List worktrees after spawn — should include the new one
  res = await request("GET",
    `/api/git/worktrees?cwd=${encodeURIComponent(f.repo)}`);
  assert.equal(res.json.success, true);
  const afterWorktrees = res.json.data.worktrees;
  assert.ok(afterWorktrees.length >= 2, "should have at least 2 worktrees after spawn");
  const spawnedWt = afterWorktrees.find(w => w.path === worktreePath);
  assert.ok(spawnedWt, "spawned worktree should appear in listing");
  assert.equal(spawnedWt.branch, "my-feature");

  // 2e. Delete the worktree
  res = await request("DELETE", "/api/git/worktrees", {
    cwd: f.repo,
    path: worktreePath,
  });
  assert.equal(res.status, 200, `delete failed: ${JSON.stringify(res.json)}`);
  assert.equal(res.json.success, true);
  assert.deepEqual(res.json.data, { removed: true, path: worktreePath });
  assert.equal(existsSync(worktreePath), false, "worktree should be removed from disk");

  return f;
}

// ── Test 3: Error responses ───────────────────────────────────────────────

async function testErrorResponses() {
  const f = setupRepo();

  // 3a. Spawn with non-existent branch (no baseBranch — branch must exist)
  //      Validation passes, but background spawn fails → 202 + spawn_error broadcast
  let res = await request("POST", "/api/session/spawn", {
    cwd: f.repo,
    spawnMode: "worktree",
    branch: "missing-branch",
  });
  assert.equal(res.status, 202, `expected 202, got ${res.status}: ${JSON.stringify(res.json)}`);
  assert.equal(res.json.success, true);
  assert.equal(res.json.data.status, "spawning");

  // 3a2. Spawn with non-existent baseBranch (also 202 + async error)
  res = await request("POST", "/api/session/spawn", {
    cwd: f.repo,
    spawnMode: "worktree",
    branch: "new-feature",
    baseBranch: "nonexistent-base",
  });
  assert.equal(res.status, 202, `expected 202, got ${res.status}: ${JSON.stringify(res.json)}`);

  // 3b. Spawn outside git repo
  const nonGit = mkdtempSync(path.join(os.tmpdir(), "not-git-spawn-"));
  res = await request("POST", "/api/session/spawn", {
    cwd: nonGit,
    spawnMode: "worktree",
    branch: "feature-x",
  });
  assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.json)}`);
  assert.equal(res.json.success, false);
  assert.equal(res.json.error, "not_a_git_repo");
  rmSync(nonGit, { recursive: true, force: true });

  // 3c. Delete main worktree — should be refused
  res = await request("DELETE", "/api/git/worktrees", {
    cwd: f.repo,
    path: f.repo,
  });
  assert.equal(res.status, 403, `expected 403, got ${res.status}: ${JSON.stringify(res.json)}`);
  assert.equal(res.json.success, false);
  assert.equal(res.json.error, "cannot_remove_main_worktree");

  // 3d. Delete non-existent worktree
  const fakeManagedPath = path.join(path.dirname(f.repo), ".pi-worktrees", "missing-99999");
  res = await request("DELETE", "/api/git/worktrees", {
    cwd: f.repo,
    path: fakeManagedPath,
  });
  assert.equal(res.status, 404, `expected 404, got ${res.status}: ${JSON.stringify(res.json)}`);
  assert.equal(res.json.success, false);
  assert.equal(res.json.error, "not_a_worktree");

  // 3e. Delete external worktree (not managed by dashboard)
  const externalPath = path.join(f.root, "external-worktree");
  git(["worktree", "add", externalPath, "feature-y"], f.repo);
  res = await request("DELETE", "/api/git/worktrees", {
    cwd: f.repo,
    path: externalPath,
  });
  assert.equal(res.status, 403, `expected 403, got ${res.status}: ${JSON.stringify(res.json)}`);
  assert.equal(res.json.success, false);
  assert.equal(res.json.error, "external_worktree_readonly");
  // Cleanup external worktree
  git(["worktree", "remove", "--force", externalPath], f.repo);

  // 3f. Spawn with invalid branch name characters
  res = await request("POST", "/api/session/spawn", {
    cwd: f.repo,
    spawnMode: "worktree",
    branch: "evil; rm -rf /",
  });
  assert.equal(res.status, 400);
  assert.equal(res.json.success, false);
  assert.ok(res.json.error.includes("Invalid"),
    `expected 'Invalid' in error, got: ${res.json.error}`);

  return f;
}

// ── Run ────────────────────────────────────────────────────────────────────

await main();
