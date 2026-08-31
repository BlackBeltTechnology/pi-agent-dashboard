/**
 * Source-classification contract for the NEW strategies.
 *
 * `Source` gains `"static-npm"` and `"probe"`; the registry's default
 * classifier MUST map the new strategy names distinctly — never to
 * `"system"`. Also pins the `PlatformInstallHint.requiresConfirm`
 * compile-level contract.
 *
 * Folded scenarios: test-plan #E22 (8.22), #E23 (8.23 type leg).
 * See change: add-skill-tool-provisioning (design D2).
 */
import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { ToolRegistry } from "../registry.js";
import { OverridesStore } from "../overrides.js";
import type { PlatformInstallHint, Source, Strategy } from "../types.js";

function freshRegistry(platform: NodeJS.Platform = "linux"): ToolRegistry {
  const store = new OverridesStore({
    filePath: path.join(os.tmpdir(), `source-classify-test-${Math.random()}.json`),
    warn: () => {},
  });
  return new ToolRegistry({ overrides: store, platform });
}

/** Fake strategy that only carries the NAME under test. */
function named(name: string, ok: boolean): Strategy {
  return {
    name,
    run: () => (ok ? { ok: true, path: "/fake/thing" } : { ok: false, reason: "nope" }),
  };
}

describe("Source union — new members (compile-level)", () => {
  it("admits 'static-npm' and 'probe'", () => {
    const sources: readonly Source[] = ["static-npm", "probe"];
    expect(sources).toHaveLength(2);
  });

  it("PlatformInstallHint admits requiresConfirm (8.23 type leg)", () => {
    const hint: PlatformInstallHint = {
      manual: "npx playwright install chromium",
      requiresConfirm: true,
    };
    expect(hint.requiresConfirm).toBe(true);
  });
});

describe("default classify — new strategies are never 'system' (8.22)", () => {
  it("a strategy named 'static-npm' classifies as 'static-npm'", () => {
    const r = freshRegistry();
    r.register({ name: "ffmpeg", kind: "binary", strategies: [named("static-npm", true)] });
    expect(r.resolve("ffmpeg").source).toBe("static-npm");
  });

  it("strategies named 'env' / 'docker-image' / 'pw-browser' classify as 'probe'", () => {
    const r = freshRegistry();
    for (const [tool, strategyName] of [
      ["SONIOX_API_KEY", "env"],
      ["pi-doc-engine", "docker-image"],
      ["chromium", "pw-browser"],
    ] as const) {
      r.register({ name: tool, kind: "probe", strategies: [named(strategyName, true)] });
      expect(r.resolve(tool).source, strategyName).toBe("probe");
    }
  });

  it("the legacy mappings still hold (regression)", () => {
    const r = freshRegistry();
    r.register({ name: "t1", kind: "binary", strategies: [named("managed", true)] });
    r.register({ name: "t2", kind: "binary", strategies: [named("where", true)] });
    r.register({ name: "t3", kind: "binary", strategies: [named("bundled-node", true)] });
    r.register({ name: "t4", kind: "binary", strategies: [named("bare-import", true)] });
    expect(r.resolve("t1").source).toBe("managed");
    expect(r.resolve("t2").source).toBe("system");
    expect(r.resolve("t3").source).toBe("bundled");
    expect(r.resolve("t4").source).toBe("bare-import");
  });
});
