// Child process for the cold-populate kill test: runs the extension's cold-start
// populate (`ensurePopulated`) against a cwd and exits when it finishes.
// See change: fix-kb-index-integrity (test-plan X6).
import { createReindexState, ensurePopulated } from "../../reindex.js";

await ensurePopulated(createReindexState(), process.argv[2]);
