/**
 * The slow-git shim really slows a git invoked through the shared runner.
 * Task 1.1 of harden-plugin-cwd-admission: verifies the runner resolves `git`
 * through the (rescannable) registry, so a shimmed PATH takes effect in-process.
 */
import { afterAll, describe, expect, it } from "vitest";
import { checkoutRootsAsync } from "../../platform/git.js";
import { buildGitFixtures } from "../git-fixtures.js";
import { cleanupGitShims, makeSlowGitShim, resolveRealGit, useGitPath } from "../git-shim.js";

afterAll(cleanupGitShims);

describe("makeSlowGitShim", () => {
  it.skipIf(process.platform === "win32")("a shimmed git rev-parse takes at least the delay and still answers", async () => {
    const fx = buildGitFixtures();
    try {
      const shim = makeSlowGitShim(300, resolveRealGit());
      const restore = useGitPath(shim);
      try {
        const t0 = Date.now();
        const roots = await checkoutRootsAsync({ cwd: fx.normal });
        // Phase 1 runs three probes in parallel, each ≥ 300 ms.
        expect(Date.now() - t0).toBeGreaterThanOrEqual(290);
        expect(roots?.mainCheckout).toBeTruthy();
      } finally {
        restore();
      }
    } finally {
      fx.cleanup();
    }
  });
});
