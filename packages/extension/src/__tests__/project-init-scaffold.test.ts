/**
 * Scaffold: writes AGENTS.md + settings + prompts; DOX seeds doctrine + kb config;
 * hook validity; idempotency conflict reporting.
 * See change: project-init-skill-and-profiles.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Profile } from "../project-init/profiles.js";
import { planScaffold, scaffoldProfile, isValidWorktreeInit } from "../project-init/scaffold.js";
import { DOX_MARKER } from "../project-init/seed-doctrine.js";
import { STACKS, stackSubstitutions } from "../project-init/detect-stack.js";

/** A coding-style profile whose templates carry stack placeholders. */
function makeStackProfile(root: string, name: string): Profile {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "AGENTS.md.tmpl"), "# {{PROJECT_NAME}}\n\n{{INSTALL_CMD}} {{TEST_CMD}} {{BUILD_CMD}}\n");
  fs.writeFileSync(
    path.join(dir, "settings.json.tmpl"),
    '{ "worktreeInit": { "gate": "{{INIT_GATE}}", "run": { "type": "script", "command": "{{INIT_COMMAND}}" } } }',
  );
  return { name, dox: false, stackAware: true, dir, source: "shipped" };
}

function makeProfileDir(root: string, name: string, opts: { dox?: boolean; hook?: unknown } = {}): Profile {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, "prompts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "AGENTS.md.tmpl"), "# {{PROJECT_NAME}}\n\nbody\n");
  const hook = opts.hook ?? { gate: "test ! -d node_modules", run: { type: "script", command: "npm ci" } };
  fs.writeFileSync(path.join(dir, "settings.json.tmpl"), JSON.stringify({ worktreeInit: hook }, null, 2));
  fs.writeFileSync(path.join(dir, "prompts", "a.md"), "prompt a\n");
  return { name, dox: !!opts.dox, stackAware: false, dir, source: "shipped" };
}

describe("project-init scaffold", () => {
  let tmp: string;
  let profilesRoot: string;
  let target: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-scaffold-"));
    profilesRoot = path.join(tmp, "profiles");
    target = path.join(tmp, "project");
    fs.mkdirSync(profilesRoot, { recursive: true });
    fs.mkdirSync(target, { recursive: true });
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("writes AGENTS.md, settings.json, and prompt files", () => {
    const profile = makeProfileDir(profilesRoot, "coding");
    const res = scaffoldProfile({ profile, targetDir: target, projectName: "Demo" });
    expect(fs.readFileSync(path.join(target, "AGENTS.md"), "utf8")).toContain("# Demo");
    const settings = JSON.parse(fs.readFileSync(path.join(target, ".pi", "settings.json"), "utf8"));
    expect(settings.worktreeInit.run.command).toBe("npm ci");
    expect(fs.existsSync(path.join(target, ".pi", "prompts", "a.md"))).toBe(true);
    expect(res.hookValid).toBe(true);
    expect(res.doctrineSeeded).toBe(false);
  });

  it("DOX profile seeds the doctrine into AGENTS.md and writes the kb config", () => {
    const profile = makeProfileDir(profilesRoot, "coding", { dox: true });
    const res = scaffoldProfile({ profile, targetDir: target });
    expect(res.doctrineSeeded).toBe(true);
    expect(fs.readFileSync(path.join(target, "AGENTS.md"), "utf8")).toContain(DOX_MARKER);
    expect(fs.existsSync(path.join(target, ".pi", "dashboard", "knowledge_base.json"))).toBe(true);
  });

  it("planScaffold reports existing files as conflicts", () => {
    const profile = makeProfileDir(profilesRoot, "coding");
    fs.writeFileSync(path.join(target, "AGENTS.md"), "pre-existing\n");
    const plan = planScaffold({ profile, targetDir: target });
    expect(plan.conflicts).toContain(path.join(target, "AGENTS.md"));
  });

  it("refuses to overwrite unless overwrite:true", () => {
    const profile = makeProfileDir(profilesRoot, "coding");
    fs.writeFileSync(path.join(target, "AGENTS.md"), "pre-existing\n");
    expect(() => scaffoldProfile({ profile, targetDir: target })).toThrow(/overwrite/);
    expect(() => scaffoldProfile({ profile, targetDir: target, overwrite: true })).not.toThrow();
  });

  it("substitutes a detected stack into placeholder templates (no leftovers)", () => {
    const profile = makeStackProfile(profilesRoot, "coding");
    const res = scaffoldProfile({
      profile, targetDir: target, projectName: "Demo",
      substitutions: stackSubstitutions(STACKS.cargo!),
    });
    expect(res.leftover).toEqual([]);
    expect(fs.readFileSync(path.join(target, "AGENTS.md"), "utf8")).toContain("cargo test");
    const settings = JSON.parse(fs.readFileSync(path.join(target, ".pi", "settings.json"), "utf8"));
    expect(settings.worktreeInit.gate).toBe("test ! -d target");
    expect(settings.worktreeInit.run.command).toBe("cargo fetch");
    expect(res.hookValid).toBe(true);
  });

  it("JSON-escapes substitutions so a quote/backslash cannot corrupt settings.json", () => {
    const profile = makeStackProfile(profilesRoot, "coding");
    const subs = { ...stackSubstitutions(STACKS.npm!), INIT_COMMAND: 'echo "hi" && npm ci' };
    const res = scaffoldProfile({ profile, targetDir: target, substitutions: subs });
    // Must still be valid JSON on disk, with the value preserved verbatim.
    const settings = JSON.parse(fs.readFileSync(path.join(target, ".pi", "settings.json"), "utf8"));
    expect(settings.worktreeInit.run.command).toBe('echo "hi" && npm ci');
    expect(res.hookValid).toBe(true);
  });

  it("overwrite:true rewrites a pre-existing knowledge_base.json (DOX)", () => {
    const profile = makeProfileDir(profilesRoot, "coding", { dox: true });
    const kbPath = path.join(target, ".pi", "dashboard", "knowledge_base.json");
    fs.mkdirSync(path.dirname(kbPath), { recursive: true });
    fs.writeFileSync(kbPath, '{"sources":[]}\n');
    scaffoldProfile({ profile, targetDir: target, overwrite: true });
    const kb = JSON.parse(fs.readFileSync(kbPath, "utf8"));
    expect(kb.indexAgentsFiles).toBe(true);
    expect(kb.directoryLevelAgents.enabled).toBe(true);
  });

  it("reports leftover placeholders when no stack substitutions are supplied", () => {
    const profile = makeStackProfile(profilesRoot, "coding");
    const res = scaffoldProfile({ profile, targetDir: target });
    expect(res.leftover).toContain("INSTALL_CMD");
    expect(res.leftover).toContain("INIT_GATE");
  });

  it("flags an invalid worktreeInit hook (would fail-open)", () => {
    const profile = makeProfileDir(profilesRoot, "bad", { hook: { gate: "", run: {} } });
    const res = scaffoldProfile({ profile, targetDir: target });
    expect(res.hookValid).toBe(false);
  });

  it("isValidWorktreeInit mirrors change-A schema", () => {
    expect(isValidWorktreeInit({ gate: "true", run: { type: "script", command: "x" } })).toBe(true);
    expect(isValidWorktreeInit({ gate: "true", run: { type: "agent", prompt: "x" } })).toBe(true);
    expect(isValidWorktreeInit({ gate: "", run: { type: "script", command: "x" } })).toBe(false);
    expect(isValidWorktreeInit({ gate: "true", run: { type: "script" } })).toBe(false);
    expect(isValidWorktreeInit(null)).toBe(false);
  });
});
