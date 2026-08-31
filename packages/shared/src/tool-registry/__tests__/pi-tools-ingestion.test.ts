/**
 * Unit tests for `pi.tools` manifest ingestion (design D1).
 *
 * A skill package declares an additive `pi.tools` array in its
 * package.json. `parseSkillTools` validates (strict key set, tool-id
 * charset, known probe kinds); `ingestSkillTools` ingests into a
 * `ToolRegistry` — referencing an existing definition or synthesizing a
 * probe-kind def. Unmanifested skills are untouched (byte-identical
 * registry behavior).
 *
 * Folded scenarios: test-plan #E1–E6 (8.1–8.6), #E25 leg (8.25).
 */
import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { ToolRegistry, registerDefaultTools } from "../index.js";
import { OverridesStore } from "../overrides.js";
import { parseSkillTools, ingestSkillTools } from "../pi-tools.js";
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
    filePath: path.join(os.tmpdir(), `pi-tools-test-${Math.random()}.json`),
    warn: () => {},
  });
  // `now` is pinned so two registries serialize identically (resolvedAt).
  const r = new ToolRegistry({ overrides: store, platform: "linux", now: () => 0 });
  registerDefaultTools(r, deps);
  return r;
}

describe("parseSkillTools — validation", () => {
  it("accepts a missing pi / pi.tools as zero tools (8.6 parse leg)", () => {
    expect(parseSkillTools(undefined)).toEqual({ ok: true, tools: [] });
    expect(parseSkillTools({})).toEqual({ ok: true, tools: [] });
    expect(parseSkillTools({ skills: ["x"] })).toEqual({ ok: true, tools: [] });
  });

  it("parses a valid entry with defaults (probe resolve, optional false)", () => {
    const parsed = parseSkillTools({ tools: [{ id: "ffmpeg" }] });
    expect(parsed).toEqual({
      ok: true,
      tools: [{ id: "ffmpeg", probe: "resolve", optional: false }],
    });
  });

  it("rejects an entry with an extra key (provide) naming the entry (8.2)", () => {
    const parsed = parseSkillTools({
      tools: [{ id: "ffmpeg", probe: "resolve", provide: "brew install x" }],
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors.join("\n")).toContain("ffmpeg");
      expect(parsed.errors.join("\n")).toContain("provide");
    }
  });

  it("rejects scoped-npm ids (8.3)", () => {
    const parsed = parseSkillTools({
      tools: [{ id: "npm:@the-focus-ai/nano-banana", probe: "env" }],
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.join("\n")).toContain("npm:@the-focus-ai/nano-banana");
  });

  it("accepts uppercase/underscore ids (env-var names, 8.4)", () => {
    const parsed = parseSkillTools({ tools: [{ id: "SONIOX_API_KEY", probe: "env" }] });
    expect(parsed.ok).toBe(true);
  });

  it("rejects ids whose first char is not [A-Za-z0-9_] (8.5)", () => {
    for (const id of ["-ffmpeg", ".x"]) {
      const parsed = parseSkillTools({ tools: [{ id, probe: "resolve" }] });
      expect(parsed.ok, id).toBe(false);
      if (!parsed.ok) expect(parsed.errors.join("\n")).toContain(id);
    }
  });

  it("rejects unknown probe kinds and non-object entries", () => {
    const parsed = parseSkillTools({
      tools: [{ id: "x", probe: "teleport" }, "not-an-object"],
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.length).toBe(2);
  });

  it("rejects a non-array pi.tools", () => {
    expect(parseSkillTools({ tools: "ffmpeg" }).ok).toBe(false);
  });
});

describe("ingestSkillTools — referencing", () => {
  it("references an existing definition and carries optional (8.1)", () => {
    const r = freshRegistry();
    const records = ingestSkillTools(r, [{ id: "ffmpeg", probe: "resolve", optional: true }]);
    expect(records).toEqual([
      { id: "ffmpeg", probe: "resolve", optional: true, synthesized: false },
    ]);
    // The registered static-npm chain still answers — ingestion never clobbers.
    const res = r.resolve("ffmpeg");
    expect(res.ok).toBe(false); // bare fixture deps: no ffmpeg anywhere
    expect(res.tried.map((t) => t.strategy)).toContain("static-npm");
  });

  it("ingested tools surface through list() with Resolution + installHints (8.25)", () => {
    const r = freshRegistry();
    ingestSkillTools(r, [{ id: "ffmpeg", probe: "resolve", optional: true }]);
    const row = r.list().find((t) => t.name === "ffmpeg");
    expect(row).toBeDefined();
    expect(row?.installHints?.linux?.commands?.apt).toBeTruthy();
    expect(typeof row?.ok).toBe("boolean");
    expect(Array.isArray(row?.tried)).toBe(true);
  });
});

describe("ingestSkillTools — synthesis", () => {
  it("synthesizes an env probe def for an unregistered id", () => {
    const deps = bareDeps();
    const r = freshRegistry(deps);
    const records = ingestSkillTools(r, [{ id: "SONIOX_API_KEY", probe: "env" }]);
    expect(records[0].synthesized).toBe(true);
    expect(r.has("SONIOX_API_KEY")).toBe(true);
    expect(r.resolve("SONIOX_API_KEY").ok).toBe(false);

    // With the variable present (via the same injected deps) the
    // synthesized def resolves as a probe.
    const r2 = freshRegistry({ ...deps, readEnv: (n) => (n === "SONIOX_API_KEY" ? "x" : undefined) });
    ingestSkillTools(r2, [{ id: "SONIOX_API_KEY", probe: "env" }], {
      ...deps,
      readEnv: (n) => (n === "SONIOX_API_KEY" ? "x" : undefined),
    });
    const res = r2.resolve("SONIOX_API_KEY");
    expect(res.ok).toBe(true);
    expect(res.path).toBeNull();
    expect(res.source).toBe("probe");
  });

  it("synthesizes a docker-image probe whose path is the image ref", () => {
    const deps: StrategyDeps = {
      ...bareDeps(),
      dockerImageInspect: (ref) => (ref === "pi-doc-engine" ? { ok: true } : { ok: false, reason: "no" }),
    };
    const r = freshRegistry(deps);
    ingestSkillTools(r, [{ id: "pi-doc-engine", probe: "docker-image" }], deps);
    const res = r.resolve("pi-doc-engine");
    expect(res.ok).toBe(true);
    expect(res.path).toBe("pi-doc-engine");
    expect(res.source).toBe("probe");
  });

  it("synthesizes a pw-browser probe", () => {
    const deps: StrategyDeps = {
      ...bareDeps(),
      readEnv: (n) => (n === "PLAYWRIGHT_BROWSERS_PATH" ? "/fake/pw" : undefined),
      readDir: () => ["webkit-2000"],
    };
    const r = freshRegistry(deps);
    ingestSkillTools(r, [{ id: "webkit", probe: "pw-browser" }], deps);
    const res = r.resolve("webkit");
    expect(res.ok).toBe(true);
    expect(res.source).toBe("probe");
  });

  it("synthesizes a resolve probe as a PATH lookup", () => {
    const r = freshRegistry();
    ingestSkillTools(r, [{ id: "no-such-binary-anywhere", probe: "resolve" }]);
    const res = r.resolve("no-such-binary-anywhere");
    expect(res.ok).toBe(false);
    expect(res.tried.map((t) => t.strategy)).toContain("where");
  });
});

describe("ingestSkillTools — unmanifested / idempotent", () => {
  it("no pi.tools → registry behavior byte-identical (8.6)", () => {
    const before = JSON.stringify(freshRegistry().list());
    const r = freshRegistry();
    ingestSkillTools(r, []);
    expect(JSON.stringify(r.list())).toBe(before);
  });

  it("re-ingesting the same manifest is idempotent", () => {
    const r = freshRegistry();
    const manifest = [{ id: "SONIOX_API_KEY", probe: "env" }] as const;
    ingestSkillTools(r, [...manifest]);
    const snapshot = JSON.stringify(r.list());
    ingestSkillTools(r, [...manifest]);
    expect(JSON.stringify(r.list())).toBe(snapshot);
  });
});
