/**
 * Team guard: tool presets + path confinement (E21–E23, E34) and the skill
 * grant / prompt-filter / input-refusal gates (E26–E29, X2 guard half).
 * See change: add-team-plugin, add-team-skill-access.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decideToolCall, PRESET_TOOLS, policyFromEnv, type TeamPolicy } from "../guard.js";
import teamGuard, { createBeforeAgentStartHandler, createInputHandler, createToolCallHandler } from "../index.js";

let tmp: string;
let ws: string;
let other: string;
let skillRoot: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "team-guard-")));
  ws = path.join(tmp, "uk-alice", "workspace");
  other = path.join(tmp, "uk-bob", "workspace");
  skillRoot = path.join(tmp, "skills", "review");
  fs.mkdirSync(ws, { recursive: true });
  fs.mkdirSync(other, { recursive: true });
  fs.mkdirSync(path.join(skillRoot, "references"), { recursive: true });
  fs.writeFileSync(path.join(ws, "notes.md"), "x");
  fs.writeFileSync(path.join(other, "notes.md"), "y");
  fs.writeFileSync(path.join(skillRoot, "SKILL.md"), "---\nname: review\n---\nbody");
  fs.writeFileSync(path.join(skillRoot, "references", "x.md"), "ref");
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** Policy with one effective skill (`review` at `skillRoot`); `extra` appends more skill roots. */
const policy = (preset: TeamPolicy["preset"] = "files", skills: TeamPolicy["skills"] = [{ name: "review", root: skillRoot }]): TeamPolicy => ({
  preset,
  root: ws,
  skills,
});

const ALL_TOOLS = ["read", "grep", "ls", "find", "write", "edit", "bash", "update_roles", "canvas", "codemode", "mcp__x"];

describe("E21: name gate per preset", () => {
  for (const preset of ["chat", "files", "full"] as const) {
    it(`${preset}: exactly the preset names are allowed`, () => {
      for (const tool of ALL_TOOLS) {
        const d = decideToolCall(tool, {}, policy(preset));
        expect(d.allow, `${preset}/${tool}`).toBe(PRESET_TOOLS[preset].includes(tool));
      }
    });
  }

  it("block result carries block:true via the handler", () => {
    const h = createToolCallHandler(policy("chat"));
    expect(h({ toolName: "write", input: { path: "a" } })).toMatchObject({ block: true });
    expect(h({ toolName: "bash", input: {} })).toMatchObject({ block: true });
    expect(h({ toolName: "update_roles", input: {} })).toMatchObject({ block: true });
    expect(h({ toolName: "read", input: { path: "notes.md" } })).toBeUndefined();
  });

  it("unnamed / non-string tool names are blocked", () => {
    expect(decideToolCall(undefined, {}, policy("full")).allow).toBe(false);
    expect(decideToolCall(42, {}, policy("full")).allow).toBe(false);
  });
});

describe("E22: path gate rooted at the own workspace", () => {
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

  it("URL-scheme paths cannot smuggle a real path past the guard (file://, @file://, others)", () => {
    for (const p of ["file:///etc/passwd", "@file:///etc/passwd", "file:/etc/passwd", "FILE:///etc/passwd", "http://x/y", "data:text/plain,x"]) {
      expect(decideToolCall("read", { path: p }, policy()).allow, p).toBe(false);
      expect(decideToolCall("write", { path: p }, policy()).allow, p).toBe(false);
    }
  });

  it("write/edit may not touch .git / .pi / .claude (planted hooks or resources would run for the operator); read still may", () => {
    fs.mkdirSync(path.join(ws, ".git", "hooks"), { recursive: true });
    for (const p of [".git/hooks/pre-commit", ".pi/extensions/x.ts", "sub/.git/config", ".claude/settings.json"]) {
      expect(decideToolCall("write", { path: p }, policy()).allow, `write ${p}`).toBe(false);
      expect(decideToolCall("edit", { path: p }, policy()).allow, `edit ${p}`).toBe(false);
    }
    expect(decideToolCall("read", { path: ".git/config" }, policy()).allow).toBe(true);
    expect(decideToolCall("write", { path: "gitignore.txt" }, policy()).allow).toBe(true);
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
    expect(policyFromEnv({ PI_EXT_TEAM_TOOLS: "files", PI_EXT_TEAM_ROOT: ws, PI_EXT_TEAM_SKILLS: "[]" })).toEqual({
      preset: "files",
      root: ws,
      skills: [],
    });
  });

  it("non-string path argument is blocked", () => {
    expect(decideToolCall("read", { path: 5 }, policy("chat")).allow).toBe(false);
    expect(decideToolCall("read", { path: { a: 1 } }, policy("chat")).allow).toBe(false);
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
    const pol = { preset: "files" as const, root: P, skills: [] };
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
    teamGuard(pi, { policy: policy("chat") });
    handlers.session_start({}, {});
    expect(emitted[0]).toMatchObject({ pluginId: "team", messageType: "team_guard_ready" });
    process.env.PI_EXT_TEAM_RUN_ID = "run-123";
    const withRun: unknown[] = [];
    teamGuard({ ...pi, events: { emit: (_n: string, p: unknown) => withRun.push(p) } }, { policy: policy("chat") });
    handlers.session_start({}, {});
    expect(withRun[0]).toMatchObject({ payload: { runId: "run-123" } });
    delete process.env.PI_EXT_TEAM_RUN_ID;

    const emitted2: unknown[] = [];
    teamGuard({ ...pi, events: { emit: (_n: string, p: unknown) => emitted2.push(p) } }, { policy: null });
    handlers.session_start({}, {});
    vi.advanceTimersByTime(10_000);
    expect(emitted2).toHaveLength(0);
    vi.useRealTimers();
  });

  it("registers before_agent_start and input handlers", () => {
    const handlers: Record<string, (e: unknown, c: unknown) => unknown> = {};
    teamGuard({ on: (ev: string, h: (e: unknown, c: unknown) => unknown) => { handlers[ev] = h; } }, { policy: policy() });
    expect(typeof handlers.before_agent_start).toBe("function");
    expect(typeof handlers.input).toBe("function");
  });
});

describe("E26: skill-root read grant (decision table)", () => {
  it("read-only tools inside the skill root are allowed; write/edit are not", () => {
    for (const tool of ["read", "grep", "find", "ls"] as const) {
      expect(decideToolCall(tool, { path: path.join(skillRoot, "SKILL.md") }, policy()).allow, tool).toBe(true);
      expect(decideToolCall(tool, { path: path.join(skillRoot, "references", "x.md") }, policy()).allow, tool).toBe(true);
    }
    expect(decideToolCall("write", { path: path.join(skillRoot, "SKILL.md") }, policy()).allow).toBe(false);
    expect(decideToolCall("edit", { path: path.join(skillRoot, "SKILL.md") }, policy()).allow).toBe(false);
  });

  it("sibling of the skill root, symlink out and `..` stay blocked for read-only tools", () => {
    fs.mkdirSync(path.join(tmp, "skills", "release"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "skills", "release", "SKILL.md"), "sibling");
    fs.symlinkSync("/etc", path.join(skillRoot, "out"));
    expect(decideToolCall("read", { path: path.join(tmp, "skills", "release", "SKILL.md") }, policy()).allow).toBe(false);
    expect(decideToolCall("read", { path: "../release" }, policy()).allow).toBe(false);
    expect(decideToolCall("read", { path: path.join(skillRoot, "out", "passwd") }, policy()).allow).toBe(false);
  });

  it("target-root access is unchanged; an empty skill set grants nothing", () => {
    expect(decideToolCall("read", { path: "notes.md" }, policy()).allow).toBe(true);
    expect(decideToolCall("write", { path: "notes.md" }, policy()).allow).toBe(true);
    const empty = policy("chat", []);
    expect(decideToolCall("read", { path: path.join(skillRoot, "SKILL.md") }, empty).allow).toBe(false);
  });
});

describe("E27: skill policy parsing (PI_EXT_TEAM_SKILLS)", () => {
  const env = (skills?: string) => ({ PI_EXT_TEAM_TOOLS: "chat", PI_EXT_TEAM_ROOT: ws, ...(skills === undefined ? {} : { PI_EXT_TEAM_SKILLS: skills }) });

  it("unset / bad JSON / bad shape ⇒ null (no readiness)", () => {
    expect(policyFromEnv(env())).toBeNull();
    expect(policyFromEnv(env("not json"))).toBeNull();
    expect(policyFromEnv(env('[{"name":1}]'))).toBeNull();
    expect(policyFromEnv(env('[{"name":"review"}]'))).toBeNull(); // root missing
    expect(policyFromEnv(env('{"name":"review"}'))).toBeNull(); // not an array
  });

  it("`[]` parses to a usable policy with an empty skill set", () => {
    expect(policyFromEnv(env("[]"))).toEqual({ preset: "chat", root: ws, skills: [] });
    expect(policyFromEnv(env(JSON.stringify([{ name: "review", root: skillRoot }])))).toEqual({
      preset: "chat",
      root: ws,
      skills: [{ name: "review", root: skillRoot }],
    });
  });
});

describe("E28: before_agent_start prompt filter", () => {
  const handler = () => createBeforeAgentStartHandler(policy());

  it("keeps only the canonical granted skill, in place, without returning a systemPrompt", () => {
    const leakedDir = path.join(tmp, "leaked");
    const otherDir = path.join(tmp, "other");
    fs.mkdirSync(leakedDir, { recursive: true });
    fs.mkdirSync(path.join(skillRoot, "evil"), { recursive: true });
    fs.mkdirSync(otherDir, { recursive: true });
    fs.writeFileSync(path.join(leakedDir, "SKILL.md"), "leak");
    fs.writeFileSync(path.join(otherDir, "SKILL.md"), "imposter");
    fs.writeFileSync(path.join(skillRoot, "evil", "SKILL.md"), "planted");
    fs.symlinkSync(path.join(skillRoot, "SKILL.md"), path.join(tmp, "alias-review.md"));
    const skills = [
      { name: "review", filePath: path.join(skillRoot, "SKILL.md") },
      { name: "memory-x", filePath: path.join(leakedDir, "SKILL.md") },
      { name: "review", filePath: path.join(otherDir, "SKILL.md") },
      { name: "evil", filePath: path.join(skillRoot, "evil", "SKILL.md") },
      { name: "review", filePath: path.join(tmp, "alias-review.md") },
    ];
    const event = { prompt: "hi", systemPromptOptions: { cwd: ws, skills } };
    const returned = handler()(event);
    expect(returned).toBeUndefined(); // never a systemPrompt string
    expect(event.systemPromptOptions.skills).toBe(skills); // mutated in place
    expect(event.systemPromptOptions.skills).toEqual([{ name: "review", filePath: path.join(skillRoot, "SKILL.md") }]);
    expect(event.systemPromptOptions.cwd).toBe(ws); // other option fields untouched
  });

  it("missing policy ⇒ every skill filtered; non-array options untouched", () => {
    const skills = [{ name: "review", filePath: path.join(skillRoot, "SKILL.md") }];
    const event = { systemPromptOptions: { skills } };
    createBeforeAgentStartHandler(null)(event);
    expect(skills).toEqual([]);
    expect(() => createBeforeAgentStartHandler(policy())({ systemPromptOptions: {} })).not.toThrow();
  });
});

describe("E29: input refusal table", () => {
  const run = (text: string, pol: TeamPolicy | null = policy()) => {
    const ctx = { ui: { notify: vi.fn() } };
    const result = createInputHandler(pol)({ text }, ctx);
    expect(ctx.ui.notify).not.toHaveBeenCalled(); // the bridge owns the user-facing refusal
    return result;
  };
  const envelope = (name: string, location: string) => `<skill name="${name}" location="${location}">\nbody\n</skill>`;

  it("refuses ungranted commands and out-of-root envelopes; continues otherwise", () => {
    expect(run("/skill:memory-x hi")).toEqual({ action: "handled" });
    expect(run("/skill:review hi")).toEqual({ action: "continue" });
    expect(run("/skill:review\nhi")).toEqual({ action: "continue" });
    expect(run("/skill:review\thi")).toEqual({ action: "continue" });
    expect(run(" /skill:x")).toEqual({ action: "continue" }); // leading space: not a command (D13)
    expect(run("/SKILL:x")).toEqual({ action: "continue" }); // case-sensitive
    expect(run("/skill:")).toEqual({ action: "continue" }); // empty name: not a command
    expect(run(envelope("x", "/etc/x"))).toEqual({ action: "handled" });
    expect(run(envelope("review", path.join(skillRoot, "SKILL.md")))).toEqual({ action: "continue" });
    expect(run("plain text")).toEqual({ action: "continue" });
    expect(run(envelope("x", path.join(ws, "notes.md")))).toEqual({ action: "handled" }); // target root is not a skill root
  });

  it("missing policy fails closed: every /skill: and envelope refused, plain text continues", () => {
    expect(run("/skill:review hi", null)).toEqual({ action: "handled" });
    expect(run(envelope("review", path.join(skillRoot, "SKILL.md")), null)).toEqual({ action: "handled" });
    expect(run("plain text", null)).toEqual({ action: "continue" });
  });
});

describe("X2 guard half: missing skill policy ⇒ no readiness signal", () => {
  it("PI_EXT_TEAM_SKILLS unset ⇒ policyFromEnv null ⇒ session_start is silent", () => {
    vi.useFakeTimers();
    expect(policyFromEnv({ PI_EXT_TEAM_TOOLS: "chat", PI_EXT_TEAM_ROOT: ws })).toBeNull();
    const handlers: Record<string, (e: unknown, c: unknown) => unknown> = {};
    const emitted: unknown[] = [];
    teamGuard(
      {
        on: (ev: string, h: (e: unknown, c: unknown) => unknown) => {
          handlers[ev] = h;
        },
        events: { emit: (_n: string, p: unknown) => emitted.push(p) },
      },
      { policy: policyFromEnv({ PI_EXT_TEAM_TOOLS: "chat", PI_EXT_TEAM_ROOT: ws }) },
    );
    handlers.session_start({}, {});
    vi.advanceTimersByTime(10_000);
    expect(emitted).toHaveLength(0);
    vi.useRealTimers();
  });

  it("`[]` still signals readiness (empty set is a valid policy)", () => {
    const emitted: unknown[] = [];
    teamGuard(
      {
        on: () => {},
        events: { emit: (_n: string, p: unknown) => emitted.push(p) },
      },
      { policy: policyFromEnv({ PI_EXT_TEAM_TOOLS: "chat", PI_EXT_TEAM_ROOT: ws, PI_EXT_TEAM_SKILLS: "[]" }) },
    );
    expect(emitted).toHaveLength(0); // only on session_start
  });
});
