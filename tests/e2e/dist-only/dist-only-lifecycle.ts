import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "..", "..", "..");
/** Written by global-setup, read by global-teardown: { prefix, binDir, port } (absent when attached). */
export const DIST_ONLY_MARKER = path.join(REPO_ROOT, ".pi-test-dist-only.json");
export const CANARY_ID = "runtime-canary";
