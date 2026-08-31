/**
 * Unit tests for `envProbeStrategy` — the credential-presence probe.
 *
 * Boolean presence ONLY: the strategy never reads nor records the
 * variable's value. `Resolution.path` is `null` when ok (the relaxed
 * path invariant for non-path kinds — see change: add-skill-tool-provisioning).
 *
 * Folded scenarios: test-plan #E7 (8.7), #E8 (8.8), #X1 (8.26), #E19 (8.19 env leg).
 */
import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { envProbeStrategy } from "../strategies.js";
import { ToolRegistry } from "../registry.js";
import { OverridesStore } from "../overrides.js";
import type { StrategyCtx } from "../types.js";

function ctx(): StrategyCtx {
  return { overrides: {}, platform: "linux", env: {} };
}

describe("envProbeStrategy — present", () => {
  it("resolves ok:true with path:null when the variable is set (boolean presence)", () => {
    const strat = envProbeStrategy("SONIOX_API_KEY", {
      readEnv: (n) => (n === "SONIOX_API_KEY" ? "secret123" : undefined),
    });
    expect(strat.run(ctx())).toEqual({ ok: true, path: null });
  });

  it("never exposes the value (secret hygiene — 8.8)", () => {
    const strat = envProbeStrategy("SONIOX_API_KEY", { readEnv: () => "secret123" });
    const r = strat.run(ctx());
    // The result (and anything serialized from it) carries no trace of the value.
    expect(JSON.stringify(r)).not.toContain("secret123");
  });

  it("strategy name is 'env' so classify() maps it to Source 'probe'", () => {
    expect(envProbeStrategy("X").name).toBe("env");
  });
});

describe("envProbeStrategy — absent", () => {
  it("fails naming the variable, never a value (8.26)", () => {
    const strat = envProbeStrategy("SONIOX_API_KEY", { readEnv: () => undefined });
    const r = strat.run(ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("SONIOX_API_KEY");
    }
  });
});

describe("registry integration — env probe kind", () => {
  it("env-kind tool resolves ok:true with path:null and source:'probe' (relaxed path invariant, 8.19)", () => {
    const store = new OverridesStore({
      filePath: path.join(os.tmpdir(), `env-probe-test-${Math.random()}.json`),
      warn: () => {},
    });
    const r = new ToolRegistry({ overrides: store, platform: "linux" });
    r.register({
      name: "SONIOX_API_KEY",
      kind: "probe",
      strategies: [envProbeStrategy("SONIOX_API_KEY", { readEnv: () => "x" })],
    });
    const res = r.resolve("SONIOX_API_KEY");
    expect(res.ok).toBe(true);
    expect(res.path).toBeNull();
    // A probe strategy must classify as "probe", never fall through to "system".
    expect(res.source).toBe("probe");
    expect(res.tried).toEqual([{ strategy: "env", result: "ok" }]);
  });

  it("missing env-kind tool resolves ok:false via the registry (8.26 registry leg)", () => {
    const store = new OverridesStore({
      filePath: path.join(os.tmpdir(), `env-probe-test-${Math.random()}.json`),
      warn: () => {},
    });
    const r = new ToolRegistry({ overrides: store, platform: "linux" });
    r.register({
      name: "GEMINI_API_KEY",
      kind: "probe",
      strategies: [envProbeStrategy("GEMINI_API_KEY", { readEnv: () => undefined })],
    });
    const res = r.resolve("GEMINI_API_KEY");
    expect(res.ok).toBe(false);
    expect(res.path).toBeNull();
    expect(res.source).toBeNull();
  });
});
