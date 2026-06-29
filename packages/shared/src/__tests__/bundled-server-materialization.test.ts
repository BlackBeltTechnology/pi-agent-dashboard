/**
 * Repo-level invariant: every bundled dashboard server present in the
 * workspace MUST materialize the web client at the canonical path that
 * server.ts resolves —
 *   node_modules/@blackbelt-technology/pi-dashboard-web/dist/index.html
 *
 * A `resources/server/` bundle that lacks this path ships an Electron app
 * that logs "No client build found — running in API-only mode" and serves
 * `{"error":"No client build found…"}` for every `/` request. This lint
 * catches a stale or broken committed bundle before it reaches `make`.
 *
 * The build-time guard lives in bundle-server.mjs (post-verify GO/NO-GO);
 * this test is the CI-side net for bundles that already exist on disk.
 *
 * See change: fix-stale-bundled-server-cache (design.md D4).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const MATERIALIZED_REL = path.join(
  "node_modules",
  "@blackbelt-technology",
  "pi-dashboard-web",
  "dist",
  "index.html",
);

// Directories we never descend into when hunting for resources/server.
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  ".worktrees",
  "out",
]);

/**
 * Walk the workspace for `resources/server` directories. Bounded: prunes
 * node_modules/.git and does not recurse into a found bundle.
 */
function findServerBundles(root: string): string[] {
  const found: string[] = [];
  const stack: string[] = [root];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(cur, e.name);
      if (e.name === "server" && path.basename(cur) === "resources") {
        found.push(full);
        continue; // do not descend into the bundle
      }
      if (SKIP_DIRS.has(e.name)) continue;
      stack.push(full);
    }
  }
  return found;
}

describe("bundled-server materialization", () => {
  const bundles = findServerBundles(REPO_ROOT);

  it("discovers zero or more resources/server bundles without throwing", () => {
    expect(Array.isArray(bundles)).toBe(true);
  });

  // One assertion per discovered bundle. When no bundle is committed (the
  // common case — bundles are build artifacts), this suite is a no-op pass.
  for (const bundle of bundles) {
    const rel = path.relative(REPO_ROOT, bundle);
    it(`materializes pi-dashboard-web in ${rel}`, () => {
      const target = path.join(bundle, MATERIALIZED_REL);
      const present = fs.existsSync(target);
      expect(
        present,
        `Stale/broken bundle: ${rel} is missing ${MATERIALIZED_REL}. ` +
          `Re-run packages/electron/scripts/bundle-server.mjs or ` +
          `rm -rf ${rel} to force a clean rebundle.`,
      ).toBe(true);
    });
  }
});
