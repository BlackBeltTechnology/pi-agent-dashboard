/**
 * Skill-exemplar registry definitions — `agent-browser` (pw-browser +
 * CLI bootstrap exemplar) and `pi-doc-engine` (docker-image exemplar).
 *
 * Both are registered so skill `pi.tools` entries reference REAL
 * definitions with first-party installHints. The pi-doc-engine build
 * hint is a network+exec command → requiresConfirm.
 *
 * See change: add-skill-tool-provisioning (tasks 4.2, 4.3).
 */
import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { ToolRegistry, registerDefaultTools } from "../index.js";
import { OverridesStore } from "../overrides.js";
import type { StrategyDeps } from "../strategies.js";

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

function freshRegistry(deps: StrategyDeps = bareDeps()): ToolRegistry {
  const store = new OverridesStore({
    filePath: path.join(os.tmpdir(), `exemplar-defs-test-${Math.random()}.json`),
    warn: () => {},
  });
  const r = new ToolRegistry({ overrides: store, platform: "linux" });
  registerDefaultTools(r, deps);
  return r;
}

describe("agent-browser definition (browser skill exemplar)", () => {
  it("registers as a binary probing PATH; missing → install hint names the pi extension", () => {
    const res = freshRegistry().resolve("agent-browser");
    expect(res.ok).toBe(false);
    expect(res.tried.map((t) => t.strategy)).toContain("where");
    const row = freshRegistry().list().find((t) => t.name === "agent-browser");
    expect(row?.installHints?.linux?.manual).toBe("pi install npm:pi-agent-browser");
  });

  it("resolves via PATH when the CLI is installed", () => {
    const deps: StrategyDeps = {
      ...bareDeps(),
      which: (n) => (n === "agent-browser" ? "/usr/local/bin/agent-browser" : null),
    };
    const res = freshRegistry(deps).resolve("agent-browser");
    expect(res.ok).toBe(true);
    expect(res.source).toBe("system");
  });
});

describe("pi-doc-engine definition (docker-image exemplar)", () => {
  it("registers as a docker-image probe; missing image → hint recommends the first-party build command", () => {
    const r = freshRegistry();
    const res = r.resolve("pi-doc-engine");
    expect(res.ok).toBe(false);
    expect(res.tried).toEqual([
      { strategy: "override", result: "no override set" },
      { strategy: "docker-image", result: "docker not available" },
    ]);
    const row = r.list().find((t) => t.name === "pi-doc-engine");
    expect(row?.installHints?.linux?.manual).toBe("npm run build:image");
    expect(row?.installHints?.linux?.requiresConfirm).toBe(true);
  });

  it("resolves ok with the image ref as path when the image exists", () => {
    const deps: StrategyDeps = {
      ...bareDeps(),
      dockerImageInspect: (ref) => (ref === "pi-doc-engine" ? { ok: true } : { ok: false, reason: "no" }),
    };
    const res = freshRegistry(deps).resolve("pi-doc-engine");
    expect(res.ok).toBe(true);
    expect(res.path).toBe("pi-doc-engine");
    expect(res.source).toBe("probe");
  });
});
