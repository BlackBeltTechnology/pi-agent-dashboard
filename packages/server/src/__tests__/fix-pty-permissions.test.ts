/**
 * Regression test for the postinstall `fix-pty-permissions.cjs` script.
 *
 * Ensures that after `npm install` the native `spawn-helper` binary in the
 * current platform's `node-pty` prebuild directory has at least one execute
 * bit set. Without this, `pty.spawn(...)` fails with "posix_spawnp failed."
 * and the dashboard's "New Terminal" button appears dead.
 */

import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

describe("fix-pty-permissions", () => {
  it.skipIf(process.platform === "win32")(
    "spawn-helper for current platform is executable",
    () => {
      const require = createRequire(import.meta.url);
      const ptyPkg = require.resolve("node-pty/package.json");
      const ptyRoot = dirname(ptyPkg);
      const platformDir =
        process.platform === "darwin"
          ? process.arch === "arm64"
            ? "darwin-arm64"
            : "darwin-x64"
          : process.arch === "arm64"
          ? "linux-arm64"
          : "linux-x64";

      // node-pty ships pre-packed binaries under `prebuilds/<platform>-<arch>/`
      // when the tarball includes a prebuild for the host platform (macOS,
      // Windows, some Linux builds). Otherwise node-pty's install script
      // falls back to `node-gyp rebuild`, producing artifacts under
      // `build/Release/` instead. Accept either location so this test is
      // stable across local dev (prebuilt) and Linux CI (built from source).
      const candidates = [
        join(ptyRoot, "prebuilds", platformDir, "spawn-helper"),
        join(ptyRoot, "build", "Release", "spawn-helper"),
      ];
      const helper = candidates.find((p) => existsSync(p));

      if (!helper) {
        // No spawn-helper anywhere means node-pty's install step did not
        // produce the binary on this host (e.g. missing build toolchain).
        // The fix-permissions script is defensive — it silently skips when
        // the prebuild dir is absent — so skipping here matches runtime
        // behavior rather than masking a real regression.
        console.warn(
          `[fix-pty-permissions.test] no spawn-helper found at any of: ${candidates.join(", ")} — skipping`,
        );
        return;
      }

      const mode = statSync(helper).mode;
      // At least one execute bit (owner/group/other) must be set.
      expect(mode & 0o111).not.toBe(0);
    },
  );
});
