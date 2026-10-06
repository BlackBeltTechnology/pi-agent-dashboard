/**
 * `pluginSpawnToSessionOptions` — the total, pure mapper that flattens a
 * plugin's nested `scope` block into the flat `SessionFlags` fields the argv
 * builder consumes (plus `extensionConfig` for env).
 *
 * These cover the mapper end-to-end through `sessionFlagsToArgv`: the
 * byte-identical guarantee when `scope` is absent (E1/E12), full-block
 * forwarding (E13), and the total-mapper input-sanitization contract
 * (X1 non-string dropping, X2 NUL dropping, X4 malformed-container-as-absent).
 * The env projection (E9–E11, X3) is covered in the server suite where
 * `buildSpawnEnv` lives.
 *
 * See change: add-plugin-spawn-scope.
 */
import { sessionFlagsToArgv } from "@blackbelt-technology/pi-dashboard-shared/platform/spawn-mechanism.js";
import { describe, expect, it } from "vitest";
import { type PluginSpawnOptions, pluginSpawnToSessionOptions } from "../server/server-context.js";

/** Convenience: run the mapper and project the result straight to argv. */
function argvFor(opts: PluginSpawnOptions): string[] {
  return sessionFlagsToArgv(pluginSpawnToSessionOptions(opts));
}

describe("pluginSpawnToSessionOptions", () => {
  it("E1: scope omitted ⇒ argv byte-identical to the pre-scope inline literal", () => {
    // Pre-change the hook produced { strategy: "headless", model }. The argv
    // funnel only sees model → ["--model", "m"]; strategy is not an argv flag.
    expect(argvFor({ cwd: "/w", model: "m" })).toEqual(["--model", "m"]);
    expect(argvFor({ cwd: "/w" })).toEqual([]);
  });

  it("E1: scope omitted ⇒ no extensionConfig on the mapped options", () => {
    const mapped = pluginSpawnToSessionOptions({ cwd: "/w", model: "m" });
    expect(mapped.extensionConfig).toBeUndefined();
    expect(mapped.strategy).toBe("headless");
  });

  it("E12: existing fields (model, name) forwarded unchanged", () => {
    // `automationRun` is gone from the generic surface; a session name now
    // travels as the top-level `name` opt (→ `--name`). See change:
    // detach-automation-goal-from-core.
    const mapped = pluginSpawnToSessionOptions({
      cwd: "/w",
      model: "provider/model",
      name: "run-title",
    });
    expect(mapped.model).toBe("provider/model");
    expect(mapped.name).toBe("run-title");
  });

  it("E13: a full scope block reaches argv + extensionConfig", () => {
    const mapped = pluginSpawnToSessionOptions({
      cwd: "/w",
      scope: {
        tools: ["read"],
        excludeTools: ["write"],
        noBuiltinTools: true,
        noTools: true,
        skills: ["/s.md"],
        noSkills: true,
        extensions: ["/e.js"],
        extensionConfig: { myext: { token: "abc" } },
      },
    });
    const argv = sessionFlagsToArgv(mapped);
    expect(argv).toEqual([
      "--tools",
      "read",
      "--exclude-tools",
      "write",
      "--no-builtin-tools",
      "--no-tools",
      "--skill",
      "/s.md",
      "--no-skills",
      "-e",
      "/e.js",
    ]);
    expect(mapped.extensionConfig).toEqual({ myext: { token: "abc" } });
  });

  it("X1: non-string / empty allowlist entries are dropped (no throw)", () => {
    // Runtime JS input — types deliberately violated to model plugin input.
    const opts = { cwd: "/w", scope: { tools: ["read", 42, "", null, "grep"] } } as unknown as PluginSpawnOptions;
    expect(argvFor(opts)).toEqual(["--tools", "read,grep"]);
  });

  it("X2: a NUL-bearing argv string is dropped; spawn is not poisoned", () => {
    const opts = {
      cwd: "/w",
      scope: {
        tools: ["read", "gr\u0000ep"],
        skills: ["/ok.md", "/ba\u0000d.md"],
        extensions: ["/e\u0000.js"],
      },
    } as unknown as PluginSpawnOptions;
    const argv = argvFor(opts);
    expect(argv).toEqual(["--tools", "read", "--skill", "/ok.md"]);
    expect(argv.some((a) => a.includes("\u0000"))).toBe(false);
  });

  it("X4: malformed scope container is treated as absent (no throw)", () => {
    for (const bad of [null, [], 42, "scope", true]) {
      const opts = { cwd: "/w", scope: bad } as unknown as PluginSpawnOptions;
      expect(() => pluginSpawnToSessionOptions(opts)).not.toThrow();
      expect(argvFor(opts)).toEqual([]);
    }
  });

  it("X4: malformed extensionConfig container is treated as absent", () => {
    for (const bad of [null, [], 42, "cfg"]) {
      const opts = { cwd: "/w", scope: { extensionConfig: bad } } as unknown as PluginSpawnOptions;
      const mapped = pluginSpawnToSessionOptions(opts);
      expect(mapped.extensionConfig).toBeUndefined();
    }
  });

  it("E7: an empty allowlist maps through to no flag", () => {
    expect(argvFor({ cwd: "/w", scope: { tools: [] } })).toEqual([]);
  });

  it("E14: no scope combination ever yields --no-extensions", () => {
    const argv = argvFor({
      cwd: "/w",
      scope: {
        tools: ["read"],
        excludeTools: ["write"],
        noBuiltinTools: true,
        noTools: true,
        skills: ["/s.md"],
        noSkills: true,
        extensions: ["/e.js"],
      },
    });
    expect(argv).not.toContain("--no-extensions");
  });
  // ── add-team-plugin D12: appendSystemPrompt / noContextFiles / noProjectTrust / sessionDir ──
  describe("team persona scope fields (add-team-plugin)", () => {
    it("E1: appendSystemPrompt + noContextFiles map to argv", () => {
      const argv = argvFor({
        cwd: "/w",
        scope: { appendSystemPrompt: ["/t/persona.md"], noContextFiles: true },
      });
      expect(argv).toContain("--append-system-prompt");
      expect(argv[argv.indexOf("--append-system-prompt") + 1]).toBe("/t/persona.md");
      expect(argv).toContain("--no-context-files");
    });

    it("E2: two paths → two separate flag pairs, in order", () => {
      const argv = argvFor({ cwd: "/w", scope: { appendSystemPrompt: ["/a.md", "/b.md"] } });
      expect(argv).toEqual(["--append-system-prompt", "/a.md", "--append-system-prompt", "/b.md"]);
    });

    it("E3: relative / empty / NUL / non-string entries and non-boolean toggles are dropped", () => {
      const scope = {
        appendSystemPrompt: ["persona.md", "", "/x\u0000y", 5],
        noContextFiles: "yes",
      } as unknown as NonNullable<PluginSpawnOptions["scope"]>;
      expect(() => argvFor({ cwd: "/w", scope })).not.toThrow();
      const argv = argvFor({ cwd: "/w", scope });
      expect(argv).not.toContain("--append-system-prompt");
      expect(argv).not.toContain("--no-context-files");
    });

    it("E4: absent fields leave argv byte-identical; tools-only scope adds only --tools", () => {
      expect(argvFor({ cwd: "/w", model: "m" })).toEqual(["--model", "m"]);
      expect(argvFor({ cwd: "/w", scope: { tools: ["read"] } })).toEqual(["--tools", "read"]);
    });

    it("E29: noProjectTrust:true → --no-approve; non-boolean → absent", () => {
      expect(argvFor({ cwd: "/w", scope: { noProjectTrust: true } })).toContain("--no-approve");
      const bad = { noProjectTrust: "yes" } as unknown as NonNullable<PluginSpawnOptions["scope"]>;
      expect(argvFor({ cwd: "/w", scope: bad })).not.toContain("--no-approve");
    });

    it("E39: sessionDir → --session-dir only for a clean absolute path", () => {
      const argv = argvFor({ cwd: "/w", scope: { sessionDir: "/s/--repo--" } });
      expect(argv).toEqual(["--session-dir", "/s/--repo--"]);
      for (const bad of ["rel", "", "/x\u0000y"]) {
        expect(argvFor({ cwd: "/w", scope: { sessionDir: bad } })).not.toContain("--session-dir");
      }
      const nonString = { sessionDir: 5 } as unknown as NonNullable<PluginSpawnOptions["scope"]>;
      expect(argvFor({ cwd: "/w", scope: nonString })).not.toContain("--session-dir");
    });
  });
});
