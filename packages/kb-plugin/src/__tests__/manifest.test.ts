/**
 * Manifest validation for the kb-plugin `pi-dashboard-plugin` block.
 * Covers task 0.1 (registers with valid claims) + 3.4 (claim in manifest).
 * See change: add-kb-folder-slot.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";
import { validateManifest } from "../../../dashboard-plugin-runtime/src/manifest-validator.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const pkgPath = path.resolve(here, "..", "..", "package.json");

describe("kb-plugin manifest", () => {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
  const manifest = pkg["pi-dashboard-plugin"] as Record<string, unknown> | undefined;

  it("has a pi-dashboard-plugin block", () => {
    expect(manifest).toBeDefined();
  });

  it("validates against the loader's validator", () => {
    expect(() => validateManifest(manifest, "kb")).not.toThrow();
  });

  it("plugin id is `kb` with client + server entries", () => {
    const v = validateManifest(manifest, "kb");
    expect(v.id).toBe("kb");
    expect(v.server).toBeTruthy();
    expect(v.client).toBeTruthy();
  });

  it("declares the folder-section + worktree-card-section + KB settings overlay claims", () => {
    const v = validateManifest(manifest, "kb");
    expect(v.claims.map((c) => c.slot).sort()).toEqual([
      "shell-overlay-route",
      "sidebar-folder-section",
      "worktree-card-section",
    ]);
    const overlay = v.claims.find((c) => c.slot === "shell-overlay-route") as { path?: string; component: string };
    expect(overlay.path).toBe("/folder/:encodedCwd/kb");
    expect(overlay.component).toBe("KbSettingsClaim");
    const section = v.claims.find((c) => c.slot === "sidebar-folder-section");
    expect(section?.component).toBe("FolderKbSection");
    // Worktree cards reuse FolderKbSection, scoped to the worktree's own cwd.
    // See change: kb-row-on-worktree-session-card.
    const worktreeSection = v.claims.find((c) => c.slot === "worktree-card-section");
    expect(worktreeSection?.component).toBe("FolderKbSection");
  });
});
