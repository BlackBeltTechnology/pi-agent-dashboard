/**
 * Handler-level rows for the agent-dir read carve-out (harden-agent-tool-guards D2):
 * T.22 verdict memory, T.23 YOLO bypass, T.24 grant-admission spy, T.25 forged
 * `Always allow`, T.28 headless, T.115 resolver failure, T.116 prompt timeout / throw,
 * plus the RootsProvider carve-out set (T.18 union, T.2.3 own session dir).
 */
import nodePath from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createPathGateHandler, type GatePrompter, type PathGateDeps } from "../handler.js";
import type { ResolveEnv } from "../resolve.js";
import { RootsProvider } from "../roots.js";
import { Suppression } from "../suppression.js";

const DIRS = ["/", "/w", "/w/repo", "/w/other", "/h", "/h/.pi", "/h/.pi/agent", "/srv", "/srv/pi-agent"];
const env: ResolveEnv = {
  path: nodePath.posix,
  platform: "linux",
  homeDir: "/h",
  realpathSync: (p) => {
    if (DIRS.includes(p)) return p;
    throw new Error("ENOENT");
  },
  exists: () => false,
  isDirectory: () => false,
};
const AGENT = "/h/.pi/agent";
const OWN = `${AGENT}/sessions/--w-repo--`;

function make(over: Partial<PathGateDeps> = {}, answers: Array<string | undefined> = ["Allow once"], hasUI = true) {
  const t = 0;
  const selects: Array<{ options: string[]; metadata: Record<string, unknown> }> = [];
  const logs: string[] = [];
  const isUngrantable = vi.fn((s: string) => s === "/h" || s.startsWith("/h/.pi"));
  const requestGrant = vi.fn(async () => ({ ok: true }));
  const prompter: GatePrompter = {
    select: async (a) => (selects.push(a), answers.shift()),
    confirm: async () => true,
    cancel: () => {},
  };
  const deps: PathGateDeps = {
    getConfig: () => ({ enabled: true, timeoutSeconds: 120 }),
    getRoots: async (grants) => ({
      workspace: ["/w/repo"],
      readOnly: [AGENT],
      readWrite: [OWN],
      grants,
      askRead: { agentDirs: [AGENT, "/srv/pi-agent"], ownSessionDir: OWN },
    }),
    getGrants: () => [],
    getSensitiveDirs: () => ["/h/.ssh", "/h/.pi"],
    isUngrantable,
    prompter,
    grantStoreMatch: () => true,
    requestGrant,
    log: (l) => logs.push(l),
    sessionId: () => "S1",
    env,
    now: () => t,
    setTimer: (fn, ms) => ({ at: t + ms, fn }),
    clearTimer: () => {},
    newId: () => "p1",
    suppression: new Suppression(() => t),
    ...over,
  };
  const handler = createPathGateHandler(deps);
  const ctx = { hasUI, cwd: "/w/repo" };
  const call = (tool: string, path: string) => handler({ toolName: tool, toolCallId: "tc", input: { path } }, ctx as never);
  return { call, selects, logs, isUngrantable, requestGrant, deps };
}

describe("T.22: verdict memory", () => {
  it("after Deny: settings.json silent, mcp.json blocked as recently-denied", async () => {
    const h = make({}, ["Deny"]);
    expect(await h.call("read", `${AGENT}/mcp.json`)).toMatchObject({ block: true });
    expect(await h.call("read", `${AGENT}/settings.json`)).toBeUndefined();
    const again = await h.call("read", `${AGENT}/mcp.json`);
    expect(again?.reason).toContain("recently-denied");
    expect(h.selects).toHaveLength(1);
  });
  it("after Allow once: asks again, no grant recorded", async () => {
    const h = make({}, ["Allow once", "Allow once"]);
    expect(await h.call("read", `${AGENT}/mcp.json`)).toBeUndefined();
    expect(await h.call("read", `${AGENT}/mcp.json`)).toBeUndefined();
    expect(h.selects).toHaveLength(2);
    expect(h.requestGrant).not.toHaveBeenCalled();
  });
});

describe("T.23: YOLO never decides a carve-out path", () => {
  it("yoloDecide is not called for /srv/pi-agent/mcp.json; control goes to YOLO", async () => {
    const yoloDecide = vi.fn(async () => "auto-allow" as const);
    const h = make({ yoloSupported: () => true, yoloDecide, isUngrantable: () => false }, ["Allow once"]);
    expect(await h.call("read", "/srv/pi-agent/mcp.json")).toBeUndefined();
    expect(yoloDecide).not.toHaveBeenCalled();
    expect(h.selects).toHaveLength(1);
    expect(await h.call("read", "/w/other/readme.md")).toBeUndefined();
    expect(yoloDecide).toHaveBeenCalledTimes(1);
  });
});

describe("T.24: no grant admission attempted", () => {
  it("the ungrantable check is never consulted for the prompt of a carve-out subject", async () => {
    const spy = vi.fn(() => false);
    const h = make({ isUngrantable: spy }, ["Allow once"]);
    await h.call("read", "/srv/pi-agent/mcp.json");
    expect(spy).not.toHaveBeenCalled();
    expect(h.selects[0].options).toEqual(["Allow once", "Deny"]);
    expect(h.requestGrant).not.toHaveBeenCalled();
  });
});

describe("T.25: forged Always allow", () => {
  it("is refused as not offered: no confirm, no grant, call stays blocked", async () => {
    const confirm = vi.fn(async () => true);
    const h = make({}, ["Always allow /srv/pi-agent…"]);
    h.deps.prompter.confirm = confirm;
    const r = await h.call("read", "/srv/pi-agent/mcp.json");
    expect(r).toMatchObject({ block: true });
    expect(confirm).not.toHaveBeenCalled();
    expect(h.requestGrant).not.toHaveBeenCalled();
  });
});

describe("T.28: headless", () => {
  it("blocks no-ui without a prompt; the log carries sensitive=true", async () => {
    const h = make({}, [], false);
    const r = await h.call("read", `${AGENT}/models.json`);
    expect(r).toMatchObject({ block: true });
    expect(r?.reason).toContain("no-ui");
    expect(h.selects).toHaveLength(0);
    expect(h.logs.some((l) => l.includes("no-ui") && l.includes("sensitive=true"))).toBe(true);
  });
});

describe("T.116: unanswered / throwing prompt never allows", () => {
  it("timeout → blocked", async () => {
    const timers: Array<() => void> = [];
    const h = make(
      { setTimer: (fn) => (timers.push(fn), {}) },
      [],
    );
    h.deps.prompter.select = () => new Promise(() => {});
    const p = h.call("read", `${AGENT}/mcp.json`);
    await new Promise((r) => setTimeout(r, 0));
    timers[0]();
    expect(await p).toMatchObject({ block: true });
  });
  it("select throws → blocked (fail closed)", async () => {
    const h = make();
    h.deps.prompter.select = async () => {
      throw new Error("boom");
    };
    expect(await h.call("read", `${AGENT}/mcp.json`)).toMatchObject({ block: true });
  });
});

describe("RootsProvider carve-out set", () => {
  const mk = (over: { res?: () => never | { agentDir: string; skillDirs: string[]; contextFiles: string[] }; sessionDir?: string } = {}) =>
    new RootsProvider({
      getCwd: () => "/w/repo",
      getSessionDir: () => over.sessionDir,
      getPiResources: over.res ?? (() => ({ agentDir: "/opt/third", skillDirs: [], contextFiles: [] })),
      probe: async () => [],
    });

  it("T.18: union of ~/.pi/agent, PI_CODING_AGENT_DIR and pi's own dir, independent of readOnly", async () => {
    const prev = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = "/srv/pi-agent";
    try {
      const r = await mk({ sessionDir: "/h/.pi/agent/sessions/own" }).roots([], false, "/w/repo");
      const dirs = r.askRead?.agentDirs ?? [];
      expect(dirs).toEqual(expect.arrayContaining([nodePath.join(process.env.HOME ?? "", ".pi", "agent"), "/srv/pi-agent", "/opt/third"]));
      expect(r.askRead?.ownSessionDir).toBe("/h/.pi/agent/sessions/own");
    } finally {
      if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = prev;
    }
  });

  it("T.115: a throwing resolver keeps the carve-out (home + env dirs) and does not throw", async () => {
    const r = await mk({
      res: () => {
        throw new Error("resolver down");
      },
    }).roots([], false, "/w/repo");
    expect(r.askRead?.agentDirs.some((d) => d.endsWith(nodePath.join(".pi", "agent")))).toBe(true);
    expect(r.readOnly).toEqual([]);
  });
});

describe("T.93 in-root reads with the carve-out evaluated first", () => {
  it("p95 < 1 ms over 1000 reads (workspace and read-only roots; best of 3 batches)", async () => {
    const h = make();
    const batch = async (): Promise<number> => {
      const samples: number[] = [];
      for (let i = 0; i < 1000; i++) {
        const path = i % 2 === 0 ? "/w/repo/src/a.ts" : `${AGENT}/skills/x/SKILL.md`;
        const s = performance.now();
        expect(await h.call("read", path)).toBeUndefined();
        samples.push(performance.now() - s);
      }
      samples.sort((a, b) => a - b);
      return samples[Math.floor(samples.length * 0.95)];
    };
    expect(Math.min(await batch(), await batch(), await batch())).toBeLessThan(1);
  });
});
