import nodePath from "node:path";
import { parseAgentPathGate, resolveAgentPathGate } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { describe, expect, it, vi } from "vitest";
import { createPathGateHandler, type GatePrompter, type PathGateDeps } from "../handler.js";
import type { ResolveEnv } from "../resolve.js";
import { Suppression } from "../suppression.js";

const env: ResolveEnv = {
  path: nodePath.posix,
  platform: "linux",
  homeDir: "/h",
  realpathSync: (p) => {
    if (["/", "/w", "/w/repo", "/w/other", "/w/other/docs", "/h", "/h/.ssh", "/etc"].includes(p)) return p;
    throw new Error("ENOENT");
  },
};

type Answer = string | undefined | "hang";

function harness(opts: {
  answers?: Answer[];
  confirms?: Array<boolean | "hang">;
  cfg?: { enabled: boolean; timeoutSeconds: number };
  storeMatch?: boolean;
  grant?: PathGateDeps["requestGrant"];
  hasUI?: boolean;
  cwd?: () => string;
} = {}) {
  let t = 0;
  const timers: Array<{ at: number; fn: () => void; done: boolean }> = [];
  const advance = (ms: number) => {
    t += ms;
    for (const x of timers) if (!x.done && x.at <= t) { x.done = true; x.fn(); }
  };
  const answers = [...(opts.answers ?? [])];
  const confirms = [...(opts.confirms ?? [])];
  const cancelled: string[] = [];
  const pendingResolvers = new Map<string, (v: undefined | boolean) => void>();
  const selects: Array<{ id: string; title?: string; options: string[]; metadata: Record<string, unknown> }> = [];
  const confirmCalls: Array<{ id: string; metadata: Record<string, unknown> }> = [];
  const prompter: GatePrompter = {
    select: (a) => {
      selects.push(a);
      const next = answers.shift();
      if (next === "hang") return new Promise((res) => pendingResolvers.set(a.id, res as never));
      return Promise.resolve(next);
    },
    confirm: (a) => {
      confirmCalls.push(a);
      const next = confirms.shift();
      if (next === "hang") return new Promise((res) => pendingResolvers.set(a.id, res as never));
      return Promise.resolve(next === true);
    },
    cancel: (id) => {
      cancelled.push(id);
      pendingResolvers.get(id)?.(undefined);
    },
  };
  const logs: string[] = [];
  const notifications: string[] = [];
  const grantCalls: unknown[] = [];
  const counters = { inRoot: 0, asked: 0, blocked: 0 };
  let n = 0;
  const deps: PathGateDeps = {
    getConfig: () => opts.cfg ?? { enabled: true, timeoutSeconds: 120 },
    getRoots: async (grants) => ({ workspace: ["/w/repo"], readOnly: [], readWrite: [], grants }),
    getGrants: () => [],
    getSensitiveDirs: () => ["/h/.ssh", "/h/.pi"],
    isUngrantable: (s) => s === "/h" || s.startsWith("/h/.ssh"),
    prompter,
    grantStoreMatch: () => opts.storeMatch ?? true,
    requestGrant: opts.grant ?? (async (r) => { grantCalls.push(r); return { ok: true }; }),
    notify: (m) => notifications.push(m),
    log: (l) => logs.push(l),
    counters,
    sessionId: () => "S1",
    env,
    now: () => t,
    setTimer: (fn, ms) => { const x = { at: t + ms, fn, done: false }; timers.push(x); return x; },
    clearTimer: (h) => { (h as { done: boolean }).done = true; },
    newId: () => `p${++n}`,
    suppression: new Suppression(() => t),
  };
  const handler = createPathGateHandler(deps);
  const ctx = {
    hasUI: opts.hasUI ?? true,
    get cwd() { return opts.cwd ? opts.cwd() : "/w/repo"; },
  };
  const call = (toolName: string, path: string, extra: Record<string, unknown> = {}) =>
    handler({ toolName, toolCallId: "tc1", input: { path, ...extra } }, ctx as never);
  return { call, advance, selects, confirmCalls, cancelled, logs, notifications, grantCalls, counters, deps, tick: () => t };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("path-gate handler", () => {
  it("E10 non-gated tool returns undefined with no UI call", async () => {
    const h = harness();
    expect(await h.call("bash", "/w/other/x")).toBeUndefined();
    expect(h.selects).toHaveLength(0);
  });

  it("in-root read never prompts and counts", async () => {
    const h = harness();
    expect(await h.call("read", "src/a.ts")).toBeUndefined();
    expect(h.selects).toHaveLength(0);
    expect(h.counters.inRoot).toBe(1);
  });

  it("E20 allow once is single-call", async () => {
    const h = harness({ answers: ["Allow once", "Allow once"] });
    expect(await h.call("read", "/w/other/a.txt")).toBeUndefined();
    expect(await h.call("read", "/w/other/a.txt")).toBeUndefined();
    expect(h.selects).toHaveLength(2);
  });

  it("X1 deny blocks with reason denied and logs outcome", async () => {
    const h = harness({ answers: ["Deny"] });
    const r = await h.call("read", "/w/other/a.txt");
    expect(r).toMatchObject({ block: true });
    expect(r!.reason).toContain("denied");
    expect(h.logs.some((l) => l.includes("denied tool=read access=r path=/w/other/a.txt session=S1 sensitive=false"))).toBe(true);
  });

  it("X2 dismiss (undefined) blocks as denied", async () => {
    const h = harness({ answers: [undefined] });
    const r = await h.call("read", "/w/other/a.txt");
    expect(r!.reason).toContain("denied");
  });

  it("a path with control characters cannot forge a log line", async () => {
    const h = harness({ answers: ["Deny"] });
    await h.call("read", "/w/other/a\n[path-gate] allowed-always tool=read path=/etc/shadow");
    expect(h.logs.every((l) => !l.includes("\n"))).toBe(true);
    expect(h.logs.filter((l) => l.startsWith("[path-gate] allowed-always"))).toHaveLength(0);
  });

  it("E21 suppression window boundary", async () => {
    const h = harness({ answers: ["Deny", "Allow once"] });
    await h.call("read", "/w/other/a.txt");
    h.advance(119_000);
    const within = await h.call("read", "/w/other/b.txt");
    expect(within!.reason).toContain("recently-denied");
    expect(h.selects).toHaveLength(1);
    h.advance(2_000);
    expect(await h.call("read", "/w/other/b.txt")).toBeUndefined();
    expect(h.selects).toHaveLength(2);
  });

  it("E22 suppression is keyed on the lexical parent and scoped to the session", async () => {
    const h = harness({ answers: ["Deny", "Deny"] });
    await h.call("read", "/w/newproj1/a.txt");
    await h.call("write", "/w/newproj2/b.txt", { content: "x" });
    expect(h.selects).toHaveLength(2); // second dir not suppressed by the first
  });

  it("E23 suppression beats the sensitive flag", async () => {
    const h = harness({ answers: ["Deny"] });
    await h.call("read", "/h/.ssh/a");
    const r = await h.call("read", "/h/.ssh/b");
    expect(r!.reason).toContain("recently-denied");
    expect(h.selects).toHaveLength(1);
  });

  it("sensitive flag and note ride the card metadata; no Always allow offered", async () => {
    const h = harness({ answers: ["Allow once"] });
    await h.call("read", "/h/.ssh/id_rsa");
    expect(h.selects[0].metadata).toMatchObject({ kind: "agent-path-gate", sensitive: true, access: "read", toolCallId: "tc1" });
    expect(h.selects[0].options).toEqual(["Allow once", "Deny"]);
  });

  it("the prompt TITLE (all a TUI shows) names the path and flags a sensitive location (review B2)", async () => {
    const h = harness({ answers: ["Allow once", "Allow once"] });
    await h.call("read", "/h/.ssh/id_rsa");
    expect((h.selects[0] as { title?: string }).title).toMatch(/\/h\/\.ssh\/id_rsa.*sensitive/i);
    await h.call("write", "/w/other/plain.txt", { content: "x" });
    const t = (h.selects[1] as { title?: string }).title ?? "";
    expect(t).toContain("/w/other/plain.txt");
    expect(t).not.toMatch(/sensitive/i);
  });

  it("X3 timeout blocks, cancels the prompt once", async () => {
    const h = harness({ answers: ["hang"] });
    const p = h.call("read", "/w/other/a.txt");
    await tick();
    h.advance(120_000);
    const r = await p;
    expect(r!.reason).toContain("timeout");
    expect(h.cancelled).toEqual(["p1"]);
  });

  it("X4 shared budget: confirm gets only the remainder; no grant request", async () => {
    const h = harness({ answers: ["Always allow /w/other…"], confirms: ["hang"] });
    const p = h.call("read", "/w/other/a.txt");
    await tick();
    h.advance(100_000);
    await tick();
    expect(h.confirmCalls).toHaveLength(1);
    h.advance(20_000);
    const r = await p;
    expect(r!.reason).toContain("timeout");
    expect(h.cancelled).toContain("p2");
    expect(h.grantCalls).toHaveLength(0);
  });

  it("X5 no UI blocks without any prompt", async () => {
    const h = harness({ hasUI: false });
    const r = await h.call("read", "/w/other/a.txt");
    expect(r!.reason).toContain("no-ui");
    expect(h.selects).toHaveLength(0);
  });

  it("X6 internal error (throwing cwd) blocks with reason error", async () => {
    const h = harness({ cwd: () => { throw new Error("torn down"); } });
    const r = await h.call("read", "/w/other/a.txt");
    expect(r).toMatchObject({ block: true });
    expect(r!.reason).toContain("error");
  });

  it("Always allow + confirm → grant request carries promptId/path/subject, call runs", async () => {
    const h = harness({ answers: ["Always allow /w/other/docs…"], confirms: [true] });
    expect(await h.call("read", "/w/other/docs/a.md")).toBeUndefined();
    expect(h.confirmCalls[0].metadata).toMatchObject({ kind: "agent-path-gate-confirm", subject: "/w/other/docs", path: "/w/other/docs/a.md" });
    expect(h.grantCalls).toEqual([{ promptId: "p2", path: "/w/other/docs/a.md", subject: "/w/other/docs" }]);
  });

  it("confirm declined blocks as denied (no grant)", async () => {
    const h = harness({ answers: ["Always allow /w/other/docs…"], confirms: [false] });
    const r = await h.call("read", "/w/other/docs/a.md");
    expect(r!.reason).toContain("denied");
    expect(h.grantCalls).toHaveLength(0);
  });

  it("X7 grant write failure runs once with a 'not saved' note", async () => {
    const h = harness({
      answers: ["Always allow /w/other/docs…"], confirms: [true],
      grant: async () => ({ ok: false, error: "cap" }),
    });
    expect(await h.call("read", "/w/other/docs/a.md")).toBeUndefined();
    expect(h.notifications[0]).toContain("not saved: cap");
    expect(h.logs.some((l) => l.includes("allowed-always"))).toBe(true);
    expect(h.logs.some((l) => l.includes("grant-not-saved error=cap"))).toBe(true);
  });

  it("X8 migration: grant refused by another server runs once, not saved", async () => {
    const h = harness({
      answers: ["Always allow /w/other/docs…"], confirms: [true],
      grant: async () => ({ ok: false, error: "no pending confirm" }),
    });
    expect(await h.call("read", "/w/other/docs/a.md")).toBeUndefined();
  });

  it("grant request rejection also runs once, not saved", async () => {
    const h = harness({
      answers: ["Always allow /w/other/docs…"], confirms: [true],
      grant: async () => { throw new Error("socket closed"); },
    });
    expect(await h.call("read", "/w/other/docs/a.md")).toBeUndefined();
    expect(h.notifications[0]).toContain("socket closed");
  });

  it("no identity/store mismatch: Always allow not offered", async () => {
    const h = harness({ answers: ["Allow once"], storeMatch: false });
    await h.call("read", "/w/other/docs/a.md");
    expect(h.selects[0].options).toEqual(["Allow once", "Deny"]);
  });

  it("X9 per-session mutex: one prompt open at a time", async () => {
    const h = harness({ answers: ["hang", "Allow once"] });
    const p1 = h.call("read", "/w/other/a.txt");
    const p2 = h.call("read", "/w/second/b.txt");
    await tick();
    expect(h.selects).toHaveLength(1);
    // answer the first
    (h.deps.prompter as GatePrompter).cancel("p1"); // resolves hang → undefined → denied? use allow path instead
    await p1;
    await p2;
    expect(h.selects).toHaveLength(2);
  });

  it("E32 config decision table", async () => {
    const off = harness({ cfg: { enabled: false, timeoutSeconds: 120 } });
    expect(await off.call("read", "/w/other/a.txt")).toBeUndefined();
    expect(off.selects).toHaveLength(0);
    expect(resolveAgentPathGate(parseAgentPathGate({ enabled: true }), { PI_DASHBOARD_AGENT_PATH_GATE: "off" }).enabled).toBe(false);
    expect(resolveAgentPathGate(parseAgentPathGate({ enabled: false }), {}).enabled).toBe(false);
    expect(resolveAgentPathGate(parseAgentPathGate({ enabled: false }), { PI_DASHBOARD_AGENT_PATH_GATE: "on" }).enabled).toBe(true);
    expect(parseAgentPathGate("garbage")).toEqual({ enabled: true, timeoutSeconds: 120 });
    expect(parseAgentPathGate({ enabled: "yes", timeoutSeconds: -5 })).toEqual({ enabled: true, timeoutSeconds: 120 });
  });

  it("P2 disabled gate: p95 < 0.05 ms and no fs access", async () => {
    const h = harness({ cfg: { enabled: false, timeoutSeconds: 120 } });
    const getRoots = vi.spyOn(h.deps, "getRoots");
    const samples: number[] = [];
    for (let i = 0; i < 10_000; i++) {
      const s = performance.now();
      await h.call("read", "/w/other/a.txt");
      samples.push(performance.now() - s);
    }
    samples.sort((a, b) => a - b);
    expect(samples[Math.floor(samples.length * 0.95)]).toBeLessThan(0.05);
    expect(getRoots).not.toHaveBeenCalled();
  });

  it("P1 in-root p95 < 1 ms and P3 never touches the server", async () => {
    const h = harness();
    const grant = vi.fn(() => new Promise<never>(() => {}));
    (h.deps as { requestGrant: unknown }).requestGrant = grant;
    const samples: number[] = [];
    for (let i = 0; i < 10_000; i++) {
      const s = performance.now();
      expect(await h.call("read", "src/a.ts")).toBeUndefined();
      samples.push(performance.now() - s);
    }
    samples.sort((a, b) => a - b);
    expect(samples[Math.floor(samples.length * 0.95)]).toBeLessThan(1);
    expect(grant).not.toHaveBeenCalled();
  });
});
