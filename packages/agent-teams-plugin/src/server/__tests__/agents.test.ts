/**
 * Teammate type resolution and field mapping (spec agent-teams-teammate-types; test-plan E19-E21, S1 agent half).
 * See change: add-agent-teams-templates-hooks.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENT_MAX_BYTES, parseAgentFile, resolveAgent } from "../agents.js";
import { createTemplateEnv, type TemplateEnv } from "./template-env.js";

afterEach(() => vi.restoreAllMocks());

const resolve = (env: TemplateEnv, name: unknown) => resolveAgent(name, env.cwd, env.deps);
const fmAgent = (yaml: string, body = "") => `---\n${yaml}\n---\n${body}`;

describe("field mapping (E19)", () => {
  it("maps description, model, thinking, tools and the prompt key", () => {
    const r = parseAgentFile("Audit", fmAgent("description: Security reviewer\nmodel: '@fast'\nthinking: high\ntools: [read, grep]\nprompt: Be careful.", "ignored body"));
    expect(r).toEqual({ ok: true, warnings: [], data: { role: "Security reviewer", model: "@fast", thinking: "high", tools: ["read", "grep"], prompt: "Be careful." } });
  });

  it("the markdown body becomes the prompt when there is no prompt key; prompt: wins over the body", () => {
    expect(parseAgentFile("A", fmAgent("description: d", "\n You are A.\n"))).toMatchObject({ ok: true, data: { prompt: "You are A." } });
    expect(parseAgentFile("A", fmAgent("prompt: from key", "from body"))).toMatchObject({ ok: true, data: { prompt: "from key" } });
  });

  it("a bare file: role is the agent name, prompt empty, no model/tools", () => {
    expect(parseAgentFile("Bare", "")).toEqual({ ok: true, warnings: [], data: { role: "Bare", prompt: "" } });
    expect(parseAgentFile("Bare", "---\n---\n")).toEqual({ ok: true, warnings: [], data: { role: "Bare", prompt: "" } });
  });

  it("a file without frontmatter is all body", () => {
    expect(parseAgentFile("Plain", "Just a prompt\nsecond line")).toMatchObject({ ok: true, data: { role: "Plain", prompt: "Just a prompt\nsecond line" } });
  });

  it("tools: [] means an empty allowlist, not unrestricted", () => {
    expect(parseAgentFile("A", fmAgent("tools: []"))).toMatchObject({ ok: true, data: { tools: [] } });
  });

  it.each([
    ["comma string", "tools: read, bash"],
    ["scalar", "tools: read"],
    ["mixed types", "tools: [read, 5]"],
    ["nested", "tools: [[read]]"],
    ["empty string element", "tools: ['']"],
    ["mapping", "tools: {a: 1}"],
    ["null", "tools:"],
  ])("tools %s ⇒ agent_invalid (never all tools)", (_l, yaml) => {
    const env = createTemplateEnv();
    env.agent("user", "A", fmAgent(yaml));
    expect(resolve(env, "A")).toMatchObject({ ok: false, code: "agent_invalid" });
  });

  it.each(["description: [a]", "model: 5", "prompt: [x]"])("non-string %s ⇒ agent_invalid", (yaml) => {
    expect(parseAgentFile("A", fmAgent(yaml))).toMatchObject({ ok: false });
  });

  it("an unknown thinking level is ignored with a warning and the spawn proceeds", () => {
    const r = parseAgentFile("A", fmAgent("thinking: ludicrous"));
    expect(r).toMatchObject({ ok: true, data: { role: "A" } });
    expect(r.ok && r.data.thinking).toBeUndefined();
    expect(r.ok && r.warnings.join("|")).toMatch(/thinking/);
  });

  it("inherit_context is ignored silently; an unknown key warns", () => {
    const r = parseAgentFile("A", fmAgent("inherit_context: true\ncolour: red"));
    expect(r).toMatchObject({ ok: true, warnings: ["unknown key colour ignored"] });
    expect(r.ok && Object.keys(r.data)).toEqual(["role", "prompt"]);
  });

  it("a multi-line description collapses to a one-line role", () => {
    expect(parseAgentFile("A", fmAgent("description: |\n  line one\n  line two"))).toMatchObject({ ok: true, data: { role: "line one line two" } });
  });

  it.each(["x: &a 1\ny: *a", "x: !!js/function f", "a: 1\na: 2", "- list"])("hazardous frontmatter %j ⇒ invalid", (yaml) => {
    expect(parseAgentFile("A", fmAgent(yaml))).toMatchObject({ ok: false });
  });

  it("an unclosed frontmatter fence is invalid", () => {
    expect(parseAgentFile("A", "---\ndescription: d\nbody")).toMatchObject({ ok: false });
  });
});

describe("name regex and file size (E20)", () => {
  const ok64 = `a${"b".repeat(63)}`;
  it("accepts a 64-char name and a 65536-byte file", () => {
    const env = createTemplateEnv();
    const head = "---\nprompt: p\n# ";
    const tail = "\n---\n";
    env.agent("user", ok64, `${head}${"x".repeat(AGENT_MAX_BYTES - head.length - tail.length)}${tail}`);
    expect(fs.statSync(path.join(env.dir("user", "agents"), `${ok64}.md`)).size).toBe(65536);
    expect(resolve(env, ok64)).toMatchObject({ ok: true, agent: { name: ok64, prompt: "p" } });
  });

  it("a 65537-byte file ⇒ agent_invalid and is not read", () => {
    const env = createTemplateEnv();
    const p = env.agent("user", "Big", "x".repeat(AGENT_MAX_BYTES + 1));
    const reads = vi.spyOn(fs, "readFileSync");
    expect(resolve(env, "Big")).toMatchObject({ ok: false, code: "agent_invalid" });
    expect(reads.mock.calls.filter((c) => c[0] === p)).toEqual([]);
  });

  it.each([`a${"b".repeat(64)}`, "../x", "a/b", ".hidden", "", "a b", "a\\b", "-lead", 5, undefined, null])("name %j ⇒ agent_invalid, nothing read", (name) => {
    const env = createTemplateEnv();
    env.agent("user", "x", "secret");
    fs.writeFileSync(path.join(env.cwd, "x.md"), "outside");
    const reads = vi.spyOn(fs, "readFileSync");
    const opens = vi.spyOn(fs, "openSync");
    expect(resolve(env, name)).toMatchObject({ ok: false, code: "agent_invalid" });
    expect(reads.mock.calls.filter((c) => String(c[0]).endsWith(".md"))).toEqual([]);
    expect(opens.mock.calls.filter((c) => String(c[0]).endsWith(".md"))).toEqual([]);
  });
});

describe("tiers (E21)", () => {
  type Trust = true | false | undefined;
  const expectedFor = (trust: Trust, proj: boolean, user: boolean): string => {
    if (trust === true) return proj ? "project" : user ? "user" : "agent_not_found";
    if (user) return "user";
    return proj ? "agent_untrusted" : "agent_not_found";
  };
  const rows: Array<[Trust, boolean, boolean, string]> = [];
  for (const trust of [true, false, undefined] as const) {
    for (const proj of [true, false]) for (const user of [true, false]) rows.push([trust, proj, user, expectedFor(trust, proj, user)]);
  }
  it.each(rows)("trust=%s project=%s user=%s ⇒ %s", (trust, proj, user, expected) => {
    const env = createTemplateEnv();
    env.setTrusted(trust);
    if (proj) env.agent("project", "Audit", "---\ndescription: project\n---\nP");
    if (user) env.agent("user", "Audit", "---\ndescription: user\n---\nU");
    const r = resolve(env, "Audit");
    if (expected === "project" || expected === "user") expect(r).toMatchObject({ ok: true, agent: { source: expected, role: expected, prompt: expected === "project" ? "P" : "U" } });
    else expect(r).toMatchObject({ ok: false, code: expected });
  });

  it("an untrusted project file is never read", () => {
    const env = createTemplateEnv();
    env.setTrusted(false);
    const p = env.agent("project", "Audit", "x".repeat(1000));
    const reads = vi.spyOn(fs, "readFileSync");
    expect(resolve(env, "Audit")).toMatchObject({ ok: false, code: "agent_untrusted" });
    expect(reads.mock.calls.filter((c) => c[0] === p)).toEqual([]);
  });

  it("a trusted but invalid project file fails agent_invalid instead of silently using the user file", () => {
    const env = createTemplateEnv();
    env.agent("project", "Audit", "---\ntools: read, bash\n---\n");
    env.agent("user", "Audit", "---\ndescription: user\n---\n");
    expect(resolve(env, "Audit")).toMatchObject({ ok: false, code: "agent_invalid" });
  });

  it("resolves against the given lead cwd", () => {
    const env = createTemplateEnv();
    env.agent("project", "Audit", "---\ndescription: here\n---\n");
    expect(resolveAgent("Audit", env.cwd, env.deps)).toMatchObject({ ok: true });
    expect(resolveAgent("Audit", env.agentDir, env.deps)).toMatchObject({ ok: false, code: "agent_not_found" });
  });
});

describe("symlinks and non-regular files (S1, agent half)", () => {
  it("a symlink to a file outside the agents dir ⇒ agent_invalid, target never read", () => {
    const env = createTemplateEnv();
    const outside = path.join(env.cwd, "secret.md");
    fs.writeFileSync(outside, "---\ndescription: stolen\n---\n");
    fs.mkdirSync(env.dir("project", "agents"), { recursive: true });
    fs.symlinkSync(outside, path.join(env.dir("project", "agents"), "Evil.md"));
    const reads = vi.spyOn(fs, "readFileSync");
    expect(resolve(env, "Evil")).toMatchObject({ ok: false, code: "agent_invalid" });
    expect(reads.mock.calls.filter((c) => String(c[0]).includes("secret.md"))).toEqual([]);
  });

  it("a symlinked agents directory pointing outside the root ⇒ agent_invalid", () => {
    const env = createTemplateEnv();
    const elsewhere = path.join(env.agentDir, "..", "elsewhere");
    fs.mkdirSync(elsewhere);
    fs.writeFileSync(path.join(elsewhere, "Audit.md"), "---\ndescription: x\n---\n");
    fs.mkdirSync(path.join(env.cwd, ".pi"), { recursive: true });
    fs.symlinkSync(elsewhere, path.join(env.cwd, ".pi", "agents"));
    expect(resolve(env, "Audit")).toMatchObject({ ok: false, code: "agent_invalid" });
  });

  it("a directory named like the agent ⇒ agent_invalid (not regular)", () => {
    const env = createTemplateEnv();
    fs.mkdirSync(path.join(env.dir("user", "agents"), "Dir.md"), { recursive: true });
    expect(resolve(env, "Dir")).toMatchObject({ ok: false, code: "agent_invalid" });
  });

  it("a symlink that stays inside the directory is followed", () => {
    const env = createTemplateEnv();
    env.agent("user", "Real", "---\ndescription: ok\n---\n");
    fs.symlinkSync(path.join(env.dir("user", "agents"), "Real.md"), path.join(env.dir("user", "agents"), "Alias.md"));
    expect(resolve(env, "Alias")).toMatchObject({ ok: true, agent: { role: "ok" } });
  });
});

describe("resolved shape and trust service", () => {
  it("returns warnings and spawn-ready fields together", () => {
    const env = createTemplateEnv();
    env.agent("user", "Explore", "---\ndescription: Scout\ntools: [read]\ncolour: red\n---\nLook around.");
    expect(resolve(env, "Explore")).toEqual({ ok: true, agent: { name: "Explore", source: "user", role: "Scout", tools: ["read"], prompt: "Look around.", warnings: ["unknown key colour ignored"] } });
  });

  it("a missing trust service logs once and falls back to the user tier", () => {
    const env = createTemplateEnv();
    env.setTrusted(undefined);
    env.agent("project", "A", "---\ndescription: p\n---\n");
    env.agent("user", "A", "---\ndescription: u\n---\n");
    expect(resolve(env, "A")).toMatchObject({ ok: true, agent: { source: "user" } });
    resolve(env, "A");
    expect(env.logs.warn.filter((m) => m.includes("isProjectTrusted"))).toHaveLength(1);
  });
});
