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
 * See change: cleanup-async-semantics-server-extension.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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

/**
 * Apply `find`->`replace` in a file, asserting the anchor is unambiguous.
 * Returns the original contents so the caller can restore.
 */
function applyMutation(repoRoot, mutation) {
  const abs = path.join(repoRoot, mutation.source);
  const original = fs.readFileSync(abs, "utf8");
  const occurrences = original.split(mutation.find).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `mutation "${mutation.name}": anchor occurs ${occurrences} times in ${mutation.source} (need exactly 1). ` +
        `The harness refuses to guess — update the anchor.`,
    );
  }
  fs.writeFileSync(abs, original.replace(mutation.find, mutation.replace));
  return { abs, original };
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
  const results = [];
  for (const mutation of target.mutations) {
    const { abs, original } = applyMutation(repoRoot, mutation);
    let passedUnderMutation;
    try {
      passedUnderMutation = runTestFile(repoRoot, target.test, opts);
    } finally {
      // Always restore, even if the runner threw — a mutated tree left on disk
      // is far worse than a failed check.
      fs.writeFileSync(abs, original);
    }
    results.push({ mutation: mutation.name, survived: passedUnderMutation });
  }
  return results;
}
