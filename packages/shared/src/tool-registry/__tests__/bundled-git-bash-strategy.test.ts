/**
 * Unit tests for `bundledGitBashStrategy` — resolves `bash` to the
 * bundled dugite-native shell at `<resourcesPath>/git/usr/bin/sh.exe`
 * (GNU bash under the name `sh`; the bundle ships no `bash.exe`).
 *
 * Windows-only. On non-win32 it fast-fails so the chain falls through to
 * `where` (which finds /bin/bash). Pure: all fs probes route through the
 * injected `exists` dep.
 *
 * See change: resolve-bundled-bash-on-windows.
 */
import path from "node:path";
import { describe, it, expect } from "vitest";
import { bundledGitBashStrategy } from "../strategies.js";
import type { StrategyCtx } from "../types.js";

function ctx(opts: {
  platform?: NodeJS.Platform;
  resourcesPath?: string;
}): StrategyCtx {
  return {
    overrides: {},
    platform: opts.platform ?? "win32",
    env: opts.resourcesPath ? { resourcesPath: opts.resourcesPath } : {},
  };
}

const RES = "C:\\Users\\qa\\AppData\\Local\\Programs\\pi-dashboard\\resources";
const GIT_MARKER = path.win32.join(RES, "git", "cmd", "git.exe");
const SH = path.win32.join(RES, "git", "usr", "bin", "sh.exe");

describe("bundledGitBashStrategy — present", () => {
  it("Windows: resolves <resourcesPath>\\git\\usr\\bin\\sh.exe", () => {
    const strat = bundledGitBashStrategy({
      exists: (p) => p === GIT_MARKER || p === SH,
    });
    const r = strat.run(ctx({ platform: "win32", resourcesPath: RES }));
    expect(r).toEqual({ ok: true, path: SH });
  });
});

describe("bundledGitBashStrategy — absent", () => {
  it("fast-fails on non-win32", () => {
    const strat = bundledGitBashStrategy({ exists: () => true });
    const r = strat.run(ctx({ platform: "linux", resourcesPath: RES }));
    expect(r).toEqual({ ok: false, reason: "not win32" });
  });

  it("fails when no bundled git tree (launcher marker absent)", () => {
    const strat = bundledGitBashStrategy({ exists: () => false });
    const r = strat.run(ctx({ platform: "win32", resourcesPath: RES }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/no bundled git/i);
  });

  it("fails when git tree exists but sh.exe missing", () => {
    const strat = bundledGitBashStrategy({ exists: (p) => p === GIT_MARKER });
    const r = strat.run(ctx({ platform: "win32", resourcesPath: RES }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(SH);
  });

  it("fails when resourcesPath is undefined", () => {
    const strat = bundledGitBashStrategy({ exists: () => true });
    const r = strat.run(ctx({ platform: "win32" }));
    expect(r.ok).toBe(false);
  });
});

describe("bundledGitBashStrategy.name", () => {
  it("is 'bundled-git-bash' so classify() maps to Source 'bundled'", () => {
    expect(bundledGitBashStrategy().name).toBe("bundled-git-bash");
  });
});
