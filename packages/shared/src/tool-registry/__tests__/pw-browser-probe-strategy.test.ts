/**
 * Unit tests for `pwBrowserProbeStrategy` — Playwright-browser presence probe.
 *
 * Reads the documented Playwright browsers cache (`PLAYWRIGHT_BROWSERS_PATH`
 * or the per-OS default under the context's homedir) and reports the browser
 * directory when present. On absence it fails — the definition's
 * `installHints` recommend `npx playwright install <browser>`.
 *
 * Folded scenarios: test-plan #E10 (8.10), #X3 (8.28).
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { pwBrowserProbeStrategy } from "../strategies.js";
import type { StrategyCtx } from "../types.js";

function ctx(opts: { platform?: NodeJS.Platform; homedir?: string } = {}): StrategyCtx {
  return {
    overrides: {},
    platform: opts.platform ?? "linux",
    env: opts.homedir ? { homedir: opts.homedir } : {},
  };
}

describe("pwBrowserProbeStrategy — present", () => {
  it("resolves ok:true via PLAYWRIGHT_BROWSERS_PATH containing the browser dir (8.10)", () => {
    const base = "/fake/pw-browsers";
    const strat = pwBrowserProbeStrategy("chromium", {
      readEnv: (n) => (n === "PLAYWRIGHT_BROWSERS_PATH" ? base : undefined),
      readDir: (p) => (p === base ? ["chromium-1148", "ffmpeg-1010"] : []),
    });
    const r = strat.run(ctx());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.path).toBe(path.join(base, "chromium-1148"));
    }
  });

  it("matches headless-shell variants (chromium_headless_shell-<rev>)", () => {
    const base = "/fake/pw-browsers";
    const strat = pwBrowserProbeStrategy("chromium", {
      readEnv: (n) => (n === "PLAYWRIGHT_BROWSERS_PATH" ? base : undefined),
      readDir: () => ["chromium_headless_shell-1148"],
    });
    expect(strat.run(ctx()).ok).toBe(true);
  });

  it("falls back to the per-OS default cache dir under ctx.env.homedir", () => {
    const home = "/home/tester";
    const cases: Array<[NodeJS.Platform, string]> = [
      ["linux", path.join(home, ".cache", "ms-playwright")],
      ["darwin", path.join(home, "Library", "Caches", "ms-playwright")],
      ["win32", path.join(home, "AppData", "Local", "ms-playwright")],
    ];
    for (const [platform, expectedBase] of cases) {
      const probed: string[] = [];
      const strat = pwBrowserProbeStrategy("chromium", {
        readEnv: () => undefined,
        readDir: (p) => {
          probed.push(p);
          return p === expectedBase ? ["chromium-1148"] : [];
        },
      });
      const r = strat.run(ctx({ platform, homedir: home }));
      expect(r.ok, `${platform} should probe ${expectedBase}`).toBe(true);
      expect(probed[0]).toBe(expectedBase);
    }
  });
});

describe("pwBrowserProbeStrategy — absent", () => {
  it("fails when the cache dir has no matching browser (8.28)", () => {
    const base = "/fake/pw-browsers";
    const strat = pwBrowserProbeStrategy("chromium", {
      readEnv: (n) => (n === "PLAYWRIGHT_BROWSERS_PATH" ? base : undefined),
      readDir: () => ["firefox-1400"],
    });
    const r = strat.run(ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("chromium");
    }
  });

  it("falls back to the INJECTED homedir dep when ctx.env.homedir is unset (production registries)", () => {
    // Production registries construct without env — the dep (os.homedir)
    // is what makes the DEFAULT cache dir probeable.
    const home = "/home/prod-user";
    const expectedBase = path.join(home, ".cache", "ms-playwright");
    const probed: string[] = [];
    const strat = pwBrowserProbeStrategy("chromium", {
      readEnv: () => undefined,
      homedir: () => home,
      readDir: (p) => {
        probed.push(p);
        return p === expectedBase ? ["chromium-1148"] : [];
      },
    });
    const r = strat.run({ overrides: {}, platform: "linux", env: {} });
    expect(r.ok).toBe(true);
    expect(probed[0]).toBe(expectedBase);
  });

  it("fails cleanly when no cache dir can be determined (no env, unusable homedir)", () => {
    const strat = pwBrowserProbeStrategy("chromium", {
      readEnv: () => undefined,
      homedir: () => "",
      readDir: () => [],
    });
    const r = strat.run(ctx({ platform: "linux" }));
    expect(r.ok).toBe(false);
  });

  it("strategy name is 'pw-browser'", () => {
    expect(pwBrowserProbeStrategy("chromium").name).toBe("pw-browser");
  });
});
