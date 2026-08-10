/**
 * Child-process fixture for the mutation-journal crash-safety tests.
 *
 * Applies ONE mutation to a throwaway repoRoot, signals readiness by writing a
 * marker file, then idles with a free event loop so the parent can kill it —
 * `SIGKILL` (uncatchable, exercises the journal) or `SIGINT` (catchable,
 * exercises the handler).
 *
 * The idle must keep the event loop AVAILABLE: a synchronous block would starve
 * the signal handler and the SIGINT case would prove nothing.
 *
 * usage: node mutation-journal-child.mjs <repoRoot> <markerPath>
 *
 * See change: harden-mutation-harness-restore.
 */
import fs from "node:fs";
import { beginMutation } from "../../mutation-harness.mjs";

const [, , repoRoot, markerPath] = process.argv;

beginMutation(repoRoot, {
  name: "child fixture mutation",
  source: "src/target.ts",
  find: "KEEP_ME",
  replace: "/* mutated: gone */",
});

fs.writeFileSync(markerPath, "ready");

// Stay alive, event loop free. The parent kills us.
setInterval(() => {}, 1000);
