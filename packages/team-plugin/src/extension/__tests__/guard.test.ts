/**
 * Team guard: tool presets + path confinement (E21–E23, E34).
 * See change: add-team-plugin.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decideToolCall, PRESET_TOOLS, policyFromEnv } from "../guard.js";
import teamGuard, { createToolCallHandler } from "../index.js";

let tmp: string;
let ws: string;
let other: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "team-guard-")));
  ws = path.join(tmp, "uk-alice", "workspace");
  other = path.join(tmp, "uk-bob", "workspace");
  fs.mkdirSync(ws, { recursive: true });
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(ws, "notes.md"), "x");
  fs.writeFileSync(path.join(other, "notes.md"), "y");
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const ALL_TOOLS = ["read", "grep", "ls", "find", "write", "edit", "bash", "update_roles", "canvas", "codemode", "mcp__x"];

describe("E21: name gate per preset", () => {
  for (const preset of ["chat", "files", "full"] as const) {
    it(`${preset}: exactly the preset names are allowed`, () => {
      for (const tool of ALL_TOOLS) {
        const d = decideToolCall(tool, {}, { preset, root: ws });
        expect(d.allow, `${preset}/${tool}`).toBe(PRESET_TOOLS[preset].includes(tool));
      }
    });
  }

  it("block result carries block:true via the handler", () => {
    const h = createToolCallHandler({ preset: "chat", root: ws });
    expect(h({ toolName: "write", input: { path: "a" } })).toMatchObject({ block: true });
    expect(h({ toolName: "bash", input: {} })).toMatchObject({ block: true });
    expect(h({ toolName: "update_roles", input: {} })).toMatchObject({ block: true });
    expect(h({ toolName: "read", input: { path: "notes.md" } })).toBeUndefined();
  });

  it("unnamed / non-string tool names are blocked", () => {
    expect(decideToolCall(undefined, {}, { preset: "full", root: ws }).allow).toBe(false);
    expect(decideToolCall(42, {}, { preset: "full", root: ws }).allow).toBe(false);
  });
});

describe("E22: path gate rooted at the own workspace", () => {
  const policy = () => ({ preset: "files" as const, root: ws });

  it("inside / outside / escaping / symlink / new-outside / no-path", () => {
    fs.symlinkSync("/etc", path.join(ws, "link"));
    expect(decideToolCall("read", { path: "notes.md" }, policy()).allow).toBe(true);
    expect(decideToolCall("read", { path: "../../uk-bob/workspace/notes.md" }, policy()).allow).toBe(false);
    expect(decideToolCall("read", { path: "/etc/passwd" }, policy()).allow).toBe(false);
    expect(decideToolCall("read", { path: "link/passwd" }, policy()).allow).toBe(false);
    expect(decideToolCall("write", { path: "../other/new.txt" }, policy()).allow).toBe(false);
    expect(decideToolCall("ls", {}, policy()).allow).toBe(true);
    expect(decideToolCall("grep", { pattern: "x" }, policy()).allow).toBe(true);
  });

  it("pi path normalisation cannot bypass: @-prefix, ~, NUL, unicode spaces", () => {
    expect(decideToolCall("read", { path: "@/etc/passwd" }, policy()).allow).toBe(false);
    expect(decideToolCall("read", { path: "~/.ssh/id_rsa" }, policy()).allow).toBe(false);
    expect(decideToolCall("read", { path: "a\0b" }, policy()).allow).toBe(false);
    expect(decideToolCall("read", { path: "@notes.md" }, policy()).allow).toBe(true);
  });

  it("a new file inside the root is allowed", () => {
    expect(decideToolCall("write", { path: "sub/new.txt" }, policy()).allow).toBe(true);
  });
});

describe("E23: fail closed", () => {
  it("missing / garbage env ⇒ no policy ⇒ everything blocked", () => {
    expect(policyFromEnv({})).toBeNull();
    expect(policyFromEnv({ PI_EXT_TEAM_TOOLS: "root", PI_EXT_TEAM_ROOT: ws })).toBeNull();
    expect(policyFromEnv({ PI_EXT_TEAM_TOOLS: "chat", PI_EXT_TEAM_ROOT: "relative" })).toBeNull();
    expect(decideToolCall("read", { path: "notes.md" }, null).allow).toBe(false);
  });

  it("valid env parses", () => {
    expect(policyFromEnv({ PI_EXT_TEAM_TOOLS: "files", PI_EXT_TEAM_ROOT: ws })).toEqual({ preset: "files", root: ws });
  });

  it("non-string path argument is blocked", () => {
    expect(decideToolCall("read", { path: 5 }, { preset: "chat", root: ws }).allow).toBe(false);
    expect(decideToolCall("read", { path: { a: 1 } }, { preset: "chat", root: ws }).allow).toBe(false);
  });
});

describe("E34: path gate rooted at a project", () => {
  it("project root P", () => {
    const P = path.join(tmp, "proj");
    const outside = path.join(tmp, "other-repo");
    fs.mkdirSync(path.join(P, "src"), { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(P, "src", "a.ts"), "");
    fs.writeFileSync(path.join(outside, "README.md"), "");
    fs.symlinkSync(outside, path.join(P, "link"));
    const pol = { preset: "files" as const, root: P };
    expect(decideToolCall("read", { path: "src/a.ts" }, pol).allow).toBe(true);
    expect(decideToolCall("read", { path: "../other/x" }, pol).allow).toBe(false);
    expect(decideToolCall("read", { path: "link/README.md" }, pol).allow).toBe(false);
    expect(decideToolCall("read", { path: path.join(P, "src", "a.ts") }, pol).allow).toBe(true);
    expect(decideToolCall("ls", {}, pol).allow).toBe(true);
  });
});

describe("extension entry", () => {
  it("registers tool_call and announces readiness only with a valid policy", () => {
    vi.useFakeTimers();
    const handlers: Record<string, (e: unknown, c: unknown) => unknown> = {};
    const emitted: unknown[] = [];
    const pi = {
      on: (ev: string, h: (e: unknown, c: unknown) => unknown) => {
        handlers[ev] = h;
      },
      events: { emit: (_n: string, p: unknown) => emitted.push(p) },
    };
    teamGuard(pi, { policy: { preset: "chat", root: ws } });
    handlers.session_start({}, {});
    expect(emitted[0]).toMatchObject({ pluginId: "team", messageType: "team_guard_ready" });

    const emitted2: unknown[] = [];
    teamGuard({ ...pi, events: { emit: (_n: string, p: unknown) => emitted2.push(p) } }, { policy: null });
    handlers.session_start({}, {});
    vi.advanceTimersByTime(10_000);
    expect(emitted2).toHaveLength(0);
    vi.useRealTimers();
  });
});
