#!/usr/bin/env node
/**
 * reattach-head.mjs <branch>
 *
 * Cross-platform port of reattach-head.sh. Same contract, same exit codes,
 * same structured stdout/stderr. Runs on macOS / Linux / Windows uniformly
 * (no bash, no flock, no symlinks, no posix-only constructs).
 *
 * Atomic lock: O_CREAT|O_EXCL file create — works identically on Win32 NTFS,
 * APFS, ext4. Stale-lock detection via process.kill(pid, 0). Liveness check
 * is best-effort across the Win32 ↔ subprocess boundary — false-positive
 * "alive" on stale PID just means the lock waits for human intervention,
 * which is the safe default.
 *
 * Exit codes (identical to .sh sibling):
 *   0   success: HEAD now attached to refs/heads/<branch>
 *   1   usage error (missing arg, wrong cwd, not a colocated repo)
 *   2   ref does not exist
 *   3   HEAD hash does not match branch tip hash
 *   4   jj op_heads/ has multiple entries (concurrent jj op in flight)
 *   5   could not acquire advisory lock (another agent reattaching?)
 *   6   post-condition failed (HEAD did not attach for some reason)
 *
 * See: .pi/skills/jj-workspace/SKILL.md "Reattaching a detached git HEAD".
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ok = (msg) => console.log(`[ok] ${msg}`);
const fail = (msg) => console.error(`[fail] ${msg}`);
const hint = (msg) => console.error(`[hint] ${msg}`);

function die(code, message, ...hints) {
  fail(message);
  for (const h of hints) hint(h);
  process.exit(code);
}

function git(args, opts = {}) {
  const r = spawnSync("git", args, { encoding: "utf-8", ...opts });
  return {
    ok: r.status === 0,
    stdout: (r.stdout ?? "").trim(),
    stderr: (r.stderr ?? "").trim(),
    status: r.status,
  };
}

// ── Arg parse ──────────────────────────────────────────────────────────────
const branch = process.argv[2];
if (!branch || branch.startsWith("-")) {
  die(1, "usage: reattach-head.mjs <branch>");
}

// ── Locate repo root ───────────────────────────────────────────────────────
const top = git(["rev-parse", "--show-toplevel"]);
if (!top.ok) die(1, "not inside a git repository");
const repoRoot = top.stdout;

// Must be colocated.
if (!fs.existsSync(path.join(repoRoot, ".jj"))) {
  die(
    1,
    `not a colocated jj+git repo (.jj/ missing at ${repoRoot})`,
    "this script is for colocated repos only. Use plain git tooling.",
  );
}

// ── Pre-flight 1: ref exists ───────────────────────────────────────────────
const branchRef = `refs/heads/${branch}`;
const branchProbe = git(["-C", repoRoot, "rev-parse", "--verify", branchRef]);
if (!branchProbe.ok) {
  die(
    2,
    `ref ${branchRef} does not exist`,
    `check with: git branch --list '${branch}'`,
  );
}
const branchHash = branchProbe.stdout;
ok(`ref ${branchRef} exists at ${branchHash}`);

// ── Pre-flight 2: HEAD == branch tip ───────────────────────────────────────
const headProbe = git(["-C", repoRoot, "rev-parse", "HEAD"]);
if (!headProbe.ok) die(6, "could not read HEAD");
const headHash = headProbe.stdout;

if (headHash !== branchHash) {
  die(
    3,
    `HEAD (${headHash}) != ${branchRef} (${branchHash})`,
    "HEAD points at a different commit than the branch tip.",
    "Do NOT reattach with symbolic-ref — use jj instead:",
    `  jj new   ${branch}      # new working copy on the tip`,
    `  jj edit  ${branch}      # edit the tip commit in place`,
  );
}
ok(`HEAD == ${branchRef} (${headHash})`);

// ── Pre-flight 3: no jj op in flight ───────────────────────────────────────
// jj writes operation heads under .jj/repo/op_heads/heads/. Steady state has
// exactly one entry. Multiple entries = concurrent op or unresolved divergence.
const opHeadsDir = path.join(repoRoot, ".jj", "repo", "op_heads", "heads");
if (fs.existsSync(opHeadsDir)) {
  let opHeadCount = 0;
  try {
    opHeadCount = fs.readdirSync(opHeadsDir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .length;
  } catch {
    /* if we can't read it, treat as 0 — surface no false alarms */
  }
  if (opHeadCount > 1) {
    die(
      4,
      `jj has ${opHeadCount} operation heads (concurrent op or divergence)`,
      "inspect: jj op log --limit 10",
      "resolve before reattaching.",
    );
  }
  ok(`jj op heads: ${opHeadCount} (steady state)`);
} else {
  ok("jj op_heads/ absent — fresh repo, no concurrent op possible");
}

// ── Pre-flight 4: atomic advisory lock ─────────────────────────────────────
// O_CREAT|O_EXCL is atomic across NTFS / APFS / ext4. Cooperating agents
// running this script serialize. Hostile bypass agents are not protected.
const lockPath = path.join(repoRoot, ".jj", ".reattach.lock");
let lockFd = null;

function tryAcquireLock() {
  try {
    const fd = fs.openSync(
      lockPath,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
      0o600,
    );
    fs.writeSync(fd, String(process.pid));
    return fd;
  } catch (e) {
    if (e && e.code === "EEXIST") return null;
    throw e;
  }
}

function readStalePid() {
  try {
    return parseInt(fs.readFileSync(lockPath, "utf-8").trim(), 10);
  } catch {
    return NaN;
  }
}

function pidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0); // probe; throws ESRCH if dead, EPERM if alive but cross-user
    return true;
  } catch (e) {
    if (e && e.code === "EPERM") return true; // exists but we lack signal perms
    return false;
  }
}

lockFd = tryAcquireLock();
if (lockFd === null) {
  const stalePid = readStalePid();
  if (Number.isFinite(stalePid) && !pidAlive(stalePid)) {
    // Stale: owner is dead. Reclaim.
    try { fs.unlinkSync(lockPath); } catch { /* race */ }
    lockFd = tryAcquireLock();
  }
}
if (lockFd === null) {
  const stalePid = readStalePid();
  die(
    5,
    `another reattach-head is in progress (lock: ${lockPath}, pid=${stalePid})`,
    "wait for the other agent, or delete the lock file if it is stale.",
  );
}
ok(`acquired lock on ${lockPath}`);

// Clean up the lock on any exit path.
function releaseLock() {
  try { if (lockFd !== null) fs.closeSync(lockFd); } catch { /* ignore */ }
  try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
}
process.on("exit", releaseLock);
process.on("SIGINT", () => { releaseLock(); process.exit(130); });
process.on("SIGTERM", () => { releaseLock(); process.exit(143); });

// ── Recheck HEAD == branch under lock (TOCTOU mitigation) ──────────────────
const headAfter = git(["-C", repoRoot, "rev-parse", "HEAD"]);
const branchAfter = git(["-C", repoRoot, "rev-parse", "--verify", branchRef]);
if (
  !headAfter.ok || !branchAfter.ok ||
  headAfter.stdout !== headHash ||
  branchAfter.stdout !== branchHash
) {
  die(
    3,
    "state changed between pre-flight and lock acquisition",
    `HEAD was ${headHash}, now ${headAfter.stdout}`,
    `branch was ${branchHash}, now ${branchAfter.stdout}`,
  );
}
ok("HEAD + branch hashes still match under lock");

// ── The op ─────────────────────────────────────────────────────────────────
const symRes = git(["-C", repoRoot, "symbolic-ref", "HEAD", branchRef]);
if (!symRes.ok) {
  die(6, `git symbolic-ref failed: ${symRes.stderr || "(no stderr)"}`);
}
ok(`git symbolic-ref HEAD ${branchRef}`);

// ── Post-condition 1: HEAD is symbolic ref to branch ──────────────────────
const attached = git(["-C", repoRoot, "symbolic-ref", "-q", "HEAD"]);
if (!attached.ok || attached.stdout !== branchRef) {
  die(
    6,
    `post-check: HEAD is not attached to ${branchRef} (got: ${attached.stdout || "(empty)"})`,
  );
}
ok(`HEAD attached to ${branchRef}`);

// ── Post-condition 2: hash unchanged (sanity) ──────────────────────────────
const headFinal = git(["-C", repoRoot, "rev-parse", "HEAD"]);
if (!headFinal.ok || headFinal.stdout !== headHash) {
  die(
    6,
    `post-check: HEAD commit hash drifted (${headHash} -> ${headFinal.stdout || "?"})`,
  );
}
ok(`HEAD commit hash unchanged (${headFinal.stdout})`);

console.log(`[done] reattached HEAD to ${branchRef}`);
process.exit(0);
