/**
 * `sessionFlagsToArgv` — `--name` emission + composition (pi 0.78.0+).
 *
 * The `--name` flag sets the pi session name AT CREATION so worktree / flow
 * spawns land with an intended title. It composes with `--session` / `--fork`
 * / `--model` across all three return paths and is emitted only for a
 * non-empty string. The name is a single argv element (never shell-split), so
 * quotes / spaces pass through verbatim with no injection surface.
 *
 * See change: adopt-pi-074-080-features (B.1.3 — E3, E4, E8).
 */
import { describe, expect, it } from "vitest";
import { sessionFlagsToArgv } from "../spawn-mechanism.js";

describe("sessionFlagsToArgv --name", () => {
  it("E3: empty name emits NO --name token", () => {
    expect(sessionFlagsToArgv({ name: "" })).not.toContain("--name");
    expect(sessionFlagsToArgv({ name: "" })).toEqual([]);
  });

  it("unnamed spawn is unchanged (no --name)", () => {
    expect(sessionFlagsToArgv({})).toEqual([]);
    expect(sessionFlagsToArgv({ model: "m" })).toEqual(["--model", "m"]);
  });

  it("named spawn emits --name followed by the name", () => {
    const argv = sessionFlagsToArgv({ name: "review-worktree" });
    expect(argv).toContain("--name");
    expect(argv[argv.indexOf("--name") + 1]).toBe("review-worktree");
  });

  it("E4: --name composes with --fork and --model (fork path)", () => {
    const argv = sessionFlagsToArgv({ name: "x", sessionFile: "/s.jsonl", mode: "fork", model: "m" });
    expect(argv).toContain("--name");
    expect(argv[argv.indexOf("--name") + 1]).toBe("x");
    expect(argv).toContain("--fork");
    expect(argv[argv.indexOf("--fork") + 1]).toBe("/s.jsonl");
    expect(argv).toContain("--model");
    expect(argv[argv.indexOf("--model") + 1]).toBe("m");
  });

  it("E4: --name is also present on the --session (continue) path", () => {
    const argv = sessionFlagsToArgv({ name: "x", sessionFile: "/s.jsonl", mode: "continue" });
    expect(argv).toContain("--name");
    expect(argv[argv.indexOf("--name") + 1]).toBe("x");
    expect(argv).toContain("--session");
    expect(argv[argv.indexOf("--session") + 1]).toBe("/s.jsonl");
  });

  it("E8: a name with quotes/spaces is a single argv element, verbatim", () => {
    const tricky = 'a "b" c';
    const argv = sessionFlagsToArgv({ name: tricky });
    // Exactly one element equals the full name — no splitting on spaces/quotes.
    expect(argv.filter((a) => a === tricky)).toHaveLength(1);
    expect(argv).toEqual(["--name", tricky]);
  });
});

/**
 * `sessionFlagsToArgv` — capability-scope flag emission (add-plugin-spawn-scope).
 *
 * These assert the flat-field → argv contract that `pluginSpawnToSessionOptions`
 * produces: comma-joined allowlists, repeatable `--skill` / `-e`, bare boolean
 * toggles, empty-array-emits-nothing, and the invariant that `--no-extensions`
 * is NEVER emitted (design D2). The mapper's input-sanitization path (dropping
 * non-string / NUL entries) is covered in the dashboard-plugin-runtime mapper
 * suite, since sanitization lives in the mapper, not this builder.
 */
describe("sessionFlagsToArgv capability-scope", () => {
  it("E2: partial scope — tools only, no other scope flag", () => {
    const argv = sessionFlagsToArgv({ tools: ["read"] });
    expect(argv).toEqual(["--tools", "read"]);
    expect(argv).not.toContain("--skill");
    expect(argv).not.toContain("-e");
    expect(argv).not.toContain("--no-builtin-tools");
  });

  it("E3: allowlist is a single comma-joined arg", () => {
    const argv = sessionFlagsToArgv({ tools: ["read", "grep", "ls"] });
    expect(argv).toEqual(["--tools", "read,grep,ls"]);
    expect(argv[argv.indexOf("--tools") + 1]).toBe("read,grep,ls");
  });

  it("E3: excludeTools is a single comma-joined arg", () => {
    expect(sessionFlagsToArgv({ excludeTools: ["write", "bash"] })).toEqual([
      "--exclude-tools",
      "write,bash",
    ]);
  });

  it("E4: --skill repeats once per entry", () => {
    const argv = sessionFlagsToArgv({ skills: ["/a/skill.md", "/b/skill.md"] });
    expect(argv).toEqual(["--skill", "/a/skill.md", "--skill", "/b/skill.md"]);
  });

  it("E5: -e repeats once per entry", () => {
    const argv = sessionFlagsToArgv({ extensions: ["/x/ext.js", "/y/ext.js"] });
    expect(argv).toEqual(["-e", "/x/ext.js", "-e", "/y/ext.js"]);
  });

  it("E6: boolean toggles emit bare flags", () => {
    const argv = sessionFlagsToArgv({ noTools: true, noSkills: true, noBuiltinTools: true });
    expect(argv).toContain("--no-tools");
    expect(argv).toContain("--no-skills");
    expect(argv).toContain("--no-builtin-tools");
  });

  it("E7: an empty allowlist emits no flag", () => {
    expect(sessionFlagsToArgv({ tools: [] })).toEqual([]);
    expect(sessionFlagsToArgv({ extensions: [], skills: [] })).toEqual([]);
  });

  it("E8: conflicting noTools + tools are BOTH forwarded", () => {
    const argv = sessionFlagsToArgv({ noTools: true, tools: ["read"] });
    expect(argv).toContain("--no-tools");
    expect(argv).toContain("--tools");
    expect(argv[argv.indexOf("--tools") + 1]).toBe("read");
  });

  it("E14: --no-extensions is NEVER emitted, even with every boolean set", () => {
    const argv = sessionFlagsToArgv({
      tools: ["read"],
      excludeTools: ["write"],
      noBuiltinTools: true,
      noTools: true,
      skills: ["/s.md"],
      noSkills: true,
      extensions: ["/e.js"],
    });
    expect(argv).not.toContain("--no-extensions");
  });

  it("scope flags append after session/model/name (byte-identical prefix)", () => {
    const argv = sessionFlagsToArgv({
      name: "n",
      sessionFile: "/s.jsonl",
      mode: "fork",
      model: "m",
      tools: ["read"],
    });
    expect(argv).toEqual(["--name", "n", "--fork", "/s.jsonl", "--model", "m", "--tools", "read"]);
  });

  it("E1: no scope fields ⇒ byte-identical to pre-scope output", () => {
    expect(sessionFlagsToArgv({})).toEqual([]);
    expect(sessionFlagsToArgv({ model: "m" })).toEqual(["--model", "m"]);
  });
});
