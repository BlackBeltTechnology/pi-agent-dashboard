/**
 * Media tool definitions — `ffmpeg`, `ffprobe`, `imagemagick`, `chromium`.
 *
 * ffmpeg resolves via the static-npm strategy against `ffmpeg-static`
 * (which exports a binary PATH, not a PATH entry), falling through to a
 * PATH ffmpeg, then failing with `installHints`. ffprobe is INDEPENDENT
 * of ffmpeg-static (it ships none) via `@ffprobe-installer/ffprobe`.
 * chromium is a pw-browser probe with a confirm-gated manual hint.
 *
 * Folded scenarios: test-plan #E11 (8.11), #E12 (8.12), #E13 (8.13),
 * #E23 (8.23). See change: add-skill-tool-provisioning (design D3).
 */
import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { ToolRegistry, registerDefaultTools } from "../index.js";
import { OverridesStore } from "../overrides.js";
import type { StrategyDeps } from "../strategies.js";

const FFMPEG_STATIC_PATH = "/node_modules/ffmpeg-static/ffmpeg";
const FFPROBE_PATH = "/node_modules/@ffprobe-installer/ffprobe/bin/ffprobe";

/** deps with NO media packages installed and nothing on PATH. */
function bareDeps(): StrategyDeps {
  return {
    exists: () => false,
    which: () => null,
    npmRootGlobal: () => "",
    resolveModule: () => null,
    readEnv: () => undefined,
    readDir: () => [],
    requireModule: () => {
      throw new Error("Cannot find module");
    },
    dockerImageInspect: () => ({ ok: false, reason: "docker not available" }),
    homedir: () => "/nonexistent-pw-home",
  };
}

function freshRegistry(deps: StrategyDeps, platform: NodeJS.Platform = "linux"): ToolRegistry {
  const store = new OverridesStore({
    filePath: path.join(os.tmpdir(), `media-defs-test-${Math.random()}.json`),
    warn: () => {},
  });
  const r = new ToolRegistry({ overrides: store, platform });
  registerDefaultTools(r, deps);
  return r;
}

describe("ffmpeg — static-npm chain", () => {
  it("resolves the ffmpeg-static export when installed (8.11)", () => {
    const deps: StrategyDeps = {
      ...bareDeps(),
      exists: (p) => p === FFMPEG_STATIC_PATH,
      requireModule: (id) => (id === "ffmpeg-static" ? FFMPEG_STATIC_PATH : undefined),
    };
    const res = freshRegistry(deps).resolve("ffmpeg");
    expect(res.ok).toBe(true);
    expect(res.path).toBe(FFMPEG_STATIC_PATH);
    expect(res.source).toBe("static-npm");
  });

  it("a dead ffmpeg-static export (install script never ran) falls through to a PATH ffmpeg", () => {
    const deps: StrategyDeps = {
      ...bareDeps(),
      exists: (p) => p === "/usr/local/bin/ffmpeg", // export path dead, PATH binary real
      requireModule: (id) => (id === "ffmpeg-static" ? "/dead/export/ffmpeg" : undefined),
      which: (n) => (n === "ffmpeg" ? "/usr/local/bin/ffmpeg" : null),
    };
    const res = freshRegistry(deps).resolve("ffmpeg");
    expect(res.ok).toBe(true);
    expect(res.path).toBe("/usr/local/bin/ffmpeg");
    expect(res.source).toBe("system");
  });

  it("falls through to a PATH ffmpeg when ffmpeg-static is absent", () => {
    const deps: StrategyDeps = {
      ...bareDeps(),
      which: (n) => (n === "ffmpeg" ? "/usr/local/bin/ffmpeg" : null),
    };
    const res = freshRegistry(deps).resolve("ffmpeg");
    expect(res.ok).toBe(true);
    expect(res.path).toBe("/usr/local/bin/ffmpeg");
    expect(res.source).toBe("system");
  });

  it("fails with installHints recommended when no static pkg AND no PATH ffmpeg (8.12)", () => {
    const list = freshRegistry(bareDeps()).list();
    const ffmpeg = list.find((t) => t.name === "ffmpeg");
    expect(ffmpeg?.ok).toBe(false);
    const triedStrategies = ffmpeg?.tried.map((t) => t.strategy) ?? [];
    expect(triedStrategies).toContain("static-npm");
    expect(triedStrategies).toContain("where");
    expect(ffmpeg?.installHints?.linux?.commands?.apt).toBeTruthy();
  });
});

describe("ffprobe — independent of ffmpeg-static (8.13)", () => {
  it("resolves via @ffprobe-installer/ffprobe .path even with NO ffmpeg-static", () => {
    const deps: StrategyDeps = {
      ...bareDeps(),
      exists: (p) => p === FFPROBE_PATH,
      requireModule: (id) =>
        id === "@ffprobe-installer/ffprobe" ? { path: FFPROBE_PATH } : undefined,
    };
    const r = freshRegistry(deps);
    const ffprobe = r.resolve("ffprobe");
    expect(ffprobe.ok).toBe(true);
    expect(ffprobe.path).toBe(FFPROBE_PATH);
    expect(ffprobe.source).toBe("static-npm");
    // …while ffmpeg itself stays missing — no dependency on ffmpeg-static.
    expect(r.resolve("ffmpeg").ok).toBe(false);
  });
});

describe("chromium — pw-browser probe with confirm-gated hint (8.23)", () => {
  it("registers as a probe-kind tool with a requiresConfirm manual hint", () => {
    const list = freshRegistry(bareDeps()).list();
    const chromium = list.find((t) => t.name === "chromium");
    expect(chromium).toBeDefined();
    expect(chromium?.ok).toBe(false); // no browsers cache in the bare fixture
    expect(chromium?.installHints?.linux?.manual).toBe("npx playwright install chromium");
    expect(chromium?.installHints?.linux?.requiresConfirm).toBe(true);
  });

  it("resolves ok via the pw-browser strategy when the cache has chromium", () => {
    const base = "/fake/pw";
    const deps: StrategyDeps = {
      ...bareDeps(),
      readEnv: (n) => (n === "PLAYWRIGHT_BROWSERS_PATH" ? base : undefined),
      readDir: () => ["chromium-1148"],
    };
    const res = freshRegistry(deps).resolve("chromium");
    expect(res.ok).toBe(true);
    expect(res.source).toBe("probe");
  });
});

describe("imagemagick — resolve-probe binary with host hints", () => {
  it("registers with per-OS installHints and resolves `convert` from PATH", () => {
    const deps: StrategyDeps = {
      ...bareDeps(),
      which: (n) => (n === "convert" ? "/usr/bin/convert" : null),
    };
    const list = freshRegistry(deps).list();
    const magick = list.find((t) => t.name === "imagemagick");
    expect(magick?.ok).toBe(true);
    expect(magick?.installHints?.darwin?.commands?.brew).toBeTruthy();
    expect(magick?.installHints?.win32?.commands?.winget).toBeTruthy();
  });

  it("win32 probes `magick`, never the System32 convert.exe (CodeRabbit round 1)", () => {
    const deps: StrategyDeps = {
      ...bareDeps(),
      which: (n) => (n === "magick" ? "C:\\Program Files\\ImageMagick\\magick.exe" : null),
    };
    const res = freshRegistry(deps, "win32").resolve("imagemagick");
    expect(res.ok).toBe(true);
    expect(res.tried.map((t) => t.strategy)).toContain("where");
  });
});
