/**
 * Unit tests for `dockerImageProbeStrategy` — docker-image presence probe.
 *
 * The strategy NEVER assumes Docker is present: an unavailable daemon is
 * just a failed attempt recorded in `tried[]`. The winning `path` is the
 * image ref (a non-filesystem string — relaxed path invariant).
 *
 * Folded scenarios: test-plan #E9 (8.9), #X2 (8.27), #E20 (8.20 docker leg).
 */
import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { dockerImageProbeStrategy } from "../strategies.js";
import { ToolRegistry } from "../registry.js";
import { OverridesStore } from "../overrides.js";
import type { StrategyCtx } from "../types.js";

function ctx(): StrategyCtx {
  return { overrides: {}, platform: "linux", env: {} };
}

describe("dockerImageProbeStrategy", () => {
  it("resolves ok:true with path = the image ref when the image exists (8.9)", () => {
    const strat = dockerImageProbeStrategy("pi-doc-engine", {
      dockerImageInspect: (ref) => (ref === "pi-doc-engine" ? { ok: true } : { ok: false, reason: "not found" }),
    });
    expect(strat.run(ctx())).toEqual({ ok: true, path: "pi-doc-engine" });
  });

  it("reports ok:false with the reason when the daemon is unavailable — never assumes docker (8.27)", () => {
    const strat = dockerImageProbeStrategy("pi-doc-engine", {
      dockerImageInspect: () => ({ ok: false, reason: "docker daemon unavailable" }),
    });
    const r = strat.run(ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("docker");
    }
  });

  it("reports ok:false naming the image when the image is missing (8.27)", () => {
    const strat = dockerImageProbeStrategy("pi-doc-engine", {
      dockerImageInspect: () => ({ ok: false, reason: "image pi-doc-engine not found" }),
    });
    const r = strat.run(ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("pi-doc-engine");
    }
  });

  it("strategy name is 'docker-image'", () => {
    expect(dockerImageProbeStrategy("x").name).toBe("docker-image");
  });
});

describe("registry integration — docker-image probe kind", () => {
  it("docker-image tool resolves ok:true with a non-fs image-ref path and source:'probe' (8.20)", () => {
    const store = new OverridesStore({
      filePath: path.join(os.tmpdir(), `docker-probe-test-${Math.random()}.json`),
      warn: () => {},
    });
    const r = new ToolRegistry({ overrides: store, platform: "linux" });
    r.register({
      name: "pi-doc-engine",
      kind: "probe",
      strategies: [
        dockerImageProbeStrategy("pi-doc-engine", { dockerImageInspect: () => ({ ok: true }) }),
      ],
    });
    const res = r.resolve("pi-doc-engine");
    expect(res.ok).toBe(true);
    expect(res.path).toBe("pi-doc-engine"); // non-fs image ref accepted
    expect(res.source).toBe("probe");
  });

  it("failed probe records the reason in tried[] (8.27 tried-leg)", () => {
    const store = new OverridesStore({
      filePath: path.join(os.tmpdir(), `docker-probe-test-${Math.random()}.json`),
      warn: () => {},
    });
    const r = new ToolRegistry({ overrides: store, platform: "linux" });
    r.register({
      name: "pi-doc-engine",
      kind: "probe",
      strategies: [
        dockerImageProbeStrategy("pi-doc-engine", {
          dockerImageInspect: () => ({ ok: false, reason: "docker daemon unavailable" }),
        }),
      ],
    });
    const res = r.resolve("pi-doc-engine");
    expect(res.ok).toBe(false);
    expect(res.tried).toEqual([
      { strategy: "docker-image", result: "docker daemon unavailable" },
    ]);
  });
});
