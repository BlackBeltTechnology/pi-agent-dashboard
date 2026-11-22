/**
 * Tighten-only project layer (harden-agent-tool-guards D4). Rows T.51–T.59, T.106's unit half
 * (test-plan #E51–#E59). Real files under a temp agent dir + project dir.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyProjectLayer, DEFAULT_SETTINGS, loadSettings, resolveSettings } from "../settings.js";

let tmp: string;
let agent: string;
let proj: string;
let logs: string[];
let prevAgent: string | undefined;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ucg-settings-"));
  agent = path.join(tmp, "agent");
  proj = path.join(tmp, "proj");
  fs.mkdirSync(agent, { recursive: true });
  fs.mkdirSync(path.join(proj, ".pi"), { recursive: true });
  prevAgent = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agent;
  logs = [];
});
afterEach(() => {
  if (prevAgent === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = prevAgent;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const write = (dir: string, key: unknown | undefined) =>
  fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify(key === undefined ? {} : { "untrusted-content-guard": key }));
const load = (user: unknown, project: unknown, trusted = true) => {
  write(agent, user);
  write(path.join(proj, ".pi"), project);
  return loadSettings(proj, trusted, (l) => logs.push(l));
};

describe("T.51 no-op project fields are silent", () => {
  it("mode strip over strip, sensitiveTools [], taintScope run over run", () => {
    const s = load(undefined, { mode: "strip", sensitiveTools: [], taintScope: "run" });
    expect(logs).toEqual([]);
    expect(s).toEqual(resolveSettings());
  });
});

describe("T.52 invalid values are dropped by sanitize: no effect, no log", () => {
  it("BLOCK, 3, forever, 'bash'", () => {
    const s = load(undefined, { mode: "BLOCK" }) && load(undefined, { mode: 3, taintScope: "forever", sensitiveTools: "bash" });
    expect(logs).toEqual([]);
    expect(s).toEqual(resolveSettings());
  });
});

describe("T.53 lowering mode and allowHosts log once each per call, without values", () => {
  it("two lines per call, effective mode strip; two calls → four lines", () => {
    write(agent, undefined);
    write(path.join(proj, ".pi"), { mode: "off", allowHosts: ["x"] });
    const a = loadSettings(proj, true, (l) => logs.push(l));
    expect(a.mode).toBe("strip");
    expect(a.allowHosts).toEqual([]);
    expect(logs).toHaveLength(2);
    expect(logs.join("\n")).toMatch(/"mode"/);
    expect(logs.join("\n")).toMatch(/"allowHosts"/);
    expect(logs.join("\n")).not.toMatch(/\boff\b|"x"/);
    loadSettings(proj, true, (l) => logs.push(l));
    expect(logs).toHaveLength(4);
  });
});

describe("T.54 taintScope", () => {
  it("user session + project run → session and one line; project session over user run → session, no line", () => {
    expect(load({ taintScope: "session" }, { taintScope: "run" }).taintScope).toBe("session");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('"taintScope"');
    logs.length = 0;
    expect(load({ taintScope: "run" }, { taintScope: "session" }).taintScope).toBe("session");
    expect(logs).toEqual([]);
  });
});

describe("T.55 mode lattice (25 cells)", () => {
  const modes = ["unset", "off", "warn", "strip", "block"] as const;
  const rank = { off: 0, warn: 1, strip: 2, block: 3 } as const;
  const cells = modes.flatMap((u) => modes.map((p) => [u, p] as const));
  it.each(cells)("user=%s project=%s → max(user-or-strip, project)", (u, p) => {
    const s = load(u === "unset" ? undefined : { mode: u }, p === "unset" ? undefined : { mode: p });
    const base = u === "unset" ? "strip" : u;
    expect(s.mode).toBe(p !== "unset" && rank[p] > rank[base] ? p : base);
  });
});

describe("T.56 unions", () => {
  const users: Array<[string, string[] | undefined]> = [["default", undefined], ["bash only", ["bash"]], ["empty", []]];
  const projects: string[][] = [["foo"], [], ["bash", "foo"], ["*_send"]];
  const cells = users.flatMap(([name, user]) => projects.map((proj) => [name, user, proj] as const));
  it.each(cells)("user %s + project %j → user ∪ project, deduplicated, globs verbatim", (_name, user, proj) => {
    const s = load(user === undefined ? undefined : { sensitiveTools: user }, { sensitiveTools: proj });
    expect(s.sensitiveTools).toEqual([...new Set([...(user ?? DEFAULT_SETTINGS.sensitiveTools), ...proj])]);
  });
  it("project [] removes nothing; user [] + project [foo] = [foo]; untrustedTools are unioned too", () => {
    expect(load({ sensitiveTools: [] }, { sensitiveTools: ["foo"] }).sensitiveTools).toEqual(["foo"]);
    expect(load(undefined, { untrustedTools: ["x"] }).untrustedTools).toEqual([...DEFAULT_SETTINGS.untrustedTools, "x"]);
  });
});

describe("T.57 allowHosts", () => {
  it("a project cannot add hosts; the user's stay", () => {
    expect(load(undefined, { allowHosts: ["evil.example"] }).allowHosts).toEqual([]);
    expect(load({ allowHosts: ["cdn.ok"] }, { allowHosts: ["evil.example"] }).allowHosts).toEqual(["cdn.ok"]);
  });
});

describe("T.58 strict preset", () => {
  it("adds write/edit and session scope in every strict cell; unknown preset dropped", () => {
    for (const user of [undefined, { taintScope: "run" }, { taintScope: "session" }]) {
      for (const pts of [undefined, "run"]) {
        const s = load(user, { preset: "strict", ...(pts ? { taintScope: pts } : {}) });
        expect(s.sensitiveTools).toEqual(expect.arrayContaining(["write", "edit"]));
        expect(s.taintScope).toBe("session");
        expect(s.preset).toBe("strict");
      }
    }
    logs.length = 0; // strict × project `run` logs the ignored taintScope; the unknown preset must not
    const loose = load(undefined, { preset: "loose" });
    expect(loose).toEqual(resolveSettings());
    expect(logs).toEqual([]);
  });
});

describe("T.59 layer availability + pure merge regression", () => {
  it("untrusted project, missing/malformed project file, undefined cwd → project layer skipped", () => {
    write(agent, { mode: "warn" });
    write(path.join(proj, ".pi"), { mode: "block", sensitiveTools: ["foo"] });
    expect(loadSettings(proj, false, (l) => logs.push(l)).mode).toBe("warn");
    fs.rmSync(path.join(proj, ".pi", "settings.json"));
    expect(loadSettings(proj, true, (l) => logs.push(l)).mode).toBe("warn");
    fs.writeFileSync(path.join(proj, ".pi", "settings.json"), "{not json");
    expect(loadSettings(proj, true, (l) => logs.push(l)).mode).toBe("warn");
    expect(loadSettings(undefined, true, (l) => logs.push(l)).mode).toBe("warn");
    expect(logs).toEqual([]);
  });
  it("resolveSettings keeps field-wise Object.assign semantics for global layers", () => {
    expect(resolveSettings({ mode: "off", sensitiveTools: ["a"] }, { mode: "warn" })).toMatchObject({ mode: "warn", sensitiveTools: ["a"] });
    expect(load({ mode: "warn" }, undefined).mode).toBe("warn");
  });
});

describe("applyProjectLayer is pure and never mutates its inputs", () => {
  it("leaves the base untouched", () => {
    const base = resolveSettings();
    const snapshot = JSON.stringify(base);
    applyProjectLayer(base, { mode: "block", sensitiveTools: ["foo"], preset: "strict" });
    expect(JSON.stringify(base)).toBe(snapshot);
  });
});
