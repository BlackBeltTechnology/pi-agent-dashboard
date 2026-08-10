/**
 * Scripted mutation harness for the promise-rule ladder (test-plan #X15).
 *
 * The ladder's highest-likelihood failure is invisible in a green run: a fix
 * that removes a `noFloatingPromises` diagnostic while ALSO removing the test's
 * teeth. Adding `await` to a fire-then-assert test, or settling a promise the
 * wrong way, can make a test pass while it proves strictly less than before.
 *
 * A passing test suite cannot detect that. Mutation can: break a behaviour the
 * test covers and the test MUST go red. A test file that stays green under
 * mutation is not protecting anything.
 *
 * No mutation tooling exists in this repo (no Stryker), and pulling one in for
 * a handful of files is disproportionate — hence this small, explicit,
 * manifest-driven runner. It is deliberately reusable by later ladder rungs:
 * add entries to a manifest, not code.
 *
 * CRASH SAFETY — read before changing the write path.
 *
 * This file writes broken code into REAL tracked source files. The `finally` in
 * `verifyTeeth` restores them, which is correct for a *thrown* error and does
 * nothing for a *dead process*: `finally` never runs when the process is killed
 * without unwinding (SIGKILL, OOM kill, an outer timeout, a sleeping machine).
 * That is not hypothetical — it left mutations on disk across two worktrees for
 * ~4.5 hours.
 *
 * So every mutation is journaled to `.mutation-journal/` BEFORE the source file
 * is written, and `reconcile()` recovers leftovers at the start of the next run
 * (wired as a root-level vitest `globalSetup`, so it completes before any test
 * project can load a mutated file). The journal is the backstop; the `finally`
 * and the SIGINT/SIGTERM handler are only fast paths.
 *
 * Durability promised: survives PROCESS death (the writes have returned and are
 * in the page cache). NOT power-loss durable — there is no `fsync` here, by
 * decision, because power loss is outside the failure set this guards.
 *
 * Single writer: one harness run per working tree at a time. Two concurrent
 * runs would restore each other's mutations and reproduce the exact residue
 * this guards against, so a second run that finds an existing entry for a file
 * it is about to mutate REFUSES (see `writeJournalEntry`).
 *
 * OWNERSHIP — why entries carry a pid. `runTestFile` spawns `npx vitest`, and
 * that child loads the ROOT vitest config, `globalSetup` included. Without an
 * owner check the child would reconcile the mutation its own parent just
 * applied, run the test against restored code, and report every mutation as
 * survived — the harness silently losing its teeth. The same hazard exists for
 * an unrelated `npm test` in another terminal. So an entry whose owning process
 * is still ALIVE is in-flight work, not residue, and reconciliation leaves it
 * strictly alone.
 *
 * See change: cleanup-async-semantics-server-extension.
 * See change: harden-mutation-harness-restore.
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @typedef {object} Mutation
 * @property {string} name        human-readable description of the broken behaviour
 * @property {string} source      repo-relative production file to mutate
 * @property {string} find        exact substring to replace (must occur exactly once)
 * @property {string} replace     replacement that breaks the covered behaviour
 */

/**
 * @typedef {object} MutationTarget
 * @property {string} test        repo-relative test file that must go red
 * @property {Mutation[]} mutations
 */

/** Directory holding one journal entry file per in-flight mutation. */
export const JOURNAL_DIRNAME = ".mutation-journal";

/** @param {string} repoRoot */
export function journalDir(repoRoot) {
  return path.join(repoRoot, JOURNAL_DIRNAME);
}

/**
 * Entry filename for a source path. Deterministic, so a second concurrent run
 * mutating the same file collides on the same name — which is what makes the
 * refusal in `writeJournalEntry` possible at all.
 */
function entryFileName(sourceRel) {
  const digest = crypto.createHash("sha256").update(sourceRel).digest("hex").slice(0, 16);
  return `${path.basename(sourceRel)}.${digest}.json`;
}

/**
 * Resolve a mutation WITHOUT touching disk: read the file, assert the anchor is
 * unambiguous, and compute the mutated bytes.
 *
 * Split out of the write path on purpose. "Killed between the journal write and
 * the source write" is a real state with a required behaviour, and it cannot be
 * tested by racing a kill against two adjacent synchronous writes — so the two
 * writes are separately callable.
 *
 * Bytes are `Buffer`s end to end: restoration must be byte-exact, and a utf8
 * round trip is not (a BOM or an invalid sequence would not survive it).
 */
export function prepareMutation(repoRoot, mutation) {
  const abs = path.join(repoRoot, mutation.source);
  const original = fs.readFileSync(abs);
  const text = original.toString("utf8");
  const occurrences = text.split(mutation.find).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `mutation "${mutation.name}": anchor occurs ${occurrences} times in ${mutation.source} (need exactly 1). ` +
        `The harness refuses to guess — update the anchor.`,
    );
  }
  const mutated = Buffer.from(text.replace(mutation.find, mutation.replace), "utf8");
  return { abs, original, mutated };
}

/**
 * Record a mutation so a killed process can be recovered from.
 *
 * MUST be called before the source file is written — that ordering is the whole
 * mechanism. Written temp-then-`linkSync`: one entry file per mutation, created
 * exclusively, appearing atomically.
 *
 * Why not one shared journal file? It would be rewritten while an EARLIER
 * mutation is still live on disk, so a kill during that rewrite would destroy
 * the recovery data of an already-broken file — this bug, one layer down.
 *
 * @returns {string} absolute path of the entry file
 */
export function writeJournalEntry(repoRoot, sourceRel, originalBuf, mutatedBuf) {
  const dir = journalDir(repoRoot);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, entryFileName(sourceRel));
  const payload = `${JSON.stringify(
    {
      version: 1,
      // Repo-relative: an absolute path would not survive `git worktree move`.
      path: sourceRel,
      // Owner. While this pid lives, the mutation is in-flight and off limits
      // to reconciliation — including reconciliation running inside this very
      // process's own `npx vitest` child.
      pid: process.pid,
      originalBytes: originalBuf.toString("base64"),
      mutatedBytes: mutatedBuf.toString("base64"),
    },
    null,
    2,
  )}\n`;
  const tmp = `${target}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.writeFileSync(tmp, payload);
  try {
    // linkSync fails with EEXIST rather than clobbering, and publishes a file
    // that is already complete. rename() would silently overwrite.
    fs.linkSync(tmp, target);
  } catch (err) {
    if (err?.code === "EEXIST") {
      throw new Error(
        `mutation journal: ${sourceRel} already has an entry (${target}).\n` +
          `Another harness run is mutating this tree, or a previous run died and has not been reconciled.\n` +
          `The harness refuses to interleave — two runs restoring each other's mutations is the residue this guards against.`,
      );
    }
    throw err;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  return target;
}

/**
 * Mutations currently applied to disk by THIS process, so a catchable signal
 * can put them back. Not the backstop — the journal is.
 */
const activeMutations = new Set();
let signalHandlersInstalled = false;

function onInterrupt() {
  for (const handle of activeMutations) {
    try {
      fs.writeFileSync(handle.abs, handle.original);
      fs.rmSync(handle.entryPath, { force: true });
    } catch {
      // The journal still holds the entry; the next run reconciles it.
    }
  }
  activeMutations.clear();
  // Restore and DIE. Resuming would run the in-flight check against a restored
  // file and report the mutation as survived — a false negative manufactured by
  // the safety mechanism itself.
  process.exit(1);
}

function activate(handle) {
  activeMutations.add(handle);
  if (!signalHandlersInstalled) {
    process.on("SIGINT", onInterrupt);
    process.on("SIGTERM", onInterrupt);
    signalHandlersInstalled = true;
  }
}

function deactivate(handle) {
  activeMutations.delete(handle);
  if (activeMutations.size === 0 && signalHandlersInstalled) {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onInterrupt);
    signalHandlersInstalled = false;
  }
}

/**
 * Journal a mutation, then apply it. Ordering is load-bearing.
 * @returns {{abs: string, original: Buffer, entryPath: string}} pass to `endMutation`
 */
export function beginMutation(repoRoot, mutation) {
  const { abs, original, mutated } = prepareMutation(repoRoot, mutation);
  const entryPath = writeJournalEntry(repoRoot, mutation.source, original, mutated);
  fs.writeFileSync(abs, mutated);
  const handle = { abs, original, entryPath };
  activate(handle);
  return handle;
}

/** Restore the file and drop its journal entry. */
export function endMutation(handle) {
  fs.writeFileSync(handle.abs, handle.original);
  fs.rmSync(handle.entryPath, { force: true });
  deactivate(handle);
}

/**
 * Is the process that created a journal entry still running?
 *
 * `kill(pid, 0)` sends no signal and only probes existence. EPERM means the pid
 * exists but belongs to another user — still alive, so still hands-off.
 *
 * Pid reuse can make a dead owner look alive. The consequence is benign: that
 * entry is skipped for this run and reconciled on a later one, once the pid no
 * longer resolves. Erring toward "skip" is the safe direction — the failure it
 * avoids is destroying a live mutation.
 */
function ownerAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false; // no owner recorded === residue
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

/**
 * Recover whatever a previous run left behind.
 *
 * Entries owned by a LIVE process are skipped outright — see OWNERSHIP in the
 * file header. For the rest, a three-way compare, because the file may
 * legitimately have moved on:
 *
 *   on-disk === mutatedBytes   -> restore originalBytes (the residue case)
 *   on-disk === originalBytes  -> drop the entry (already restored, or the kill
 *                                 landed between journal and source write)
 *   anything else / missing    -> CONFLICT: touch nothing, keep the entry
 *
 * The conflict row is the important one. Someone may have hand-fixed the file
 * between the kill and now; writing originalBytes over that would clobber real
 * work, and this whole change exists to avoid destroying uncommitted work.
 *
 * @returns {{restored: string[], skipped: string[], conflicts: {entry: string, path: string|null, reason: string}[]}}
 */
export function reconcile(repoRoot) {
  const dir = journalDir(repoRoot);
  const restored = [];
  const skipped = [];
  const conflicts = [];
  let names;
  try {
    names = fs
      .readdirSync(dir)
      .filter((n) => n.endsWith(".json"))
      .sort();
  } catch {
    return { restored, skipped, conflicts }; // absent journal === nothing to do
  }

  for (const name of names) {
    const entryPath = path.join(dir, name);
    const verdict = reconcileEntry(repoRoot, entryPath);
    if (verdict.kind === "restored") restored.push(verdict.path);
    else if (verdict.kind === "skipped") skipped.push(verdict.path);
    else if (verdict.kind === "conflict") conflicts.push(verdict.conflict);
    // "resolved" === entry dropped, nothing to report
  }
  return { restored, skipped, conflicts };
}

/**
 * Decide and enact the fate of ONE journal entry.
 * @returns {{kind: "restored"|"skipped"|"resolved", path?: string}
 *          |{kind: "conflict", conflict: {entry: string, path: string|null, reason: string}}}
 */
function reconcileEntry(repoRoot, entryPath) {
  const conflict = (p, reason) => ({ kind: "conflict", conflict: { entry: entryPath, path: p, reason } });

  let entry;
  try {
    entry = JSON.parse(fs.readFileSync(entryPath, "utf8"));
    if (
      typeof entry?.path !== "string" ||
      typeof entry?.originalBytes !== "string" ||
      typeof entry?.mutatedBytes !== "string"
    ) {
      throw new Error("missing required fields");
    }
  } catch (err) {
    // Never delete an entry we cannot read: it may be the only record that a
    // file is still mutated.
    return conflict(null, `journal entry is unreadable (${err.message})`);
  }

  // Containment BEFORE any write. `path.join(repoRoot, "../../etc/thing")`
  // escapes the tree, and reconciliation's whole job is to overwrite the file
  // it resolves — so a corrupted or hand-edited entry could clobber anything the
  // user can write. Type-checking `entry.path` above says nothing about where
  // it points.
  const abs = path.resolve(repoRoot, entry.path);
  const rel = path.relative(repoRoot, abs);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    return conflict(entry.path, "journal entry resolves outside the repository — refusing to touch it");
  }

  if (ownerAlive(entry.pid)) {
    // In-flight, not residue. Touching it would corrupt a running harness.
    return { kind: "skipped", path: entry.path };
  }

  const original = Buffer.from(entry.originalBytes, "base64");
  const mutated = Buffer.from(entry.mutatedBytes, "base64");

  let onDisk;
  try {
    onDisk = fs.readFileSync(abs);
  } catch {
    return conflict(
      entry.path,
      "the journaled file no longer exists — refusing to recreate a file that was deliberately removed",
    );
  }

  if (onDisk.equals(mutated)) {
    fs.writeFileSync(abs, original);
    fs.rmSync(entryPath, { force: true });
    return { kind: "restored", path: entry.path };
  }
  if (onDisk.equals(original)) {
    fs.rmSync(entryPath, { force: true });
    return { kind: "resolved" };
  }
  return conflict(entry.path, "on-disk content matches neither the mutated nor the pre-mutation bytes");
}

/**
 * Render conflicts with their unblock path.
 *
 * A conflict blocks every run until a human clears it, so the message has to
 * say how — otherwise the safe behaviour is indistinguishable from a brick.
 */
export function formatConflicts(conflicts) {
  const lines = [
    `mutation journal: ${conflicts.length} entr${conflicts.length === 1 ? "y" : "ies"} could not be reconciled.`,
    "",
    "A previous mutation-harness run died and the tree is now of unknown provenance,",
    "so no test can be trusted against it.",
    "",
  ];
  for (const c of conflicts) {
    lines.push(`  ${c.path ?? "(path unknown)"}`);
    lines.push(`    ${c.reason}`);
    lines.push(`    entry: ${c.entry}`);
  }
  lines.push("");
  lines.push("To unblock, either:");
  lines.push("  1. restore the file by hand to one of the two byte sequences recorded in its");
  lines.push("     entry (originalBytes / mutatedBytes are base64 in the JSON), or");
  lines.push("  2. delete the entry to accept the file's current content as intentional:");
  for (const c of conflicts) {
    lines.push(`       rm ${c.entry}`);
  }
  return lines.join("\n");
}

/**
 * Run one test file. Returns true when it PASSES.
 *
 * HOME/localstorage isolation mirrors the root `npm test` script — without it
 * suites clobber each other's `~/.pi` state and the result is meaningless.
 */
export function runTestFile(repoRoot, testFile, { timeoutMs = 180_000 } = {}) {
  const home = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR ?? "/tmp"), "pi-mut-"));
  try {
    execFileSync("npx", ["vitest", "run", testFile], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        HOME: home,
        NODE_OPTIONS: `--localstorage-file=${path.join(home, "ls")}`,
      },
    });
    return true;
  } catch {
    return false; // non-zero exit === at least one failing test
  } finally {
    // One temp HOME per invocation, and this harness runs many of them — clean
    // up rather than leaving a pile behind in TMPDIR.
    try {
      fs.rmSync(home, { recursive: true, force: true });
    } catch {
      // Best effort: a leftover temp dir must never fail the check.
    }
  }
}

/**
 * Verify a test file has teeth: under every mutation it must go RED.
 *
 * @returns {{ mutation: string, survived: boolean }[]} one row per mutation;
 *          `survived: true` means the test stayed green — a harness FAILURE.
 */
export function verifyTeeth(repoRoot, target, opts = {}) {
  const { runner = runTestFile, ...runOpts } = opts;
  const results = [];
  for (const mutation of target.mutations) {
    const handle = beginMutation(repoRoot, mutation);
    let passedUnderMutation;
    try {
      passedUnderMutation = runner(repoRoot, target.test, runOpts);
    } finally {
      // Always restore, even if the runner threw — a mutated tree left on disk
      // is far worse than a failed check. This is the FAST path; a process that
      // dies without unwinding is recovered from the journal instead.
      endMutation(handle);
    }
    results.push({ mutation: mutation.name, survived: passedUnderMutation });
  }
  return results;
}

// `node scripts/mutation-harness.mjs --reconcile` — the unblock path, outside
// vitest, for when a conflict is blocking the whole suite.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--reconcile")) {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const { restored, conflicts } = reconcile(root);
    for (const p of restored) console.log(`restored ${p}`);
    if (conflicts.length > 0) {
      console.error(formatConflicts(conflicts));
      process.exit(1);
    }
    console.log(restored.length > 0 ? `reconciled ${restored.length} file(s)` : "nothing to reconcile");
  } else {
    console.error("usage: node scripts/mutation-harness.mjs --reconcile");
    process.exit(2);
  }
}
