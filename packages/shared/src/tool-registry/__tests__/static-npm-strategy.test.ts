/**
 * Unit tests for `staticNpmStrategy` — reads the BINARY PATH exported by
 * an npm package (distinct from `bare-import`, which returns the package
 * dir / JS entry).
 *
 * Media packages export the binary location in one of two shapes:
 * a bare string (`require("ffmpeg-static")` → "/…/ffmpeg") or an object
 * carrying `.path` (`require("@ffprobe-installer/ffprobe") → { path }`).
 * Both must yield the binary path string.
 *
 * Folded scenarios: test-plan #E11 (8.11), #E13 (8.13), #E14 (8.14).
 * See change: add-skill-tool-provisioning (design D3).
 */
import { describe, it, expect } from "vitest";
import { staticNpmStrategy } from "../strategies.js";
import type { StrategyCtx } from "../types.js";

function ctx(): StrategyCtx {
  return { overrides: {}, platform: "linux", env: {} };
}

describe("staticNpmStrategy — export shapes (8.14)", () => {
  it("resolves a bare-string export to the binary path (ffmpeg-static shape, 8.11)", () => {
    const strat = staticNpmStrategy("ffmpeg-static", {
      requireModule: (id) =>
        id === "ffmpeg-static" ? "/node_modules/ffmpeg-static/ffmpeg" : undefined,
    });
    const r = strat.run(ctx());
    expect(r).toEqual({ ok: true, path: "/node_modules/ffmpeg-static/ffmpeg" });
  });

  it("resolves an object export via .path (@ffprobe-installer shape, 8.13)", () => {
    const strat = staticNpmStrategy("@ffprobe-installer/ffprobe", {
      requireModule: () => ({ path: "/node_modules/@ffprobe-installer/ffprobe/bin/ffprobe" }),
    });
    const r = strat.run(ctx());
    expect(r).toEqual({ ok: true, path: "/node_modules/@ffprobe-installer/ffprobe/bin/ffprobe" });
  });

  it("ignores a default-interop wrapper ({ default: string })", () => {
    const strat = staticNpmStrategy("some-pkg", {
      requireModule: () => ({ default: "/bin/thing" }),
    });
    expect(strat.run(ctx())).toEqual({ ok: true, path: "/bin/thing" });
  });
});

describe("staticNpmStrategy — absent / malformed", () => {
  it("fails when the package cannot be required", () => {
    const strat = staticNpmStrategy("ffmpeg-static", {
      requireModule: () => {
        throw new Error("Cannot find module 'ffmpeg-static'");
      },
    });
    const r = strat.run(ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("ffmpeg-static");
    }
  });

  it("fails when the export is neither a string nor carries .path", () => {
    const strat = staticNpmStrategy("weird-pkg", { requireModule: () => ({ nope: 1 }) });
    expect(strat.run(ctx()).ok).toBe(false);
  });

  it("fails when the exported path is not a non-empty string", () => {
    const strat = staticNpmStrategy("empty-pkg", { requireModule: () => "" });
    expect(strat.run(ctx()).ok).toBe(false);
  });

  it("strategy name is 'static-npm'", () => {
    expect(staticNpmStrategy("x").name).toBe("static-npm");
  });
});
