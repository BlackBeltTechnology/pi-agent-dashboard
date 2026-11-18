/**
 * Read carve-out of the agent path gate (harden-agent-tool-guards D2): `models.json`,
 * `mcp.json` (+ `<name>.*`) and other projects' `sessions/**` of EVERY agent dir ask on
 * read, sensitive, never `Always allow`, whatever root would otherwise admit them.
 * Rows T.13–T.21, T.26, T.27 (test-plan #E13–#E21, #E26, #E27).
 */
import nodePath from "node:path";
import { describe, expect, it } from "vitest";
import { buildOptions, decidePathAccess, type GateRoots } from "../decide.js";
import type { ResolveEnv } from "../resolve.js";

const DIRS = ["/", "/w", "/w/repo", "/w/other", "/h", "/h/.pi", "/h/.pi/agent", "/srv", "/srv/pi-agent", "/opt", "/opt/third"];
const posixEnv = (over: Partial<ResolveEnv> = {}): ResolveEnv => ({
  path: nodePath.posix,
  platform: "linux",
  homeDir: "/h",
  realpathSync: (p) => {
    if (DIRS.includes(p)) return p;
    throw new Error("ENOENT");
  },
  exists: (p) => DIRS.includes(p),
  isDirectory: (p) => DIRS.includes(p),
  ...over,
});

const AGENT = "/h/.pi/agent";
const OWN = `${AGENT}/sessions/--w-repo--`;
const roots = (over: Partial<GateRoots> = {}): GateRoots => ({
  workspace: ["/w/repo"],
  readOnly: [AGENT],
  readWrite: [OWN],
  grants: [],
  askRead: { agentDirs: [AGENT, "/srv/pi-agent", "/opt/third"], ownSessionDir: OWN },
  ...over,
});
const run = (rawPath: string, over: Record<string, unknown> = {}) =>
  decidePathAccess({
    access: "read",
    rawPath,
    cwd: "/w/repo",
    roots: roots(),
    sensitiveDirs: ["/h/.ssh", "/h/.pi"],
    // `/srv` is grantable, only `/h` (home) and `/` are not
    isUngrantable: (s: string) => s === "/h" || s === "/" || s.startsWith("/h/.pi") || s.startsWith("/h/.ssh"),
    env: posixEnv(),
    caseInsensitive: false,
    ...over,
  });
const asks = (d: ReturnType<typeof run>) => d.verdict === "ask" && d.sensitive && !d.grantable;
const offers = (d: ReturnType<typeof run>) =>
  d.verdict === "ask" ? buildOptions({ grantable: d.grantable, sensitive: d.sensitive, storeMatch: true, subject: d.subject }).options : [];

describe("T.13: target × root config", () => {
  const targets = [`${AGENT}/sessions/--w-other--/a.jsonl`, `${AGENT}/models.json`, `${AGENT}/mcp.json`, `${AGENT}/mcp.json.bak`, `${AGENT}/models.json.1`];
  const configs: Array<[string, Partial<GateRoots>]> = [
    ["default", {}],
    ["cwd=$HOME", { workspace: ["/h"] }],
    ["dotfiles checkout above agent dir", { workspace: ["/w/repo", "/h/.pi"] }],
    ["grant containing the override dir", { grants: ["/srv/pi-agent"], workspace: ["/w/repo"] }],
  ];
  for (const [name, over] of configs) {
    for (const t of targets) {
      it(`${name}: ${t}`, () => {
        const d = run(t, { roots: roots(over) });
        expect(asks(d)).toBe(true);
        expect(offers(d)).toEqual(["Allow once", "Deny"]);
      });
    }
  }
  it("the override-dir copies ask under the grant that contains them", () => {
    for (const t of ["/srv/pi-agent/mcp.json", "/srv/pi-agent/models.json.1", "/srv/pi-agent/sessions/x/y.jsonl"]) {
      expect(asks(run(t, { roots: roots({ grants: ["/srv/pi-agent"] }) })), t).toBe(true);
    }
  });
});

describe("T.14: what stays silent", () => {
  it.each([
    `${AGENT}/settings.json`,
    `${AGENT}/trust.json`,
    `${AGENT}/prompts/p.md`,
    `${OWN}/own.jsonl`,
  ])("%s is in-root (read-only agent dir / own session dir)", (t) => {
    expect(run(t).verdict).toBe("in-root");
  });
  it("loaded skill dir, checkout file and granted file stay silent; skill edit still asks", () => {
    const r = roots({ readOnly: [AGENT, `${AGENT}/skills/x`], grants: ["/w/other"] });
    expect(run(`${AGENT}/skills/x/SKILL.md`, { roots: r }).verdict).toBe("in-root");
    expect(run("/w/repo/a.ts", { roots: r }).verdict).toBe("in-root");
    expect(run("/w/other/docs/a.md", { roots: r }).verdict).toBe("in-root");
    expect(run("/w/other/docs/a.md", { roots: roots() }).verdict).toBe("ask");
    expect(run(`${AGENT}/skills/x/SKILL.md`, { roots: r, access: "write" }).verdict).toBe("ask");
  });
});

describe("T.15: name boundaries", () => {
  it.each([`${AGENT}/sessions-old/x`, `${AGENT}/sessionsX/x`, `${AGENT}/skills/sessions/x`, `${AGENT}/mcp.jsonl`, `${AGENT}/xmodels.json`, `${AGENT}/foo/mcp.json`, `${AGENT}/models.json/..`])(
    "%s is NOT the carve-out",
    (t) => {
      expect(run(t).verdict).toBe("in-root");
    },
  );
  it.each([`${AGENT}/sessions/a`, `${AGENT}/sessions/a/b/c.jsonl`, `${AGENT}/models.json.`, `${AGENT}/mcp.json.x`])("%s asks, sensitive", (t) => {
    expect(asks(run(t))).toBe(true);
  });
});

describe("T.16: own session dir prefix", () => {
  it("own file silent, look-alike siblings ask", () => {
    expect(run(`${OWN}/own.jsonl`).verdict).toBe("in-root");
    for (const t of [`${AGENT}/sessions/--w-repo--2/x.jsonl`, `${AGENT}/sessions/--w-repo/x.jsonl`, `${AGENT}/sessions/--w-repo----/x.jsonl`]) {
      expect(asks(run(t)), t).toBe(true);
    }
  });
});

describe("T.17: override dir + control", () => {
  it("carve-out is ungrantable even though its directory is grantable; control still grants", () => {
    for (const t of ["/srv/pi-agent/mcp.json", "/srv/pi-agent/sessions/x/y.jsonl"]) {
      const d = run(t);
      expect(asks(d), t).toBe(true);
      expect(offers(d)).toEqual(["Allow once", "Deny"]);
    }
    const c = run("/w/other/docs/a.md");
    expect(c).toMatchObject({ verdict: "ask", sensitive: false, grantable: true });
    expect(offers(c)).toContain("Always allow /w/other/docs…");
  });
});

describe("T.18: three agent dirs", () => {
  it("models.json / mcp.json of each dir ask", () => {
    for (const dir of [AGENT, "/srv/pi-agent", "/opt/third"]) for (const f of ["models.json", "mcp.json"]) {
      expect(asks(run(`${dir}/${f}`)), `${dir}/${f}`).toBe(true);
    }
  });
});

describe("T.19: the sessions directory itself", () => {
  it("asks for the dir (with/without trailing slash, all three dirs); own subdir stays silent", () => {
    for (const dir of [AGENT, "/srv/pi-agent", "/opt/third"]) {
      for (const raw of [`${dir}/sessions`, `${dir}/sessions/`]) expect(asks(run(raw)), raw).toBe(true);
    }
    expect(run(OWN).verdict).toBe("in-root");
  });
});

describe("T.20: path forms", () => {
  it("dot-dot and symlinked forms resolve canonically", () => {
    expect(asks(run(`${AGENT}/./sessions/../models.json`))).toBe(true);
    expect(asks(run(`${AGENT}/skills/../mcp.json`))).toBe(true);
    const link = posixEnv({ realpathSync: (p) => (p === "/w/repo/ln" ? `${AGENT}/sessions/--w-other--` : posixEnv().realpathSync(p)), exists: () => true });
    expect(asks(run("/w/repo/ln", { env: link }))).toBe(true);
  });
});

describe("T.20b: a symlink-managed agent file still asks (dotfiles manager)", () => {
  it("~/.pi/agent/models.json → /w/repo/dot/models.json, and a symlinked sessions dir, ask under a covering workspace", () => {
    const real = (p: string): string => {
      if (p === `${AGENT}/models.json`) return "/w/repo/dot/models.json";
      if (p === `${AGENT}/sessions/--w-other--`) return "/w/repo/dot/sessions-other";
      return posixEnv().realpathSync(p);
    };
    const env = posixEnv({ realpathSync: real, exists: () => true });
    expect(asks(run(`${AGENT}/models.json`, { env }))).toBe(true);
    expect(asks(run(`${AGENT}/sessions/--w-other--`, { env }))).toBe(true);
    // The real location alone (not reached through the agent dir) is an ordinary in-root read.
    expect(run("/w/repo/dot/models.json", { env }).verdict).toBe("in-root");
  });
});

describe("T.21: access mode × roots", () => {
  it("read asks under both root configs; write/edit unchanged (residual under a spanning root)", () => {
    const span = roots({ workspace: ["/h"] });
    expect(asks(run(`${AGENT}/mcp.json`))).toBe(true);
    expect(asks(run(`${AGENT}/mcp.json`, { roots: span }))).toBe(true);
    expect(run(`${AGENT}/mcp.json`, { access: "write" }).verdict).toBe("ask");
    expect(run(`${AGENT}/mcp.json`, { access: "write", roots: span }).verdict).toBe("in-root");
  });
});

describe("T.26: case folding", () => {
  it("case-insensitive volume: spelling variant asks sensitive; case-sensitive: a different file", () => {
    expect(asks(run(`${AGENT.toUpperCase()}/MCP.JSON`, { caseInsensitive: true, env: posixEnv({ platform: "darwin" }) }))).toBe(true);
    // case-sensitive volume: `/SRV/PI-AGENT/MCP.JSON` is a DIFFERENT file than the carve-out's, so it is a
    // plain out-of-root ask (not sensitive, grantable), while the exact spelling is the carve-out.
    expect(run("/SRV/PI-AGENT/MCP.JSON", { caseInsensitive: false })).toMatchObject({ verdict: "ask", sensitive: false, grantable: true });
    expect(asks(run("/srv/pi-agent/mcp.json", { caseInsensitive: false }))).toBe(true);
  });
});

describe("T.27: win32 flavour", () => {
  const win = posixEnv({
    path: nodePath.win32,
    platform: "win32",
    homeDir: "C:\\Users\\u",
    realpathSync: (p) => p,
    exists: () => true,
    isDirectory: () => false,
  });
  it("matches drive/case-insensitively", () => {
    const r = roots({ askRead: { agentDirs: ["C:\\Users\\u\\.pi\\agent", "D:\\pi"], ownSessionDir: undefined }, workspace: ["C:\\w\\repo"], readOnly: ["C:\\Users\\u\\.pi\\agent"] });
    for (const t of ["C:\\Users\\u\\.pi\\agent\\models.json", "c:\\users\\u\\.pi\\agent\\SESSIONS\\x\\a.jsonl", "D:\\pi\\mcp.json"]) {
      const d = run(t, { env: win, roots: r, cwd: "C:\\w\\repo", caseInsensitive: true, isUngrantable: () => false });
      expect(asks(d), t).toBe(true);
    }
  });
});
