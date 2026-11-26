/**
 * Unit tests for `toolWorkdir` — the pure, literal-only derivation of a tool call's working
 * directory (design D4). Only a string `cwd`/`workdir` argument and ONE leading literal
 * `cd <dir> &&` count; everything shell-dynamic is deliberately ignored (fuzzy covers it).
 *
 * See change: rich-chat-links (task 2.1, test-plan #E15).
 */
import { describe, expect, it } from "vitest";
import { toolWorkdir } from "../tool-workdir.js";

const bash = (command: string, extra: Record<string, unknown> = {}) => toolWorkdir("bash", { command, ...extra });

describe("toolWorkdir — literal `cd <dir> &&` (E15)", () => {
  it.each([
    ["cd packages/client && rg x", "packages/client"],
    ['cd "my dir" && ls', "my dir"],
    ["cd 'a b' && ls", "a b"],
    ["  cd a&&ls", "a"],
    ["cd /abs/dir && ls", "/abs/dir"],
  ])("%j → %j", (command, expected) => {
    expect(bash(command)).toBe(expected);
  });

  it.each([
    ["cd a; ls"],
    ["cd $P && ls"],
    ["cd `pwd` && ls"],
    ["cd ~/x && ls"],
    ["cd - && ls"],
    ["cd a* && ls"],
    ["cd a\\b && ls"],
    ["ls && cd a && ls"],
    ["cd a && cd b && ls"],
    ['cd "$HOME/x" && ls'],
    ['cd "~/x" && ls'],
    ['cd "" && ls'],
    ["cd a || ls"],
    ["cd && ls"],
    ["cd (a) && ls"],
    ["rg x"],
  ])("ignores non-literal / unsupported form %j", (command) => {
    expect(bash(command)).toBeUndefined();
  });
});

describe("toolWorkdir — working-directory arguments (E15)", () => {
  it("returns a string `cwd` argument as the base", () => {
    expect(toolWorkdir("bash", { command: "ls", cwd: "/w/r/pkg" })).toBe("/w/r/pkg");
  });

  it("returns a string `workdir` argument as the base", () => {
    expect(toolWorkdir("bash", { command: "ls", workdir: "/w/r/pkg" })).toBe("/w/r/pkg");
    expect(toolWorkdir("other-tool", { workdir: "/w/x" })).toBe("/w/x");
  });

  it("resolves a relative `cd` against the base", () => {
    expect(bash("cd sub && ls", { cwd: "/w/r/pkg" })).toBe("/w/r/pkg/sub");
    expect(bash("cd ../sib && ls", { cwd: "/w/r/pkg" })).toBe("/w/r/sib");
    expect(bash("cd ./sub && ls", { cwd: "/w/r/pkg/" })).toBe("/w/r/pkg/sub");
  });

  it("an absolute `cd` target ignores the base", () => {
    expect(bash("cd /abs && ls", { cwd: "/w/r/pkg" })).toBe("/abs");
  });

  it("a non-literal `cd` falls back to the base", () => {
    expect(bash("cd $P && ls", { cwd: "/w/r/pkg" })).toBe("/w/r/pkg");
  });

  it("a non-string `workdir`/`cwd` yields none", () => {
    expect(toolWorkdir("bash", { command: "ls", workdir: 1 })).toBeUndefined();
    expect(toolWorkdir("bash", { command: "ls", cwd: { a: 1 } })).toBeUndefined();
    expect(toolWorkdir("bash", { command: "ls", cwd: "" })).toBeUndefined();
  });

  it("tolerates missing / non-object args and a non-string command", () => {
    expect(toolWorkdir("bash", undefined)).toBeUndefined();
    expect(toolWorkdir("bash", null)).toBeUndefined();
    expect(toolWorkdir("bash", "cd a && ls")).toBeUndefined();
    expect(toolWorkdir("bash", { command: 5 })).toBeUndefined();
  });

  it("only bash commands are parsed for `cd`", () => {
    expect(toolWorkdir("read", { command: "cd a && ls" })).toBeUndefined();
  });
});
