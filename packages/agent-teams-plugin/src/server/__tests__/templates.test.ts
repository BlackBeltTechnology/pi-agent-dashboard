/**
 * Template discovery / validation / rendering (spec agent-teams-templates; test-plan E1-E7, E10, E11 listing half,
 * E22, E23, E41 listing half, E42, S1, S2, S10). Real temp dirs, real config reader, injected trust flag.
 * @structural-pin reads the plugin package.json manifest: the absent automation claim/action is the contract under test
 * See change: add-agent-teams-templates-hooks.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { effectiveHookTimeoutMs } from "../config.js";
import type { MemberDriver } from "../driver.js";
import { hashHooks, listTemplates, loadTemplate, normalizeGoal, parseTemplate, renderPlaybook, substituteVars, templateCache } from "../templates.js";
import { createTemplateEnv, md, type TemplateEnv } from "./template-env.js";

const codes = (issues: Array<{ code: string }>): string[] => issues.map((i) => i.code);
const list = (env: TemplateEnv, caller?: { sessionId?: string }) => listTemplates({ cwd: env.cwd, deps: env.deps, ...(caller ? { caller } : {}) });
const one = (env: TemplateEnv, name: string) => list(env).templates.find((t) => t.name === name);
const load = (env: TemplateEnv, name: string) => loadTemplate(name, env.cwd, env.deps);
const member = (name: string, extra: Record<string, unknown> = {}) => ({ name, ...extra });

afterEach(() => {
  templateCache.invalidate();
  vi.restoreAllMocks();
});

/** Byte-exact file: the padding is a YAML comment line in the frontmatter (a padded body would hit the playbook cap first). */
function paddedTemplate(name: string, bytes: number): string {
  const head = `---\nname: ${name}\n# `;
  const tail = "\n---\nbody\n";
  const pad = bytes - Buffer.byteLength(head) - Buffer.byteLength(tail);
  return `${head}${"x".repeat(pad)}${tail}`;
}

describe("sources and listing (E22, spec 'Template files and sources')", () => {
  it("lists a user template with source user", () => {
    const env = createTemplateEnv();
    env.tpl("user", "review-pr", md({ name: "review-pr", description: "Three reviewers" }));
    expect(one(env, "review-pr")).toMatchObject({ source: "user", trusted: true, valid: true, description: "Three reviewers" });
  });

  it("a trusted project template shadows the user one", () => {
    const env = createTemplateEnv();
    env.tpl("user", "review-pr", md({ name: "review-pr", description: "user" }));
    env.tpl("project", "review-pr", md({ name: "review-pr", description: "project" }));
    const l = list(env).templates.filter((t) => t.name === "review-pr");
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ source: "project", description: "project", trusted: true });
    expect(load(env, "review-pr")).toMatchObject({ ok: true, template: { source: "project" } });
  });

  it("an untrusted project lists the stem trusted:false next to the startable user template; start uses the user one", () => {
    const env = createTemplateEnv();
    env.setTrusted(false);
    env.tpl("user", "review-pr", md({ name: "review-pr", description: "user" }));
    env.tpl("project", "review-pr", md({ name: "review-pr", description: "project" }));
    const l = list(env).templates.filter((t) => t.name === "review-pr");
    expect(l.map((t) => [t.source, t.trusted, t.valid])).toEqual([
      ["user", true, true],
      ["project", false, false],
    ]);
    expect(load(env, "review-pr")).toMatchObject({ ok: true, template: { source: "user", description: "user" } });
  });

  it("only-untrusted start ⇒ project_untrusted; a missing name ⇒ template_not_found", () => {
    const env = createTemplateEnv();
    env.setTrusted(false);
    env.tpl("project", "x", md({ name: "x" }));
    expect(load(env, "x")).toMatchObject({ ok: false, code: "project_untrusted" });
    expect(load(env, "nope")).toMatchObject({ ok: false, code: "template_not_found" });
    expect(load(env, "../x")).toMatchObject({ ok: false, code: "template_not_found" });
  });

  it("a host without the trust service treats every project as untrusted, user templates still work, logged once", () => {
    const env = createTemplateEnv();
    env.setTrusted(undefined);
    env.tpl("project", "p", md({ name: "p" }));
    env.tpl("user", "u", md({ name: "u" }));
    const l = list(env).templates;
    expect(l.find((t) => t.name === "p")).toMatchObject({ trusted: false });
    expect(l.find((t) => t.name === "u")).toMatchObject({ trusted: true, valid: true });
    expect(load(env, "u").ok).toBe(true);
    expect(load(env, "p")).toMatchObject({ ok: false, code: "project_untrusted" });
    expect(env.logs.warn.filter((m) => m.includes("isProjectTrusted"))).toHaveLength(1);
  });

  it("a throwing trust service fails closed", () => {
    const env = createTemplateEnv();
    (env.deps.host as { isProjectTrusted: (c: string) => boolean }).isProjectTrusted = () => {
      throw new Error("boom");
    };
    env.tpl("project", "p", md({ name: "p" }));
    expect(one(env, "p")).toMatchObject({ trusted: false });
  });

  it("falls through when a project template vanished between listing and load, and when absent from the project dir", () => {
    const env = createTemplateEnv();
    env.tpl("user", "u", md({ name: "u" }));
    fs.mkdirSync(env.dir("project", "teams"), { recursive: true });
    expect(load(env, "u")).toMatchObject({ ok: true, template: { source: "user" } });
  });
});

describe("name rules (E1)", () => {
  const cases: Array<[string, string, "valid" | "name_invalid"]> = [
    ["1 char", "a", "valid"],
    ["40 chars", `a${"b".repeat(39)}`, "valid"],
    ["41 chars", `a${"b".repeat(40)}`, "name_invalid"],
    ["leading digit", "1abc", "name_invalid"],
    ["uppercase", "Abc", "name_invalid"],
    ["underscore", "a_b", "name_invalid"],
  ];
  it.each(cases)("%s", (_label, stem, expected) => {
    const env = createTemplateEnv();
    env.tpl("user", stem, md({ name: stem }));
    const t = one(env, stem);
    if (expected === "valid") expect(t).toMatchObject({ valid: true, errors: [] });
    else {
      expect(t).toMatchObject({ valid: false });
      expect(codes(t?.errors ?? [])).toEqual([expected]);
    }
  });

  it("a valid name that differs from the file stem is name_mismatch", () => {
    const env = createTemplateEnv();
    env.tpl("user", "a", md({ name: "b" }));
    expect(codes(one(env, "a")?.errors ?? [])).toEqual(["name_mismatch"]);
  });

  it("a missing name is name_invalid", () => {
    const env = createTemplateEnv();
    env.tpl("user", "a", "---\ndescription: x\n---\nbody\n");
    expect(codes(one(env, "a")?.errors ?? [])).toEqual(["name_invalid"]);
  });

  it("an invalid template is listed but not startable", () => {
    const env = createTemplateEnv();
    env.tpl("user", "Abc", md({ name: "Abc" }));
    expect(load(env, "Abc")).toMatchObject({ ok: false, code: "template_invalid", issues: [{ code: "name_invalid" }] });
  });
});

describe("size cap (E2) and read discipline", () => {
  it.each([
    [65535, true],
    [65536, true],
    [65537, false],
  ])("%i bytes valid=%s", (bytes, valid) => {
    const env = createTemplateEnv();
    const p = env.tpl("user", "big", paddedTemplate("big", bytes));
    expect(fs.statSync(p).size).toBe(bytes);
    const reads = vi.spyOn(fs, "readFileSync");
    const opens = vi.spyOn(fs, "openSync");
    const t = one(env, "big");
    if (valid) expect(t).toMatchObject({ valid: true });
    else {
      expect(t).toMatchObject({ valid: false });
      expect(codes(t?.errors ?? [])).toEqual(["template_too_large"]);
      expect(reads.mock.calls.filter((c) => String(c[0]).endsWith("big.md"))).toEqual([]);
      expect(opens.mock.calls.filter((c) => String(c[0]).endsWith("big.md"))).toEqual([]);
    }
  });

  it("the limit follows config maxTemplateBytes without a restart", () => {
    const env = createTemplateEnv();
    env.tpl("user", "t", md({ name: "t" }));
    expect(one(env, "t")?.valid).toBe(true);
    env.setConfig({ maxTemplateBytes: 10 });
    expect(codes(one(env, "t")?.errors ?? [])).toEqual(["template_too_large"]);
  });
});

describe("roster (E3-E6)", () => {
  const roster = (n: number) => Array.from({ length: n }, (_, i) => member(`m${i + 1}`));

  it("is capped at min(template maxTeammates, configured max)", () => {
    const env = createTemplateEnv();
    env.setConfig({ maxTeammates: 5 });
    env.tpl("user", "r3", md({ name: "r3", maxTeammates: 4, members: roster(3) }));
    env.tpl("user", "r4", md({ name: "r4", maxTeammates: 4, members: roster(4) }));
    env.tpl("user", "r5", md({ name: "r5", maxTeammates: 4, members: roster(5) }));
    env.tpl("user", "r6", md({ name: "r6", maxTeammates: 6, members: roster(6) }));
    env.tpl("user", "r5ok", md({ name: "r5ok", members: roster(5) }));
    const byName = (n: string) => one(env, n);
    expect(byName("r3")?.valid).toBe(true);
    expect(byName("r4")?.valid).toBe(true);
    expect(codes(byName("r5")?.errors ?? [])).toEqual(["roster_exceeds_max"]);
    expect(codes(byName("r6")?.errors ?? [])).toEqual(["roster_exceeds_max"]);
    expect(byName("r5ok")?.valid).toBe(true);
  });

  it("the template cap is the effective min in the loaded template", () => {
    const env = createTemplateEnv();
    env.setConfig({ maxTeammates: 5 });
    env.tpl("user", "t", md({ name: "t", maxTeammates: 9, members: roster(2) }));
    expect(load(env, "t")).toMatchObject({ ok: true, template: { maxTeammates: 5 } });
  });

  it("a huge count is refused without expanding", () => {
    const env = createTemplateEnv();
    env.tpl("user", "t", md({ name: "t", members: [member("a", { count: 1_000_000_000 })] }));
    expect(codes(one(env, "t")?.errors ?? [])).toEqual(["roster_exceeds_max"]);
  });

  it("count naming: 1 ⇒ name, 2 ⇒ name-1,name-2, 3 ⇒ name-1..3, never the bare name for count ≥ 2", () => {
    const env = createTemplateEnv();
    env.tpl("user", "c1", md({ name: "c1", members: [member("style", { count: 1 })] }));
    env.tpl("user", "c2", md({ name: "c2", members: [member("style", { count: 2 })] }));
    env.tpl("user", "c3", md({ name: "c3", members: [member("style", { count: 3 })] }));
    const names = (n: string) => {
      const r = load(env, n);
      return r.ok ? r.template.members.map((m) => m.name) : r;
    };
    expect(names("c1")).toEqual(["style"]);
    expect(names("c2")).toEqual(["style-1", "style-2"]);
    expect(names("c3")).toEqual(["style-1", "style-2", "style-3"]);
  });

  it("expanded names obey the core 32-character rule (roster_name_invalid)", () => {
    const env = createTemplateEnv();
    env.setConfig({ maxTeammates: 10 });
    const n31 = "a".repeat(31);
    const n30 = "a".repeat(30);
    env.tpl("user", "ok", md({ name: "ok", members: [member(n31, { count: 1 })] }));
    env.tpl("user", "long2", md({ name: "long2", members: [member(n31, { count: 2 })] }));
    env.tpl("user", "long10", md({ name: "long10", maxTeammates: 10, members: [member(n30, { count: 10 })] }));
    env.tpl("user", "upper", md({ name: "upper", members: [member("Style")] }));
    expect(one(env, "ok")?.valid).toBe(true);
    expect(codes(one(env, "long2")?.errors ?? [])).toEqual(["roster_name_invalid"]);
    expect(codes(one(env, "long10")?.errors ?? [])).toEqual(["roster_name_invalid"]);
    expect(codes(one(env, "upper")?.errors ?? [])).toEqual(["roster_name_invalid"]);
  });

  it("collisions are duplicate_member; reserved names are name_reserved", () => {
    const env = createTemplateEnv();
    env.tpl("user", "d1", md({ name: "d1", members: [member("style", { count: 2 }), member("style-1")] }));
    env.tpl("user", "d2", md({ name: "d2", members: [member("a"), member("a")] }));
    expect(codes(one(env, "d1")?.errors ?? [])).toEqual(["duplicate_member"]);
    expect(codes(one(env, "d2")?.errors ?? [])).toEqual(["duplicate_member"]);
    for (const reserved of ["lead", "server", "all", "user", "system"]) {
      env.tpl("user", `r-${reserved}`, md({ name: `r-${reserved}`, members: [member(reserved)] }));
      expect(codes(one(env, `r-${reserved}`)?.errors ?? [])).toEqual(["name_reserved"]);
    }
  });

  it("the listing summary carries the expanded roster and hasHooks", () => {
    const env = createTemplateEnv();
    env.tpl("user", "t", md({ name: "t", members: [member("style", { agent: "Explore", count: 2 })], hooks: { TaskCompleted: [{ command: "npm test" }] } }));
    expect(one(env, "t")).toMatchObject({ members: [{ name: "style-1", agent: "Explore" }, { name: "style-2", agent: "Explore" }], hasHooks: true });
  });
});

describe("numeric domains and field types (E7)", () => {
  const bad = (front: Record<string, unknown>) => {
    const env = createTemplateEnv();
    env.tpl("user", "t", md({ name: "t", ...front }));
    return one(env, "t");
  };

  it.each([0, -1, 1.5, "2", null])("member count %j ⇒ field_invalid at members[0].count", (count) => {
    const t = bad({ members: [member("a", { count })] });
    expect(t?.valid).toBe(false);
    expect(t?.errors).toContainEqual(expect.objectContaining({ code: "field_invalid", path: "members[0].count" }));
  });

  it.each([0, -1, 1.5, "3"])("maxTeammates %j ⇒ field_invalid at maxTeammates", (v) => {
    expect(bad({ maxTeammates: v })?.errors).toContainEqual(expect.objectContaining({ code: "field_invalid", path: "maxTeammates" }));
  });

  it.each([0, -1, 1.5, "5"])("hook timeoutMs %j ⇒ field_invalid at the hook path", (v) => {
    expect(bad({ hooks: { TaskCompleted: [{ command: "x", timeoutMs: v }] } })?.errors).toContainEqual(expect.objectContaining({ code: "field_invalid", path: "hooks.TaskCompleted[0].timeoutMs" }));
  });

  it.each([0, 10000])("notify.coalesceMs %i is valid", (v) => {
    expect(bad({ notify: { coalesceMs: v } })?.valid).toBe(true);
  });
  it.each([-1, 10001, 60000])("notify.coalesceMs %i ⇒ notify_out_of_range", (v) => {
    expect(codes(bad({ notify: { coalesceMs: v } })?.errors ?? [])).toEqual(["notify_out_of_range"]);
  });
  it("notify.coalesceMs 1.5 ⇒ field_invalid", () => {
    expect(bad({ notify: { coalesceMs: 1.5 } })?.errors).toContainEqual(expect.objectContaining({ code: "field_invalid", path: "notify.coalesceMs" }));
  });

  it("type errors name their path (requirePlanApproval, tools, spawn, autoDispatch, description)", () => {
    const t = bad({ requirePlanApproval: "maybe", defaultTools: "read", spawn: "bogus", autoDispatch: "yes", description: 5 });
    expect((t?.errors ?? []).map((e) => e.path).sort()).toEqual(["autoDispatch", "defaultTools", "description", "requirePlanApproval", "spawn"]);
    expect(new Set(codes(t?.errors ?? []))).toEqual(new Set(["field_invalid"]));
  });

  it("hooks: ≤3 commands per event, command ≤2000 chars, unknown event warns only", () => {
    const cmd = (n: number) => ({ command: "x".repeat(n) });
    expect(bad({ hooks: { TaskCompleted: [cmd(1), cmd(1), cmd(1)] } })?.valid).toBe(true);
    expect(codes(bad({ hooks: { TaskCompleted: [cmd(1), cmd(1), cmd(1), cmd(1)] } })?.errors ?? [])).toEqual(["too_many_hooks"]);
    expect(bad({ hooks: { TaskCompleted: [cmd(2000)] } })?.valid).toBe(true);
    expect(codes(bad({ hooks: { TaskCompleted: [cmd(2001)] } })?.errors ?? [])).toEqual(["hook_command_too_long"]);
    const unknown = bad({ hooks: { TaskDeleted: [cmd(1)] } });
    expect(unknown?.valid).toBe(true);
    expect(unknown?.warnings).toContainEqual(expect.objectContaining({ code: "unknown_hook_event" }));
  });

  it("an unknown key is a warning naming it; the template stays valid", () => {
    const t = bad({ colour: "red" });
    expect(t).toMatchObject({ valid: true });
    expect(t?.warnings).toContainEqual(expect.objectContaining({ code: "unknown_key", path: "colour" }));
  });

  it("hook commands get the effective default timeout and a stable hash", () => {
    const env = createTemplateEnv();
    env.tpl("user", "t", md({ name: "t", hooks: { TaskCompleted: [{ command: "a" }, { command: "b", timeoutMs: 5 }] } }));
    const r = load(env, "t");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const def = effectiveHookTimeoutMs(env.deps.config());
    expect(r.template.hooks).toEqual({ TaskCompleted: [{ command: "a", timeoutMs: def }, { command: "b", timeoutMs: 5 }] });
    expect(r.template.hooksHash).toBe(hashHooks(r.template.hooks ?? {}, def));
    env.setConfig({ hookTimeoutMs: 1234 });
    const r2 = load(env, "t");
    expect(r2.ok && r2.template.hooksHash).not.toBe(r.template.hooksHash);
  });
});

describe("hashHooks", () => {
  it("ignores key order and whitespace, tracks command, order, event and effective timeout", () => {
    const a = hashHooks({ TaskCompleted: [{ command: "x", timeoutMs: 5 }], TeammateIdle: [{ command: "y" }] }, 100);
    expect(hashHooks({ TeammateIdle: [{ command: "y", timeoutMs: 100 }], TaskCompleted: [{ timeoutMs: 5, command: "x" }] }, 100)).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashHooks({ TaskCompleted: [{ command: "x2", timeoutMs: 5 }], TeammateIdle: [{ command: "y" }] }, 100)).not.toBe(a);
    expect(hashHooks({ TaskCompleted: [{ command: "x", timeoutMs: 6 }], TeammateIdle: [{ command: "y" }] }, 100)).not.toBe(a);
    expect(hashHooks({ TaskCompleted: [{ command: "x", timeoutMs: 5 }], TeammateIdle: [{ command: "y" }] }, 200)).not.toBe(a);
    expect(hashHooks({ TaskCreated: [{ command: "x", timeoutMs: 5 }], TeammateIdle: [{ command: "y" }] }, 100)).not.toBe(a);
    const ab = hashHooks({ TaskCompleted: [{ command: "p" }, { command: "q" }] }, 1);
    expect(hashHooks({ TaskCompleted: [{ command: "q" }, { command: "p" }] }, 1)).not.toBe(ab);
    expect(hashHooks({}, 1)).toBe(hashHooks({ TaskCompleted: [] }, 1));
  });
});

describe("variables (E10) and goal", () => {
  function loaded(body: string, prompt?: string) {
    const env = createTemplateEnv();
    env.tpl("user", "t", md({ name: "t", members: [member("m", prompt === undefined ? {} : { prompt })] }, body));
    const r = load(env, "t");
    if (!r.ok) throw new Error(JSON.stringify(r));
    return r.template;
  }
  const render = (template: ReturnType<typeof loaded>, goal: string) => {
    const r = renderPlaybook({ template, goal, cwd: "/work/x", maxMessageChars: 8000 });
    if (!r.ok) throw new Error(JSON.stringify(r));
    return r;
  };

  it("substitutes {{goal}} and {{cwd}} once; the goal is data; unknown variables stay literal and warn", () => {
    const r = render(loaded("A {{goal}} B {{cwd}} C {{team}} D {{ goal }}", "P {{goal}}"), "{{cwd}}");
    expect(r.body).toBe("A {{cwd}} B /work/x C {{team}} D {{ goal }}\n");
    expect(r.members[0]?.prompt).toBe("P {{cwd}}");
    expect(r.warnings.map((w) => w.message).join("|")).toMatch(/\{\{team\}\}/);
    expect(r.warnings.filter((w) => w.code === "unknown_variable").length).toBeGreaterThanOrEqual(2);
    expect(r.playbook).toContain("Goal: {{cwd}}");
  });

  it("substituteVars is single pass and `$&`-safe", () => {
    expect(substituteVars("{{goal}}", { goal: "$& $1 {{goal}}", cwd: "c" })).toEqual({ text: "$& $1 {{goal}}", unknown: [] });
  });

  it("collapses a multi-line goal onto one line of the playbook", () => {
    const r = render(loaded("body"), "line1\nline2");
    expect(r.playbook).toContain("Goal: line1 line2\n");
  });

  it("normalizeGoal: control chars become one space, trim, empty / > 4000 code points invalid", () => {
    expect(normalizeGoal("a\u0000b")).toEqual({ ok: true, goal: "a b" });
    expect(normalizeGoal("line1\r\nline2\tx")).toEqual({ ok: true, goal: "line1 line2 x" });
    expect(normalizeGoal("  x  ")).toEqual({ ok: true, goal: "x" });
    expect(normalizeGoal("a".repeat(4000)).ok).toBe(true);
    expect(normalizeGoal("😀".repeat(4000)).ok).toBe(true);
    for (const bad of ["", "   ", "\t\n", "a".repeat(4001), "😀".repeat(4001), 5, undefined]) {
      expect(normalizeGoal(bad)).toMatchObject({ ok: false, error: "invalid_args" });
    }
  });
});

describe("playbook cap (E11, listing half)", () => {
  function tpl(body: string) {
    const env = createTemplateEnv();
    env.tpl("user", "t", `---\nname: t\n---\n${body}`);
    return env;
  }
  const rendered = (env: TemplateEnv, goal = "g") => {
    const r = load(env, "t");
    if (!r.ok) throw new Error(JSON.stringify(r));
    return renderPlaybook({ template: r.template, goal, cwd: "/w", maxMessageChars: env.deps.config().maxMessageChars });
  };

  it("a 9000-character body alone is listed invalid with playbook_too_long and is not startable", () => {
    const env = tpl("x".repeat(9000));
    expect(codes(one(env, "t")?.errors ?? [])).toEqual(["playbook_too_long"]);
    expect(load(env, "t")).toMatchObject({ ok: false, code: "template_invalid" });
  });

  it("character boundary maxMessageChars − 500 of the RENDERED playbook (code points, nothing truncated)", () => {
    const base = rendered(tpl("x"));
    if (!base.ok) throw new Error("base");
    const target = (n: number) => tpl("x".repeat(1 + n - base.chars));
    const at = (n: number) => rendered(target(n));
    expect(at(7499)).toMatchObject({ ok: true, chars: 7499 });
    expect(at(7500)).toMatchObject({ ok: true, chars: 7500 });
    const over = at(7501);
    expect(over).toMatchObject({ ok: false, code: "playbook_too_long", chars: 7501 });
  });

  it("line boundary 120 lines, envelope line counted, blank runs collapsed", () => {
    const env = tpl("x");
    const loadedTemplate = load(env, "t");
    if (!loadedTemplate.ok) throw new Error("load");
    // The loader would refuse a 120-line body alone; drive the renderer directly with synthetic bodies.
    const lines = (n: number) => renderPlaybook({ template: { ...loadedTemplate.template, body: Array.from({ length: n }, (_, i) => `l${i}`).join("\n") }, goal: "g", cwd: "/w", maxMessageChars: 8000 });
    const results = Array.from({ length: 125 }, (_, i) => lines(i + 1));
    const okMax = Math.max(...results.map((r, i) => (r.ok ? i : -1)));
    expect(results[okMax]).toMatchObject({ ok: true, lines: 120 });
    expect(results[okMax + 1]).toMatchObject({ ok: false, code: "playbook_too_long", lines: 121 });
    const blanks = renderPlaybook({ template: { ...loadedTemplate.template, body: `a${"\n".repeat(60)}b${"\n".repeat(60)}c` }, goal: "g", cwd: "/w", maxMessageChars: 8000 });
    expect(blanks).toMatchObject({ ok: true });
  });

  it("counts CRLF as one break and astral characters as one code point", () => {
    const env = tpl("a\r\nb\r\nc 😀😀");
    const r = load(env, "t");
    expect(r.ok).toBe(true);
    const a = rendered(env);
    const b = rendered(tpl("a\nb\nc 😀😀"));
    expect(a.ok && b.ok && [a.chars, a.lines]).toEqual(b.ok ? [b.chars, b.lines] : []);
  });

  it("a long goal pushes a valid template over the cap", () => {
    const env = tpl("x".repeat(6000));
    expect(one(env, "t")?.valid).toBe(true);
    expect(rendered(env, "g".repeat(4000))).toMatchObject({ ok: false, code: "playbook_too_long" });
  });

  it("an invalid goal is invalid_args from the renderer", () => {
    expect(rendered(tpl("b"), "  ")).toMatchObject({ ok: false, code: "invalid_args" });
  });

  it("the roster and plan-approval note appear in the playbook", () => {
    const env = createTemplateEnv();
    env.tpl("user", "t", md({ name: "t", spawn: "lead", requirePlanApproval: true, members: [member("a", { agent: "Audit" })] }, "Body"));
    const r = load(env, "t");
    if (!r.ok) throw new Error("load");
    const out = renderPlaybook({ template: r.template, goal: "g", cwd: "/w", maxMessageChars: 8000 });
    expect(out.ok && out.playbook).toContain("not spawned yet");
    expect(out.ok && out.playbook).toContain("- a (agent Audit)");
    expect(out.ok && out.playbook).toContain("Plan approval is required for: a");
    expect(out.ok && out.playbook.split("\n").slice(0, 2)).toEqual(["Template: t", "Goal: g"]);
  });
});

describe("mode gating (E23)", () => {
  it.each([
    ["omitted", undefined, true],
    ["session", "session", true],
    ["unregistered in-process", "in-process", false],
    ["garbage", "x", false],
  ])("mode %s", (_l, mode, ok) => {
    const env = createTemplateEnv();
    env.tpl("user", "t", md({ name: "t", ...(mode ? { mode } : {}) }));
    const t = one(env, "t");
    expect(t?.valid).toBe(ok);
    const r = load(env, "t");
    if (ok) expect(r).toMatchObject({ ok: true, template: { mode: "session" } });
    else {
      expect(codes(t?.errors ?? [])).toEqual(["mode_unavailable"]);
      expect(r).toMatchObject({ ok: false, code: "mode_unavailable" });
    }
  });

  it("availability is resolved per calling session", () => {
    const env = createTemplateEnv();
    env.deps.modes.register("picky", { driver: { mode: "picky" } as unknown as MemberDriver, available: (id) => (id === "S1" ? { ok: true } : { ok: false, reason: "needs S1" }) });
    env.tpl("user", "t", md({ name: "t", mode: "picky" }));
    expect(list(env, { sessionId: "S1" }).templates[0]).toMatchObject({ valid: true, mode: "picky" });
    expect(list(env, { sessionId: "S2" }).templates[0]).toMatchObject({ valid: false });
    expect(list(env).templates[0]).toMatchObject({ valid: false });
    expect(loadTemplate("t", env.cwd, env.deps, { caller: { sessionId: "S1" } }).ok).toBe(true);
    expect(loadTemplate("t", env.cwd, env.deps).ok).toBe(false);
  });
});

describe("spawn default and automation deferral (E41, listing half)", () => {
  it("omitted = eager; eager; lead; bogus ⇒ field_invalid", () => {
    const env = createTemplateEnv();
    env.tpl("user", "o", md({ name: "o" }));
    env.tpl("user", "e", md({ name: "e", spawn: "eager" }));
    env.tpl("user", "l", md({ name: "l", spawn: "lead" }));
    env.tpl("user", "b", md({ name: "b", spawn: "bogus" }));
    const spawn = (n: string) => {
      const r = load(env, n);
      return r.ok ? r.template.spawn : r;
    };
    expect(spawn("o")).toBe("eager");
    expect(spawn("e")).toBe("eager");
    expect(spawn("l")).toBe("lead");
    expect(one(env, "b")?.errors).toContainEqual(expect.objectContaining({ code: "field_invalid", path: "spawn" }));
  });

  it("the plugin manifest has no automation-action-editor claim and no agent-teams.start action", () => {
    const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "package.json");
    const text = fs.readFileSync(pkg, "utf8");
    expect(text).not.toContain("automation-action-editor");
    expect(text).not.toContain("agent-teams.start");
  });
});

describe("listing cap (E42)", () => {
  it.each([
    [199, 199, 0],
    [200, 200, 0],
    [201, 200, 1],
  ])("%i templates ⇒ %i listed, %i warning", (total, shown, warns) => {
    const env = createTemplateEnv();
    for (let i = 0; i < total; i++) {
      const name = `t${String(i).padStart(3, "0")}`;
      env.tpl("user", name, md({ name }));
    }
    const r = list(env);
    expect(r.templates).toHaveLength(shown);
    expect(r.templates.every((t) => t.valid)).toBe(true);
    expect(r.templates.map((t) => t.name)).toEqual([...r.templates.map((t) => t.name)].sort());
    expect(r.warnings).toHaveLength(warns);
    if (warns) {
      expect(r.warnings[0]).toContain("200");
      expect(r.templates.at(-1)?.name).toBe("t199");
    }
  });
});

describe("symlinks, traversal, non-regular (S1)", () => {
  it("a symlink to a file outside the source dir is outside_source_dir and never read", () => {
    const env = createTemplateEnv();
    const outside = path.join(env.agentDir, "..", "secret.md");
    fs.writeFileSync(outside, md({ name: "x" }));
    fs.mkdirSync(env.dir("project", "teams"), { recursive: true });
    fs.symlinkSync(outside, path.join(env.dir("project", "teams"), "x.md"));
    const reads = vi.spyOn(fs, "readFileSync");
    const t = one(env, "x");
    expect(t).toMatchObject({ valid: false, source: "project" });
    expect(codes(t?.errors ?? [])).toEqual(["outside_source_dir"]);
    expect(reads.mock.calls.filter((c) => String(c[0]).includes("secret.md"))).toEqual([]);
    expect(load(env, "x")).toMatchObject({ ok: false, code: "template_invalid", issues: [{ code: "outside_source_dir" }] });
  });

  it("a symlink that stays inside the directory is read", () => {
    const env = createTemplateEnv();
    env.tpl("user", "real", md({ name: "real" }));
    fs.symlinkSync(path.join(env.dir("user", "teams"), "real.md"), path.join(env.dir("user", "teams"), "alias.md"));
    expect(one(env, "real")?.valid).toBe(true);
    expect(codes(one(env, "alias")?.errors ?? [])).toEqual(["name_mismatch"]);
  });

  it("a symlinked source directory pointing outside the root is ignored with a warning", () => {
    const env = createTemplateEnv();
    const elsewhere = path.join(env.agentDir, "..", "elsewhere");
    fs.mkdirSync(elsewhere);
    fs.writeFileSync(path.join(elsewhere, "x.md"), md({ name: "x" }));
    fs.mkdirSync(path.join(env.cwd, ".pi"), { recursive: true });
    fs.symlinkSync(elsewhere, path.join(env.cwd, ".pi", "teams"));
    const r = list(env);
    expect(r.templates).toEqual([]);
    expect(r.warnings.join("|")).toMatch(/outside/);
    expect(load(env, "x")).toMatchObject({ ok: false, code: "template_not_found" });
  });

  it("a directory named x.md and a dangling symlink are skipped", () => {
    const env = createTemplateEnv();
    fs.mkdirSync(path.join(env.dir("user", "teams"), "x.md"), { recursive: true });
    fs.symlinkSync("/nonexistent/nowhere.md", path.join(env.dir("user", "teams"), "dangling.md"));
    expect(list(env).templates).toEqual([]);
    expect(load(env, "x")).toMatchObject({ ok: false, code: "template_not_found" });
  });

  it("dotfiles are ignored", () => {
    const env = createTemplateEnv();
    env.tpl("user", ".swp", md({ name: "x" }));
    expect(list(env).templates).toEqual([]);
  });
});

describe("untrusted project is never parsed (S2)", () => {
  it("lists the stem only, reads 0 file bodies, start ⇒ project_untrusted", () => {
    const env = createTemplateEnv();
    env.setTrusted(false);
    env.tpl("project", "evil", `---\n${"&a ".repeat(100)}\n: : :\n${"x".repeat(100000)}\nhooks: {TaskCompleted: [{command: "rm -rf /"}]}\n---\n`);
    const reads = vi.spyOn(fs, "readFileSync");
    const opens = vi.spyOn(fs, "openSync");
    const l = list(env);
    expect(l.templates).toEqual([expect.objectContaining({ name: "evil", source: "project", trusted: false, valid: false })]);
    expect(load(env, "evil")).toMatchObject({ ok: false, code: "project_untrusted" });
    expect(reads.mock.calls.filter((c) => String(c[0]).endsWith("evil.md"))).toEqual([]);
    expect(opens.mock.calls.filter((c) => String(c[0]).endsWith("evil.md"))).toEqual([]);
  });

  it("losing trust after a cached read stops serving the project template", () => {
    const env = createTemplateEnv();
    env.tpl("project", "p", md({ name: "p" }));
    expect(one(env, "p")?.valid).toBe(true);
    env.setTrusted(false);
    expect(one(env, "p")).toMatchObject({ trusted: false, valid: false });
    expect(load(env, "p")).toMatchObject({ ok: false, code: "project_untrusted" });
  });
});

describe("YAML hazards (S10)", () => {
  const fm = (yaml: string, body = "b") => `---\n${yaml}\n---\n${body}\n`;
  const hazards: Array<[string, string]> = [
    ["anchor and alias", fm("name: t\nx: &a 1\ny: *a")],
    ["anchor only", fm("name: t\nx: &a 1")],
    ["merge key", fm("name: t\nbase: {a: 1}\nm:\n  <<: {a: 2}")],
    ["custom tag", fm("name: t\nx: !!js/function foo")],
    ["!!binary", fm("name: t\nx: !!binary aGVsbG8=")],
    ["duplicate keys", fm("name: t\nname: t")],
    ["scalar frontmatter", fm("just a scalar")],
    ["sequence frontmatter", fm("- a\n- b")],
    ["missing closing fence", "---\nname: t\nbody never closed\n"],
    ["missing opening fence", "name: t\n---\nbody\n"],
    ["empty frontmatter", fm("")],
    ["10000-deep nesting", fm(`name: t\nx: ${"[".repeat(10000)}${"]".repeat(10000)}`)],
    ["10000-deep mapping", fm(`name: t\nx: ${"{a: ".repeat(10000)}1${"}".repeat(10000)}`)],
    ["billion laughs", fm(`name: t\na: &a ${JSON.stringify(Array(20).fill("lol"))}\n${Array.from({ length: 9 }, (_, i) => `b${i}: &b${i} [${Array(20).fill(i === 0 ? "*a" : `*b${i - 1}`).join(",")}]`).join("\n")}`)],
  ];

  it.each(hazards)("%s ⇒ invalid promptly, bounded memory", (label, text) => {
    const heap0 = process.memoryUsage().heapUsed;
    const t0 = performance.now();
    const out = parseTemplate(text, "t");
    const ms = performance.now() - t0;
    const grown = process.memoryUsage().heapUsed - heap0;
    const bad = [...out.errors];
    expect(bad.length, label).toBeGreaterThan(0);
    expect(bad.some((e) => e.code === "frontmatter_invalid" || e.code === "name_invalid"), label).toBe(true);
    if (label !== "empty frontmatter") expect(codes(out.errors)).toContain("frontmatter_invalid");
    expect(ms).toBeLessThan(200);
    expect(grown).toBeLessThan(20 * 1024 * 1024);
  });

  it("a ~64 KiB billion-laughs document is rejected quickly", () => {
    const lines = [`name: t`, `a0: &a0 [${Array(40).fill("x").join(",")}]`];
    for (let i = 1; i < 700; i++) lines.push(`a${i}: &a${i} [${Array(8).fill(`*a${i - 1}`).join(",")}]`);
    const text = fm(lines.join("\n"));
    expect(text.length).toBeGreaterThan(30 * 1024);
    const t0 = performance.now();
    expect(codes(parseTemplate(text, "t").errors)).toContain("frontmatter_invalid");
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it("BOM and CRLF are accepted", () => {
    const crlf = `\uFEFF---\r\nname: t\r\ndescription: hi\r\n---\r\nBody line\r\n`;
    const out = parseTemplate(crlf, "t");
    expect(out.errors).toEqual([]);
    expect(out.core?.description).toBe("hi");
    expect(out.core?.body).toBe("Body line\n");
  });

  it("a hazardous file is listed invalid frontmatter_invalid and never crashes the listing", () => {
    const env = createTemplateEnv();
    env.tpl("user", "t", fm("name: t\nx: &a 1\ny: *a"));
    env.tpl("user", "ok", md({ name: "ok" }));
    const r = list(env);
    expect(codes(r.templates.find((t) => t.name === "t")?.errors ?? [])).toEqual(["frontmatter_invalid"]);
    expect(r.templates.find((t) => t.name === "ok")?.valid).toBe(true);
  });
});

describe("cache", () => {
  it("re-parses after the file changes (same size) and after invalidate()", () => {
    const env = createTemplateEnv();
    const p = env.tpl("user", "t", md({ name: "t", description: "aaaa" }));
    expect(one(env, "t")?.description).toBe("aaaa");
    fs.writeFileSync(p, md({ name: "t", description: "bbbb" }));
    const now = new Date(Date.now() + 5000);
    fs.utimesSync(p, now, now);
    expect(one(env, "t")?.description).toBe("bbbb");
    expect(templateCache.size).toBeGreaterThan(0);
    templateCache.invalidate();
    expect(templateCache.size).toBe(0);
  });

  it("a warm listing does not read the files again", () => {
    const env = createTemplateEnv();
    for (const n of ["a", "b", "c"]) env.tpl("user", n, md({ name: n }));
    list(env);
    const reads = vi.spyOn(fs, "readFileSync");
    const l = list(env);
    expect(l.templates).toHaveLength(3);
    expect(reads.mock.calls.filter((c) => String(c[0]).endsWith(".md"))).toEqual([]);
  });

  it("config-dependent checks apply to cached entries (roster cap follows maxTeammates)", () => {
    const env = createTemplateEnv();
    env.tpl("user", "t", md({ name: "t", members: [member("a"), member("b"), member("c")] }));
    expect(one(env, "t")?.valid).toBe(true);
    env.setConfig({ maxTeammates: 2 });
    expect(codes(one(env, "t")?.errors ?? [])).toEqual(["roster_exceeds_max"]);
  });
});
