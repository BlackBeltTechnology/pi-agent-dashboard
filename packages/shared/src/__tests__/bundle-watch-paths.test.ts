/**
 * `packages/electron/scripts/bundle-watch-paths.mjs` derives the local bundle
 * freshness watch set (bundle workspaces + bundled plugins + server manifest +
 * built client + bundler) so `build-installer.sh` never re-hardcodes it.
 * See change: bundle-plugin-third-party-deps (design D6; test-plan #E23).
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process"; // ban:child_process-ok — runs the script under test
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const SCRIPT = path.join(REPO_ROOT, "packages", "electron", "scripts", "bundle-watch-paths.mjs");

describe("bundle-watch-paths.mjs (E23)", () => {
  it("prints the derived watch set, one repo-relative path per line", () => {
    const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    const lines = r.stdout.trim().split("\n");
    for (const expected of [
      "packages/gmail-plugin/package.json",
      "packages/gmail-plugin/src",
      "packages/client-utils/src",
      "packages/client-utils/package.json",
      "packages/server/package.json",
      "packages/dist/index.html",
      "packages/electron/scripts/bundle-server.mjs",
    ]) {
      expect(lines).toContain(expected);
    }
    expect(new Set(lines).size).toBe(lines.length);
  });
});
