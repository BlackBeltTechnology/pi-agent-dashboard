/**
 * Crash-safety tests for the mutation harness journal.
 *
 * The harness writes broken code into REAL tracked source files and restores
 * them in a `finally` — which does nothing when the process is killed without
 * unwinding. These tests cover the journal that backstops that.
 *
 * FIXTURE RULE (load-bearing): no test here may mutate a real tracked file.
 * Every test builds a throwaway repoRoot under `mkdtempSync`. A test for a
 * crash-safety mechanism that leaves residue when IT is killed would be the
 * original bug wearing a lab coat.
 *
 * Covers test-plan #E1-#E8 and #X1-#X12.
 * See change: harden-mutation-harness-restore.
 */
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  beginMutation,
  formatConflicts,
  journalDir,
  prepareMutation,
  reconcile,
  verifyTeeth,
  writeJournalEntry,
} from "../mutation-harness.mjs";
import globalSetup from "../mutation-journal-global-setup.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const CHILD = path.join(here, "fixtures", "mutation-journal-child.mjs");

const SOURCE_REL = "src/target.ts";
const ORIGINAL_TEXT = "export const x = 1; // KEEP_ME\n";
const MUTATION = {
  name: "target loses its behaviour",
  source: SOURCE_REL,
  find: "KEEP_ME",
  replace: "/* mutated: gone */",
};

/** A throwaway repo with one source file. Never a real tracked path. */
function seedRepo(content = ORIGINAL_TEXT) {
  const root = mkdtempSync(path.join(os.tmpdir(), "mut-journal-"));
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, SOURCE_REL), content);
  return root;
}

function sourcePath(root) {
  return path.join(root, SOURCE_REL);
}

function entries(root) {
  try {
    return readdirSync(journalDir(root)).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
}

/**
 * A pid that is certainly gone: run a process to completion, then reuse its id.
 * Residue belongs to a DEAD owner by definition — an entry owned by a LIVE
 * process is in-flight work that reconciliation must leave alone.
 */
function deadPid() {
  const done = spawnSync(process.execPath, ["-e", ""]);
  return done.pid;
}

/** Rewrite an entry's owner, so the fixture reads as residue rather than in-flight. */
function setEntryPid(entryPath, pid) {
  const entry = JSON.parse(readFileSync(entryPath, "utf8"));
  entry.pid = pid;
  writeFileSync(entryPath, `${JSON.stringify(entry, null, 2)}\n`);
}

/** Leave the tree exactly as a SIGKILL mid-mutation would: mutated + journaled. */
function leaveResidue(root) {
  const { abs, original, mutated } = prepareMutation(root, MUTATION);
  const entryPath = writeJournalEntry(root, SOURCE_REL, original, mutated);
  writeFileSync(abs, mutated);
  setEntryPid(entryPath, deadPid()); // the owning run is gone
  return { entryPath, original, mutated };
}

/** Spawn the child fixture and resolve once its mutation is observable on disk. */
function spawnChildMidMutation(root) {
  const marker = path.join(root, "ready");
  const child = spawn(process.execPath, [CHILD, root, marker], { stdio: "ignore" });
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 15_000;
    const poll = setInterval(() => {
      if (existsSync(marker)) {
        clearInterval(poll);
        resolve(child);
      } else if (child.exitCode !== null || Date.now() > deadline) {
        clearInterval(poll);
        reject(new Error(`child never reached the mutation (exit ${child.exitCode})`));
      }
    }, 25);
  });
}

function waitForExit(child) {
  return new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
}

describe("mutation journal", () => {
  let root;

  beforeEach(() => {
    root = seedRepo();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // ---- test-plan #E1 --------------------------------------------------------
  it("writes the journal entry before the source file is touched", () => {
    const { original, mutated } = prepareMutation(root, MUTATION);
    writeJournalEntry(root, SOURCE_REL, original, mutated);

    expect(entries(root)).toHaveLength(1);
    // The source write has not happened yet — this is the window a kill can land in.
    expect(readFileSync(sourcePath(root))).toEqual(Buffer.from(ORIGINAL_TEXT));
  });

  // ---- test-plan #E2 --------------------------------------------------------
  it("leaves no journal entry after a normal restore", () => {
    verifyTeeth(root, { test: "fake", mutations: [MUTATION] }, { runner: () => false });

    expect(entries(root)).toHaveLength(0);
    expect(reconcile(root)).toEqual({ restored: [], skipped: [], conflicts: [] });
  });

  // ---- test-plan #E3 --------------------------------------------------------
  it("writes one entry per mutation, so an earlier entry survives a later one", () => {
    writeFileSync(path.join(root, "src", "other.ts"), "export const y = 2; // KEEP_ME\n");
    const a = leaveResidue(root); // A is journaled AND applied

    writeJournalEntry(root, "src/other.ts", Buffer.from("orig-b"), Buffer.from("mut-b"));

    expect(entries(root)).toHaveLength(2);
    const parsedA = JSON.parse(readFileSync(a.entryPath, "utf8"));
    expect(Buffer.from(parsedA.originalBytes, "base64")).toEqual(Buffer.from(ORIGINAL_TEXT));
  });

  // ---- test-plan #E4 --------------------------------------------------------
  it("a torn/garbage entry cannot destroy a live entry", () => {
    leaveResidue(root);
    writeFileSync(path.join(journalDir(root), "garbage.json"), "{ half-written");

    const { restored, conflicts } = reconcile(root);

    // The good entry still reconciled; the garbage one is reported, not obeyed.
    expect(restored).toEqual([SOURCE_REL]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].reason).toMatch(/unreadable/);
    expect(readFileSync(sourcePath(root))).toEqual(Buffer.from(ORIGINAL_TEXT));
  });

  // ---- test-plan #E5 --------------------------------------------------------
  it("restores byte-exactly through a BOM and invalid UTF-8", () => {
    const exotic = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]), // UTF-8 BOM
      Buffer.from("export const x = 1; // KEEP_ME\n"),
      Buffer.from([0xff, 0xfe, 0x80]), // not valid UTF-8
    ]);
    rmSync(root, { recursive: true, force: true });
    root = seedRepo();
    writeFileSync(sourcePath(root), exotic);

    leaveResidue(root);
    const { restored, conflicts } = reconcile(root);

    expect(conflicts).toEqual([]);
    expect(restored).toEqual([SOURCE_REL]);
    expect(readFileSync(sourcePath(root)).equals(exotic)).toBe(true);
  });

  // ---- test-plan #E6 --------------------------------------------------------
  it("stores repo-relative paths, so the tree can be moved", () => {
    leaveResidue(root);
    const moved = `${root}-moved`;
    renameSync(root, moved);

    try {
      const { restored, conflicts } = reconcile(moved);
      expect(conflicts).toEqual([]);
      expect(restored).toEqual([SOURCE_REL]);
      expect(readFileSync(path.join(moved, SOURCE_REL))).toEqual(Buffer.from(ORIGINAL_TEXT));
    } finally {
      rmSync(moved, { recursive: true, force: true });
      root = seedRepo(); // afterEach needs something to remove
    }
  });

  // ---- test-plan #E7 --------------------------------------------------------
  it("is silent on a clean start, journal absent or empty", () => {
    expect(existsSync(journalDir(root))).toBe(false);
    expect(reconcile(root)).toEqual({ restored: [], skipped: [], conflicts: [] });

    mkdirSync(journalDir(root), { recursive: true });
    expect(reconcile(root)).toEqual({ restored: [], skipped: [], conflicts: [] });
    // And it does not throw when driven through the vitest globalSetup entry.
    expect(() => globalSetup({ repoRoot: root })).not.toThrow();
  });

  // ---- test-plan #E8 --------------------------------------------------------
  it("refuses a second concurrent run rather than interleaving", () => {
    const { original, mutated } = prepareMutation(root, MUTATION);
    writeJournalEntry(root, SOURCE_REL, original, mutated);
    const before = readFileSync(sourcePath(root));

    expect(() => beginMutation(root, MUTATION)).toThrow(/already has an entry/);

    expect(entries(root)).toHaveLength(1);
    expect(readFileSync(sourcePath(root))).toEqual(before);
  });

  // ---- test-plan #X1 --------------------------------------------------------
  it("recovers a file left mutated by SIGKILL", async () => {
    const child = await spawnChildMidMutation(root);
    child.kill("SIGKILL");
    await waitForExit(child);

    // Precondition: the residue is real, the `finally` did not save us.
    expect(readFileSync(sourcePath(root), "utf8")).toContain("/* mutated: gone */");
    expect(entries(root)).toHaveLength(1);

    const { restored, conflicts } = reconcile(root);

    expect(conflicts).toEqual([]);
    expect(restored).toEqual([SOURCE_REL]);
    expect(readFileSync(sourcePath(root))).toEqual(Buffer.from(ORIGINAL_TEXT));
  }, 30_000);

  // ---- test-plan #X2 --------------------------------------------------------
  it("restores uncommitted edits, not the committed version", () => {
    const uncommitted = "export const x = 1; // KEEP_ME\n// work in progress\n";
    writeFileSync(sourcePath(root), uncommitted);

    leaveResidue(root);
    expect(readFileSync(sourcePath(root), "utf8")).not.toBe(uncommitted);

    reconcile(root);

    // The pre-mutation bytes INCLUDING the unstaged edit — a `git checkout --`
    // would have silently destroyed that line.
    expect(readFileSync(sourcePath(root), "utf8")).toBe(uncommitted);
  });

  // ---- test-plan #X3 --------------------------------------------------------
  it("refuses to overwrite a file that changed after the kill", () => {
    const { entryPath } = leaveResidue(root);
    const handFixed = "export const x = 1; // hand-fixed by a human\n";
    writeFileSync(sourcePath(root), handFixed);

    const { restored, conflicts } = reconcile(root);

    expect(restored).toEqual([]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].path).toBe(SOURCE_REL);
    expect(readFileSync(sourcePath(root), "utf8")).toBe(handFixed);
    expect(existsSync(entryPath)).toBe(true);
    expect(() => globalSetup({ repoRoot: root })).toThrow();
  });

  // ---- test-plan #X4 --------------------------------------------------------
  it("names the entry and both unblock routes in a conflict report", () => {
    const { entryPath } = leaveResidue(root);
    writeFileSync(sourcePath(root), "third distinct content\n");

    const report = formatConflicts(reconcile(root).conflicts);

    expect(report).toContain(entryPath);
    expect(report).toMatch(/restore the file/i);
    expect(report).toMatch(/delete the entry/i);
    expect(report).toContain(`rm ${entryPath}`);
  });

  // ---- test-plan #X5 --------------------------------------------------------
  it("treats an unreadable entry as a conflict and keeps it", () => {
    mkdirSync(journalDir(root), { recursive: true });
    const invalid = path.join(journalDir(root), "invalid.json");
    const incomplete = path.join(journalDir(root), "incomplete.json");
    writeFileSync(invalid, "not json at all");
    writeFileSync(incomplete, JSON.stringify({ path: SOURCE_REL, originalBytes: "AA==" }));

    const { restored, conflicts } = reconcile(root);

    expect(restored).toEqual([]);
    expect(conflicts).toHaveLength(2);
    expect(existsSync(invalid)).toBe(true);
    expect(existsSync(incomplete)).toBe(true);
    expect(readFileSync(sourcePath(root))).toEqual(Buffer.from(ORIGINAL_TEXT));
  });

  // ---- test-plan #X6 --------------------------------------------------------
  it("treats a journaled file that no longer exists as a conflict", () => {
    const { entryPath } = leaveResidue(root);
    rmSync(sourcePath(root));

    const { restored, conflicts } = reconcile(root);

    expect(restored).toEqual([]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].reason).toMatch(/no longer exists/);
    expect(existsSync(sourcePath(root))).toBe(false); // NOT recreated
    expect(existsSync(entryPath)).toBe(true); // NOT dropped
  });

  // ---- test-plan #X7 --------------------------------------------------------
  it("reconciles a kill between journal and source write to a no-op", () => {
    const { original, mutated } = prepareMutation(root, MUTATION);
    const entryPath = writeJournalEntry(root, SOURCE_REL, original, mutated);
    setEntryPid(entryPath, deadPid()); // the run that journaled it is gone
    // Source write never happened — the on-disk file already IS originalBytes.

    const { restored, skipped, conflicts } = reconcile(root);

    expect(restored).toEqual([]);
    expect(skipped).toEqual([]);
    expect(conflicts).toEqual([]);
    expect(existsSync(entryPath)).toBe(false); // entry dropped, nothing to do
    expect(readFileSync(sourcePath(root))).toEqual(Buffer.from(ORIGINAL_TEXT));
  });

  // ---- test-plan #X8 --------------------------------------------------------
  it("throws from globalSetup on a conflict, so no project runs", () => {
    leaveResidue(root);
    writeFileSync(sourcePath(root), "unexpected third state\n");

    // globalSetup is registered at ROOT level (asserted below), and a throw
    // there aborts the whole run before any project executes.
    expect(() => globalSetup({ repoRoot: root })).toThrow(/could not be reconciled/);
  });

  it("registers the reconcile globalSetup at root level, not per-project", () => {
    const repoRoot = path.resolve(here, "../..");
    const rootConfig = readFileSync(path.join(repoRoot, "vitest.config.ts"), "utf8");

    // Root-level is the whole point: a per-project registration would race the
    // other projects' forks instead of preceding them.
    expect(rootConfig).toMatch(
      /globalSetup:\s*\[\s*["']\.\/scripts\/mutation-journal-global-setup\.mjs["']/,
    );
    const scriptsConfig = readFileSync(path.join(repoRoot, "scripts/vitest.config.ts"), "utf8");
    expect(scriptsConfig).not.toContain("mutation-journal-global-setup");
  });

  // ---- test-plan #X9 --------------------------------------------------------
  it("does NOT block the run for a cleanly recoverable entry", () => {
    leaveResidue(root);
    const warnings = [];
    const realWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(" "));

    try {
      expect(() => globalSetup({ repoRoot: root })).not.toThrow();
    } finally {
      console.warn = realWarn;
    }

    // Restored, reported, and the run carries on.
    expect(readFileSync(sourcePath(root))).toEqual(Buffer.from(ORIGINAL_TEXT));
    expect(warnings.join("\n")).toContain(SOURCE_REL);
  });

  // ---- test-plan #X10 -------------------------------------------------------
  it("restores before it returns, so nothing downstream can read mutated bytes", () => {
    leaveResidue(root);
    expect(readFileSync(sourcePath(root), "utf8")).toContain("/* mutated: gone */");

    globalSetup({ repoRoot: root });
    const contentSeenAfterSetup = readFileSync(sourcePath(root), "utf8");

    // globalSetup is synchronous and completes before vitest starts any project,
    // so the first thing any fork can observe is the restored content.
    expect(contentSeenAfterSetup).toBe(ORIGINAL_TEXT);
    expect(contentSeenAfterSetup).not.toContain("mutated");
  });

  // ---- test-plan #X11 -------------------------------------------------------
  it("restores and terminates non-zero on SIGINT, reporting no result", async () => {
    const child = await spawnChildMidMutation(root);
    expect(readFileSync(sourcePath(root), "utf8")).toContain("/* mutated: gone */");

    child.kill("SIGINT");
    const { code } = await waitForExit(child);

    expect(code).toBe(1); // terminated, never resumed
    expect(readFileSync(sourcePath(root))).toEqual(Buffer.from(ORIGINAL_TEXT));
    expect(entries(root)).toHaveLength(0);
  }, 30_000);

  // ---- test-plan #X14 -------------------------------------------------------
  it("refuses a journal entry that resolves outside the repository", () => {
    const outside = path.join(os.tmpdir(), `mut-outside-${process.pid}.txt`);
    const sacred = "do not touch me\n";
    writeFileSync(outside, sacred);

    try {
      mkdirSync(journalDir(root), { recursive: true });
      const escaping = path.relative(root, outside); // ../../..-style
      writeFileSync(
        path.join(journalDir(root), "escape.json"),
        JSON.stringify({
          version: 1,
          path: escaping,
          pid: deadPid(),
          originalBytes: Buffer.from("pwned").toString("base64"),
          mutatedBytes: Buffer.from(sacred).toString("base64"),
        }),
      );

      const { restored, conflicts } = reconcile(root);

      // Without containment this is a write of "pwned" over a file outside the tree.
      expect(restored).toEqual([]);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].reason).toMatch(/outside the repository/);
      expect(readFileSync(outside, "utf8")).toBe(sacred);
    } finally {
      rmSync(outside, { force: true });
    }
  });

  // ---- test-plan #X13 -------------------------------------------------------
  it("leaves an entry owned by a LIVE process strictly alone", async () => {
    // The regression that caught this: `runTestFile` spawns `npx vitest`, that
    // child loads the ROOT config including this globalSetup, and without an
    // owner check it reconciles the mutation its own parent just applied — the
    // harness then reports every mutation as survived. Same hazard for a plain
    // `npm test` running in another terminal.
    const child = await spawnChildMidMutation(root);
    try {
      const mutatedBytes = readFileSync(sourcePath(root));
      expect(mutatedBytes.toString("utf8")).toContain("/* mutated: gone */");

      const { restored, skipped, conflicts } = reconcile(root);

      expect(restored).toEqual([]);
      expect(conflicts).toEqual([]);
      expect(skipped).toEqual([SOURCE_REL]);
      // Untouched: the live run still owns this file and its entry.
      expect(readFileSync(sourcePath(root))).toEqual(mutatedBytes);
      expect(entries(root)).toHaveLength(1);
      // And a run must not be blocked by someone else's in-flight work.
      expect(() => globalSetup({ repoRoot: root })).not.toThrow();
    } finally {
      child.kill("SIGKILL");
      await waitForExit(child);
    }
  }, 30_000);

  // ---- test-plan #X12 -------------------------------------------------------
  it("keeps the existing finally restore when the runner throws", () => {
    expect(() =>
      verifyTeeth(
        root,
        { test: "fake", mutations: [MUTATION] },
        {
          runner: () => {
            throw new Error("runner exploded");
          },
        },
      ),
    ).toThrow(/runner exploded/);

    // The journal is ADDITIVE — the thrown-error path still works unchanged.
    expect(readFileSync(sourcePath(root))).toEqual(Buffer.from(ORIGINAL_TEXT));
    expect(entries(root)).toHaveLength(0);
  });
});
