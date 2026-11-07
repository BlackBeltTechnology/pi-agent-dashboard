/**
 * The build-time pi-shell resolution gate: pure helpers + the non-win32 no-op
 * (the win32 legs run the real gate in CI — _electron-build.yml, test-plan X5–X9).
 *
 * See change: fix-windows-bundled-bash-exe (design D4),
 * update-pi-core-1-5-adopt-apis (test-plan #X7: the replica the gate imports is
 * `SystemRoot`-aware and still resolves the bundled bash, not the launcher).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePiShell } from "@blackbelt-technology/pi-dashboard-shared/platform/resolve-pi-shell.js";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs module, no type declarations by design.
import { bundleLayout, normWin } from "../../scripts/assert-bundled-bash-resolvable.mjs";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/assert-bundled-bash-resolvable.mjs");

describe("assert-bundled-bash-resolvable", () => {
  it("normWin compares case/separator/trailing-slash insensitively", () => {
    expect(normWin("C:/Res/Git/bin/x.exe")).toBe(normWin("c:\\res\\git\\BIN\\x.exe\\"));
  });

  it("bundleLayout points at the shipped jiti, pi dist and shared platform helpers", () => {
    const l = bundleLayout(path.join("R", "resources"));
    expect(l.gitDir).toBe(path.join("R", "resources", "git"));
    expect(l.jitiDir).toBe(path.join("R", "resources", "server", "node_modules", "jiti"));
    expect(l.piEntry).toContain(path.join("@earendil-works", "pi-coding-agent", "dist", "index.js"));
    expect(l.helpers.resolvePiShell).toMatch(/pi-dashboard-shared[\\/]src[\\/]platform[\\/]resolve-pi-shell\.ts$/);
  });

  it.skipIf(process.platform === "win32")("X10: exits 0 without probing on non-win32", () => {
    const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", env: { ...process.env, BUNDLE_RESOURCES_DIR: "/nonexistent" } });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("not win32");
  });

  it("X7: with SystemRoot=D:\\WINNT the bundled usr\\bin\\bash.exe resolves and is not the launcher", () => {
    const bundled = path.win32.join("C:\\res", "git", "usr", "bin", "bash.exe");
    const launcher = "D:\\WINNT\\System32\\bash.exe";
    const present = new Set([bundled, launcher].map((p) => p.toLowerCase()));
    const r = resolvePiShell({
      env: { SystemRoot: "D:\\WINNT", PATH: `${path.win32.dirname(bundled)};D:\\WINNT\\System32` },
      exists: (p) => present.has(p.toLowerCase()),
    });
    expect(r).toEqual({ path: bundled, isWslLauncher: false });
  });
});
