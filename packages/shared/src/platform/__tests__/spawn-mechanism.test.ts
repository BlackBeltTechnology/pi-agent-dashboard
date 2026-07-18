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
