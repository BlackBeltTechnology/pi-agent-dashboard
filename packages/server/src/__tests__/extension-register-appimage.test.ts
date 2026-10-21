/**
 * Tests for AppImage guard in findBundledExtension().
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findBundledExtension } from "@blackbelt-technology/pi-dashboard-shared/bridge-register.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("findBundledExtension - AppImage guard", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "appimage-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns extension path for stable install location", () => {
    const extDir = path.join(tmpDir, "packages", "extension");
    fs.mkdirSync(extDir, { recursive: true });
    fs.writeFileSync(path.join(extDir, "package.json"), "{}");

    const result = findBundledExtension(tmpDir);
    expect(result).toBe(extDir);
    expect(result).not.toContain("/tmp/.mount_");
  });

  it("returns null when extension does not exist", () => {
    // Disable Strategy 2 (node-resolver fallback) so this test exercises
    // the AppImage guard path in isolation.
    expect(
      findBundledExtension(tmpDir, { resolvePackage: () => null }),
    ).toBeNull();
  });

  // Note: We can't easily test the /tmp/.mount_ guard with real paths
  // since we'd need to create dirs under /tmp/.mount_PIxxxx.
  // The guard is verified by code inspection and the shared module tests.
});
