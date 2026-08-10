/**
 * Root-level vitest `globalSetup`: recover whatever a killed mutation-harness
 * run left on disk, BEFORE any test project starts.
 *
 * Why root-level and not inside the mutation test file: `test.projects` run
 * concurrently (`pool: "forks"`), so a project like `packages/extension` would
 * load `prompt-bus.ts` — possibly the MUTATED bytes — before the `scripts` fork
 * ever reached a reconcile of its own, and the restoring write could race a
 * concurrent module read. Only a global setup is upstream of every project.
 *
 * Why it throws rather than exits: the harness is a library imported by a test
 * file and has no exit of its own. A throw here aborts the whole run, which is
 * the point — a failing `it` would not stop the other projects.
 *
 * Fail-closed line is AMBIGUITY, not residue:
 *   nothing to do        -> silent
 *   cleanly restored     -> report loudly, RUN PROCEEDS (the tree is known-good
 *                           again, and it is known-good before anything loads)
 *   conflict / unreadable-> THROW, nothing runs at all
 *
 * See change: harden-mutation-harness-restore.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatConflicts, reconcile } from "./mutation-harness.mjs";

const defaultRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @param {{ repoRoot?: string }} [ctx] vitest passes its own context; `repoRoot`
 *        is an override seam for tests, which must never reconcile the real tree.
 */
export default function setup(ctx = {}) {
  const repoRoot = ctx.repoRoot ?? defaultRepoRoot;
  const { restored, conflicts } = reconcile(repoRoot);

  if (restored.length > 0) {
    // Loud even though the run continues: a previous run died mid-mutation and
    // that is something the operator needs to know about.
    console.warn(
      `\n[mutation-journal] restored ${restored.length} file(s) left mutated by a killed harness run:`,
    );
    for (const p of restored) console.warn(`  - ${p}`);
    console.warn("");
  }

  if (conflicts.length > 0) {
    throw new Error(formatConflicts(conflicts));
  }
}
