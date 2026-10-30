/**
 * Pin the Windows-bundle Node copy step in
 * `packages/electron/scripts/docker-make.sh`.
 *
 * The Windows branch of docker-make.sh used to copy only `node.exe`
 * and `node_modules/`, leaving `npm.cmd` and `npx.cmd` out of the
 * bundled `<app>/resources/node/` directory. As a result `where npm`
 * returned nothing on a fresh Windows install — and the Settings →
 * Pi Ecosystem **Update** button failed with `npm update exited with
 * code 1`. This test greps the script text so the regression cannot
 * land silently.
 *
 * See change: embed-managed-node-runtime (task 1.2).
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import url from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "scripts",
  "docker-make.sh",
);

describe("docker-make.sh Windows bundle", () => {
  const text = fs.readFileSync(SCRIPT_PATH, "utf-8");

  it("copies npm.cmd into $NODE_DIR", () => {
    expect(text).toMatch(
      /cp\s+"\/tmp\/node-\$VERSION-win-\$ARCH\/npm\.cmd"\s+"\$NODE_DIR\/"/,
    );
  });

  it("copies npx.cmd into $NODE_DIR", () => {
    expect(text).toMatch(
      /cp\s+"\/tmp\/node-\$VERSION-win-\$ARCH\/npx\.cmd"\s+"\$NODE_DIR\/"/,
    );
  });

  it("still copies node.exe and node_modules (sanity)", () => {
    expect(text).toMatch(
      /cp\s+"\/tmp\/node-\$VERSION-win-\$ARCH\/node\.exe"\s+"\$NODE_DIR\/"/,
    );
    expect(text).toMatch(
      /cp\s+-r\s+"\/tmp\/node-\$VERSION-win-\$ARCH\/node_modules"\s+"\$NODE_DIR\/"/,
    );
  });
});

/**
 * Canonical node_modules layout (change: slim-windows-install-file-count, E9):
 * the Docker cross-build must ship the same final layout as bundle-server.mjs —
 * workspace source once under node_modules, empty `workspaces`, pruned. It runs the
 * shared helper AFTER its own symlink materialization (which still needs the
 * `packages/<dir>` link targets).
 */
describe("docker-make.sh canonical layout", () => {
  const text = fs.readFileSync(SCRIPT_PATH, "utf-8");

  it("calls the shared prune helper with --finalize after the symlink materialization", () => {
    const materialized = text.indexOf("Replaced symlink");
    const finalize = text.search(/node\s+"\/build\/\$ELECTRON_DIR\/scripts\/lib\/prune-bundle\.mjs"\s+--finalize/);
    expect(materialized).toBeGreaterThan(-1);
    expect(finalize).toBeGreaterThan(materialized);
  });

  it("does not leave a second hand-rolled prune behind", () => {
    expect(text).not.toMatch(/find\s+node_modules[^\n]*-name\s+['"]?\*\.d\.ts/);
  });

  it("finalizes before the Windows/Linux branches consume the tree", () => {
    const finalize = text.indexOf("prune-bundle.mjs");
    expect(finalize).toBeGreaterThan(-1);
    expect(finalize).toBeLessThan(text.indexOf('if [ "$PLATFORM" = "linux" ]; then\n  cd "$ELECTRON_DIR"'));
  });
});
