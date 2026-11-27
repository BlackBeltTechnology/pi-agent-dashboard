/**
 * Teammate guard layers (test-plan S46–S49 git/sleep/tool/skill, S99 bypass
 * boundary, S121 busy-wait): pure decisions + the pi event handlers, over real
 * temp directories for the skill-root checks.
 * See change: add-agent-teams-core.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSkillBlock } from "@blackbelt-technology/pi-dashboard-shared/skill-block-parser.js";
import { describe, expect, it } from "vitest";
import { createTeamsEnv, linkBridge } from "../../__tests__/harness/index.js";
import { ENV_OPENSPEC_PROFILE } from "../../shared/openspec-profile.js";
import { ENV_MEMBER, ENV_POLICY, ENV_TEAM_ID, parsePolicy, policyHash, serializePolicy, type TeammatePolicy } from "../../shared/policy.js";
import { TEAM_TOOLS_BY_ROLE } from "../../shared/protocol.js";
import {
  createBeforeAgentStartHandler,
  createInputHandler,
  createToolCallHandler,
  decideToolCall,
  type GuardState,
  hashOfEnvPolicy,
} from "../guard.js";
import { isProtectedOpenspecPath, nativeResolveEnv, OPENSPEC_SOLE_WRITER_REASON, openspecWriteBlock } from "../openspec-guard.js";
import { GIT_WRITE_REASON, isSleepPoll, SLEEP_REASON, splitSimpleCommands } from "../shell-guard.js";

const policy = (over: Partial<TeammatePolicy> = {}): TeammatePolicy => ({
  blockSleepPolling: true,
  blockGitWrite: true,
  committer: "lead",
  ...over,
});

const bash = (command: string, p: TeammatePolicy | null = policy()) => decideToolCall("bash", { command }, p);
const blocked = (d: ReturnType<typeof decideToolCall>): boolean => !d.allow;

describe("git-write guard (S46)", () => {
  it.each([
    "git commit -m x",
    "git -C sub commit",
    "git push",
    "git push origin main",
    "git reset --hard",
    "git reset --hard HEAD~1",
    "git rebase main",
    "git merge feature",
    'sh -c "git commit"',
    "GIT_DIR=x git commit",
    "env GIT_AUTHOR_NAME=a git commit -m x",
    "cd sub && git commit -am x",
    "git add . ; git commit -m x",
    "git -c user.name=a commit",
    "/usr/bin/git push",
    "echo hi | git commit -F -",
  ])("committer:lead blocks %s with the lead-commits reason", (command) => {
    expect(bash(command)).toEqual({ allow: false, reason: GIT_WRITE_REASON });
  });

  it.each(["git status", "git diff", "git log --oneline", "git reset --soft HEAD~1", "git add -A", "echo git commit", 'echo "git push"', "git stash list", "npm test"])(
    "allows %s",
    (command) => {
      expect(bash(command).allow).toBe(true);
    },
  );

  it("committer:member (that member only) and blockGitWrite:false allow the writes", () => {
    expect(bash("git commit -m x", policy({ committer: "member" })).allow).toBe(true);
    expect(bash("git push", policy({ blockGitWrite: false })).allow).toBe(true);
    expect(bash("git commit -m x", policy()).allow).toBe(false);
  });
});

describe("sleep-poll guard (S47)", () => {
  it.each(["sleep 10", "sleep 11", "sleep 20", "sleep 1e3", "sleep 10s", "sleep 10m", "sleep 5 5", "sleep 10;", "sleep 1h", "sleep 9.5 0.5", "sleep infinity", "/bin/sleep 30"])(
    "blocks %s with the end-your-turn reason",
    (command) => {
      expect(bash(command)).toEqual({ allow: false, reason: SLEEP_REASON });
      expect(SLEEP_REASON).toContain("end your turn");
    },
  );

  it.each(["sleep 9", "sleep 9.99", "sleep 0.5", "sleep 5 4", "sleep 20 && echo hi", "echo hi; sleep 20", "sleep 20 | cat", "npm test", "sleep", "sleep abc", "echo sleep 20"])(
    "allows %s",
    (command) => {
      expect(bash(command).allow).toBe(true);
    },
  );

  it("blockSleepPolling:false allows everything", () => {
    expect(bash("sleep 20", policy({ blockSleepPolling: false })).allow).toBe(true);
  });

  it("boundary: 9 allowed, 10 blocked (BVA)", () => {
    expect(isSleepPoll("sleep 9")).toBe(false);
    expect(isSleepPoll("sleep 10")).toBe(true);
  });

  it("the tool_call sequence of the spike busy-wait: sleep 20 is blocked, npm test is allowed", () => {
    const onToolCall = createToolCallHandler({ enabled: true, policy: policy() });
    expect(onToolCall({ toolName: "bash", input: { command: "sleep 20" } })).toMatchObject({ block: true, reason: expect.stringContaining("end your turn") });
    expect(onToolCall({ toolName: "bash", input: { command: "npm test" } })).toBeUndefined();
  });
});

describe("command splitting", () => {
  it("respects quotes and separators", () => {
    expect(splitSimpleCommands('echo "a; b" && git commit -m \'x y\'')).toEqual([["echo", "a; b"], ["git", "commit", "-m", "x y"]]);
    expect(splitSimpleCommands("a | b ; c\nd")).toEqual([["a"], ["b"], ["c"], ["d"]]);
    expect(splitSimpleCommands("")).toEqual([]);
  });
});

describe("tool allowlist backstop (S48)", () => {
  const TEAM = [...TEAM_TOOLS_BY_ROLE.member];

  it("unset = unrestricted; a list gates by name; team tools always pass; [] means only team tools", () => {
    expect(decideToolCall("bash", { command: "ls" }, policy()).allow).toBe(true);
    const ro = policy({ tools: ["read", "grep", "find", "ls", ...TEAM] });
    expect(decideToolCall("read", { path: "a.ts" }, ro).allow).toBe(true);
    expect(decideToolCall("bash", { command: "ls" }, ro)).toEqual({ allow: false, reason: "tool_not_allowed: bash" });
    expect(decideToolCall("write", { path: "a.ts" }, ro).allow).toBe(false);
    const none = policy({ tools: [] });
    expect(decideToolCall("read", {}, none).allow).toBe(false);
    for (const t of TEAM) expect(decideToolCall(t, {}, none).allow).toBe(true);
  });

  it("a missing policy fails closed; a non-string tool name is refused", () => {
    expect(decideToolCall("read", {}, null)).toEqual({ allow: false, reason: "policy_unavailable" });
    expect(decideToolCall(undefined, {}, policy())).toEqual({ allow: false, reason: "tool_not_allowed" });
  });

  it("the tool_call handler returns {block, reason} or nothing, and is inert once the session left the team", () => {
    const state: GuardState = { enabled: true, policy: policy({ tools: ["read"] }) };
    const h = createToolCallHandler(state);
    expect(h({ toolName: "bash", input: { command: "ls" } })).toMatchObject({ block: true, reason: expect.stringContaining("agent-teams") });
    expect(h({ toolName: "read", input: {} })).toBeUndefined();
    state.enabled = false;
    expect(h({ toolName: "bash", input: { command: "ls" } })).toBeUndefined();
  });
});

describe("skill layers (S49)", () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "at-skills-")));
  const skill = (name: string): { dir: string; file: string } => {
    const dir = path.join(root, name);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "SKILL.md");
    fs.writeFileSync(file, `---\nname: ${name}\n---\nbody of ${name}\n`);
    return { dir, file };
  };
  const a = skill("a");
  const b = skill("b");
  fs.symlinkSync(b.dir, path.join(root, "link-to-b"));
  const envelope = (s: { dir: string; file: string }, name: string) => buildSkillBlock({ name, filePath: s.file, baseDir: s.dir, body: "run it" });
  const prompt = () => [
    { name: "a", filePath: a.file },
    { name: "b", filePath: b.file }, // contributed by an extension
  ];
  const grantA = policy({ skills: [{ name: "a", root: a.dir }] });

  it("layer 2 (before_agent_start): only the allowlist stays in the prompt, in place; [] removes all; absent keeps all", () => {
    const filter = (p: TeammatePolicy) => {
      const skills = prompt();
      const event = { systemPromptOptions: { skills } };
      const out = createBeforeAgentStartHandler({ enabled: true, policy: p })(event);
      expect(out).toBeUndefined(); // never returns a systemPrompt
      expect(event.systemPromptOptions.skills).toBe(skills); // spliced in place
      return skills.map((s) => s.name);
    };
    expect(filter(grantA)).toEqual(["a"]);
    expect(filter(policy({ skills: [] }))).toEqual([]);
    expect(filter(policy())).toEqual(["a", "b"]);
    expect(filter(policy({ skills: [{ name: "a", root: a.dir }] }))).toEqual(["a"]); // a fresh predicate per start keeps the grant
  });

  it("layer 2 matches name AND canonical path: a same-named skill elsewhere is dropped", () => {
    const impostor = skill("impostor");
    const event = { systemPromptOptions: { skills: [{ name: "a", filePath: impostor.file }, { name: "a", filePath: a.file }] } };
    createBeforeAgentStartHandler({ enabled: true, policy: grantA })(event);
    expect(event.systemPromptOptions.skills).toEqual([{ name: "a", filePath: a.file }]);
  });

  it("layer 3 (input): an ungranted /skill: command and an out-of-root envelope are handled; the granted ones continue", () => {
    const h = createInputHandler({ enabled: true, policy: grantA });
    expect(h({ text: "/skill:b do it" })).toEqual({ action: "handled" });
    expect(h({ text: "/skill:a do it" })).toEqual({ action: "continue" });
    expect(h({ text: envelope(b, "b") })).toEqual({ action: "handled" });
    expect(h({ text: envelope(a, "a") })).toEqual({ action: "continue" });
    expect(h({ text: "plain text" })).toEqual({ action: "continue" });
    const none = createInputHandler({ enabled: true, policy: policy({ skills: [] }) });
    expect(none({ text: "/skill:a" })).toEqual({ action: "handled" });
    const open = createInputHandler({ enabled: true, policy: policy() });
    expect(open({ text: "/skill:b" })).toEqual({ action: "continue" });
    const closed = createInputHandler({ enabled: true, policy: null });
    expect(closed({ text: "/skill:a" })).toEqual({ action: "handled" });
    expect(createInputHandler({ enabled: false, policy: grantA })({ text: "/skill:b" })).toEqual({ action: "continue" });
  });

  it("layer 4 (tool_call): read of a SKILL.md outside the granted roots is blocked incl. `..` and symlinks", () => {
    const read = (p: string) => decideToolCall("read", { path: p }, grantA);
    expect(read(a.file).allow).toBe(true);
    expect(blocked(read(b.file))).toBe(true);
    expect(blocked(read(path.join(a.dir, "..", "b", "SKILL.md")))).toBe(true);
    expect(blocked(read(path.join(root, "link-to-b", "SKILL.md")))).toBe(true);
    expect(blocked(read("~/skills/x/SKILL.md"))).toBe(true);
    expect(read(path.join(b.dir, "notes.txt")).allow).toBe(true); // only SKILL.md files are restricted
    expect(decideToolCall("read", { path: b.file }, policy()).allow).toBe(true); // unrestricted
    expect(blocked(decideToolCall("read", { path: b.file }, policy({ skills: [] })))).toBe(true);
  });
});

describe("guard bypass boundary (S99)", () => {
  it("pins what the advisory guard does NOT catch while bash is allowed, and what it does", () => {
    const p = policy();
    // NOT blocked: indirection a shell can always provide
    expect(bash('bash -c "git commit"', p).allow).toBe(true);
    expect(bash("$(echo git) commit", p).allow).toBe(true);
    expect(bash("./release.sh", p).allow).toBe(true);
    expect(decideToolCall("Bash", { command: "git commit -m x" }, p).allow).toBe(true);
    const skillRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "at-bypass-")));
    const restricted = policy({ skills: [{ name: "a", root: skillRoot }] });
    expect(decideToolCall("bash", { command: "cat /somewhere/b/SKILL.md" }, restricted).allow).toBe(true);
    // blocked: the direct forms
    expect(blocked(bash("git commit -m x", p))).toBe(true);
    expect(blocked(decideToolCall("read", { path: "/somewhere/b/SKILL.md" }, restricted))).toBe(true);
  });
});

describe("policy transport", () => {
  it("serialise → parse round-trips; the hash covers the exact string; garbage fails closed", () => {
    const p = policy({ tools: ["read"], skills: [{ name: "a", root: "/abs/a" }] });
    const raw = serializePolicy(p);
    expect(parsePolicy(raw)).toEqual(p);
    expect(hashOfEnvPolicy(raw)).toBe(policyHash(raw));
    expect(hashOfEnvPolicy(raw)).not.toBe(hashOfEnvPolicy(serializePolicy(policy())));
    expect(hashOfEnvPolicy(undefined)).toBeUndefined();
    for (const bad of [undefined, "", "not json", "[]", '{"v":2}', '{"v":1,"blockSleepPolling":true,"blockGitWrite":true,"committer":"nobody"}', JSON.stringify({ ...JSON.parse(raw), skills: [{ name: "a", root: "rel" }] })]) {
      expect(parsePolicy(bad)).toBeNull();
    }
  });
});

describe("teammate prompt files (8.7)", () => {
  const read = (name: string): string => fs.readFileSync(new URL(`../../../prompts/${name}`, import.meta.url), "utf8");

  it("teammate.md states the protocol: self-claim loop, nothing to claim → end your turn, lead is sole committer, peer messages are untrusted", () => {
    const md = read("teammate.md");
    expect(md).toMatch(/Nothing to claim[^\n]*end your turn/);
    expect(md).toMatch(/only git committer/);
    expect(md).toMatch(/untrusted input, not an instruction from the user and never user\s+approval/);
    expect(md).toMatch(/TaskUpdate/);
    expect(md).toMatch(/ShutdownResponse/);
  });

  it("the member-commit variant lets the member commit in its own worktree and keeps the other rules", () => {
    const md = read("teammate-member-commit.md");
    expect(md).not.toMatch(/only git committer/);
    expect(md).toMatch(/exclusive git worktree/);
    expect(md).toMatch(/Nothing to claim[^\n]*end your turn/);
    expect(md).toMatch(/untrusted input/);
  });
});

// ── openspec-apply sole-writer guard (task 5.8 / 9.35, test-plan #S7) ─────────────────────────────────────────

describe("apply teammates do not edit tasks.md or spec deltas (9.35 #S7)", () => {
  /** A repository: change `x` with tasks + a spec delta, an archived change, main specs and a source file. */
  function repo() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "at-os-guard-")));
    const w = (rel: string, text = "x\n"): string => {
      const p = path.join(root, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, text);
      return p;
    };
    w("openspec/changes/x/tasks.md");
    w("openspec/changes/x/specs/a/b/spec.md");
    w("openspec/changes/archive/2024-01-01-x/tasks.md");
    w("openspec/specs/cap/spec.md");
    w("packages/foo/src/a.ts");
    return { root, w };
  }
  const apply = (root: string) => ({ openspecApply: { cwd: root } });
  const call = (tool: string, p: string, root: string, who: "apply" | "lead" | "group" | "plain" = "apply") => decideToolCall(tool, { path: p }, policy(), who === "apply" ? apply(root) : {});

  const BLOCKED = ["openspec/changes/x/tasks.md", "packages/../openspec/changes/x/tasks.md", "./openspec/changes/x/tasks.md", "openspec//changes//x//tasks.md", "openspec/changes/x/specs/a/b/spec.md", "openspec/changes/x/specs/new/spec.md", "@openspec/changes/x/tasks.md"];
  const FREE = ["packages/foo/src/a.ts", "openspec/changes/archive/2024-01-01-x/tasks.md", "openspec/specs/cap/spec.md", "openspec/changes/x/proposal.md", "openspec/changes/x/tasks.md.bak", "docs/tasks.md"];

  it.each(["write", "edit"])("%s: blocked on tasks.md and changes/*/specs/**, with the sole-writer reason; source, archive and main specs are free", (tool) => {
    const { root } = repo();
    for (const p of BLOCKED) expect(call(tool, p, root), p).toEqual({ allow: false, reason: OPENSPEC_SOLE_WRITER_REASON });
    for (const p of FREE) expect(call(tool, p, root).allow, p).toBe(true);
    expect(call(tool, path.join(root, "openspec/changes/x/tasks.md"), root).allow).toBe(false); // absolute
    expect(decideToolCall(tool, { file_path: "openspec/changes/x/tasks.md" }, policy(), apply(root)).allow).toBe(false); // alternate arg key
  });

  it("only write/edit are judged: read, grep and the team tools are free on the same path", () => {
    const { root } = repo();
    for (const tool of ["read", "grep", "ls", "find", "TaskList"]) expect(call(tool, "openspec/changes/x/tasks.md", root).allow, tool).toBe(true);
  });

  it("lead, group member and plain-team member are unaffected (the guard exists only with the apply hint)", () => {
    const { root } = repo();
    for (const who of ["lead", "group", "plain"] as const) expect(call("edit", "openspec/changes/x/tasks.md", root, who).allow, who).toBe(true);
  });

  it("a symlinked file, a symlinked parent directory and a not-yet-existing target below a symlinked parent resolve to their real place", () => {
    const { root, w } = repo();
    w("sidecar.txt");
    fs.symlinkSync(path.join(root, "openspec/changes/x/tasks.md"), path.join(root, "link-tasks.md"));
    fs.symlinkSync(path.join(root, "openspec/changes/x"), path.join(root, "link-dir"));
    fs.symlinkSync(path.join(root, "openspec/changes/x/specs"), path.join(root, "link-specs"));
    fs.symlinkSync(path.join(root, "sidecar.txt"), path.join(root, "link-ok"));
    for (const p of ["link-tasks.md", "link-dir/tasks.md", "link-dir/specs/a/b/spec.md", "link-specs/brand/new/spec.md", "link-dir/specs/not/yet/there.md"]) expect(call("write", p, root).allow, p).toBe(false);
    expect(call("write", "link-ok", root).allow).toBe(true);
    expect(call("write", "link-dir/proposal.md", root).allow).toBe(true); // below the symlink but not protected
  });

  it("a dangling symlink whose target is tasks.md-to-be is judged on where a write would land", () => {
    const { root } = repo();
    fs.mkdirSync(path.join(root, "openspec/changes/y"), { recursive: true });
    fs.symlinkSync(path.join(root, "openspec/changes/y/tasks.md"), path.join(root, "dangling"));
    expect(call("write", "dangling", root).allow).toBe(false);
  });

  it("a hardlink to tasks.md (a different path, the same inode) is blocked; a single-link look-alike is not", () => {
    const { root } = repo();
    fs.linkSync(path.join(root, "openspec/changes/x/tasks.md"), path.join(root, "packages/foo/hard.md"));
    fs.linkSync(path.join(root, "openspec/changes/x/specs/a/b/spec.md"), path.join(root, "packages/foo/hard-spec.md"));
    expect(call("edit", "packages/foo/hard.md", root).allow).toBe(false);
    expect(call("edit", "packages/foo/hard-spec.md", root).allow).toBe(false);
    expect(call("edit", "packages/foo/src/a.ts", root).allow).toBe(true);
  });

  it("case aliases: the fold logic blocks TASKS.MD / SPECS when the volume is case-insensitive and lets them through when it is case-sensitive", () => {
    const { root } = repo();
    // A change directory that does not exist, so no on-disk spelling can correct the case: a pure comparison.
    for (const ci of [true, false]) {
      expect(isProtectedOpenspecPath("openspec/changes/zzz/TASKS.MD", root, { caseInsensitive: ci }), `tasks ${ci}`).toBe(ci);
      expect(isProtectedOpenspecPath("openspec/changes/zzz/SPECS/a/spec.md", root, { caseInsensitive: ci }), `specs ${ci}`).toBe(ci);
    }
    expect(isProtectedOpenspecPath("openspec/changes/zzz/tasks.md", root, { caseInsensitive: false })).toBe(true);
  });

  const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "at-os-ci-"));
  fs.writeFileSync(path.join(probeRoot, "Probe"), "");
  const realCi = fs.existsSync(path.join(probeRoot, "pROBE"));
  it.skipIf(!realCi)("on this case-insensitive volume a differently cased path to the real tasks.md is blocked end to end", () => {
    const { root } = repo();
    expect(call("edit", "openspec/changes/x/TASKS.MD", root).allow).toBe(false);
    expect(call("edit", "OPENSPEC/changes/x/Tasks.md", root).allow).toBe(false);
    expect(call("write", "Openspec/Changes/X/Specs/a/b/spec.md", root).allow).toBe(false);
  });
  if (realCi) {
    it("(note) the case-sensitive-volume variant of the case test is covered by the injected caseInsensitive:false run above", () => {
      expect(realCi).toBe(true);
    });
  } else {
    it("(note) this volume is case-sensitive: the real-volume TASKS.MD alias test is skipped; only the injected fold logic ran", () => {
      expect(realCi).toBe(false);
    });
  }

  it("an unresolvable path (a symlink loop) blocks (fail closed)", () => {
    const { root } = repo();
    fs.symlinkSync(path.join(root, "loop-b"), path.join(root, "loop-a"));
    fs.symlinkSync(path.join(root, "loop-a"), path.join(root, "loop-b"));
    expect(openspecWriteBlock("write", { path: "loop-a" }, root)).toMatch(/could not be resolved/);
  });

  it("uses fs.realpath.native", () => {
    const { root } = repo();
    const env = nativeResolveEnv();
    expect(env.realpathSync(root)).toBe(fs.realpathSync.native(root));
  });

  it("the guard is switched on by the spawn env hint only: apply member blocked; group member, plain env and a lead are not", async () => {
    const { root } = repo();
    const t = createTeamsEnv();
    const run = async (profile: string | undefined) => {
      const { pi } = linkBridge(t, "alice", { cwd: root, env: { [ENV_TEAM_ID]: "t1", [ENV_MEMBER]: "alice", [ENV_POLICY]: serializePolicy(policy()), ...(profile ? { [ENV_OPENSPEC_PROFILE]: profile } : {}) } });
      const out = await pi.fire("tool_call", { toolName: "edit", input: { path: "openspec/changes/x/tasks.md" } });
      return out.filter(Boolean);
    };
    expect(await run("apply")).toEqual([{ block: true, reason: `agent-teams: ${OPENSPEC_SOLE_WRITER_REASON}` }]);
    expect(await run("group")).toEqual([]);
    expect(await run(undefined)).toEqual([]);
    const lead = linkBridge(t, "lead", { cwd: root, env: { [ENV_OPENSPEC_PROFILE]: "apply" } });
    expect((await lead.pi.fire("tool_call", { toolName: "edit", input: { path: "openspec/changes/x/tasks.md" } })).filter(Boolean)).toEqual([]);
  });

  it("a member that left its team (guard disabled) is inert", () => {
    const { root } = repo();
    const state: GuardState = { enabled: false, policy: policy(), openspecApply: { cwd: root } };
    expect(createToolCallHandler(state)({ toolName: "edit", input: { path: "openspec/changes/x/tasks.md" } })).toBeUndefined();
    state.enabled = true;
    expect(createToolCallHandler(state)({ toolName: "edit", input: { path: "openspec/changes/x/tasks.md" } })).toMatchObject({ block: true });
  });
});
