import * as fs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { parseAgentPathGate, resolveAgentPathGate } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { describe, expect, it, vi } from "vitest";
import { createPathGateHandler, type GatePrompter, type PathGateDeps } from "../handler.js";
import { defaultResolveEnv, type ResolveEnv } from "../resolve.js";
import { Suppression } from "../suppression.js";
import { createYoloLink } from "../yolo-link.js";

const env: ResolveEnv = {
  path: nodePath.posix,
  platform: "linux",
  homeDir: "/h",
  realpathSync: (p) => {
    if (["/", "/w", "/w/repo", "/w/other", "/w/other/docs", "/h", "/h/.ssh", "/etc"].includes(p)) return p;
    throw new Error("ENOENT");
  },
  exists: () => false,
  isDirectory: () => false,
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
  env?: ResolveEnv;
  roots?: string[];
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
    getRoots: async (grants) => ({ workspace: opts.roots ?? ["/w/repo"], readOnly: [], readWrite: [], grants }),
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
    env: opts.env ?? env,
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

describe("path-gate handler — symlink loop (X10, change: add-path-containment-guard-extension)", () => {
  it("X10 a symlink loop blocks as error with exactly one error log line", async () => {
    const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), "pg-loop-"));
    try {
      const real = fs.realpathSync(tmp);
      fs.mkdirSync(nodePath.join(real, "repo"));
      fs.symlinkSync("b", nodePath.join(real, "repo", "a"));
      fs.symlinkSync("a", nodePath.join(real, "repo", "b"));
      const h = harness({
        cwd: () => nodePath.join(real, "repo"),
        env: defaultResolveEnv(),
        roots: [nodePath.join(real, "repo")],
      });
      const r = await h.call("write", nodePath.join(real, "repo", "a"));
      expect(r).toMatchObject({ block: true });
      expect(r!.reason).toContain("error");
      expect(h.logs.filter((l) => l.startsWith("[path-gate] error"))).toHaveLength(1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

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

  it("review r6/B1: EVERY audit line is control-character free (grant-not-saved, error, outcome lines)", async () => {
    const evil = "/w/other/a\n[path-gate] allowed-always forged";
    // grant failure path
    const g = harness({
      answers: ["Always allow /w/other…"], confirms: [true],
      grant: async () => ({ ok: false, error: "cap\n[path-gate] allowed-always forged" }),
    });
    await g.call("read", evil);
    // internal error path (throwing cwd with a hostile message)
    const e = harness({ cwd: () => { throw new Error("boom\n[path-gate] allowed-always forged"); } });
    await e.call("read", evil);
    for (const line of [...g.logs, ...e.logs]) expect(line, line).not.toMatch(/[\u0000-\u001f\u007f\u2028\u2029]/);
    // no standalone forged record: the hostile text only ever appears INSIDE a genuine line
    expect([...g.logs, ...e.logs].filter((l) => l.startsWith("[path-gate] allowed-always forged"))).toHaveLength(0);
    expect(g.logs.some((l) => l.includes("grant-not-saved"))).toBe(true);
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
    // Non-opted prompt: no inline-Other key (test-plan #X3, add-ask-user-inline-other).
    expect(h.selects[0].metadata).not.toHaveProperty("allowOther");
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

describe("path-gate × YOLO (change: yolo-covers-agent-path-gate)", () => {
  type V = "auto-allow" | "refused" | "decline";
  function yolo(opts: Parameters<typeof harness>[0] = {}, verdict: V | "throw" = "auto-allow", supported = true) {
    const h = harness(opts);
    const asks: unknown[] = [];
    const reports: unknown[] = [];
    h.deps.yoloSupported = () => supported;
    h.deps.yoloDecide = async (r) => {
      asks.push(r);
      if (verdict === "throw") throw new Error("boom");
      return verdict;
    };
    h.deps.reportRefusal = (r) => void reports.push(r);
    return { ...h, asks, reports };
  }

  it("#E30 asks only when UI, unsuppressed, grantable, non-sensitive, supported and same store", async () => {
    const run = async (o: { hasUI?: boolean; sup?: boolean; store?: boolean; path?: string }) => {
      const h = yolo({ hasUI: o.hasUI, storeMatch: o.store, answers: ["Deny"] }, "decline", o.sup ?? true);
      await h.call("write", o.path ?? "/w/other/a.txt");
      return h.asks.length;
    };
    expect(await run({})).toBe(1);
    expect(await run({ hasUI: false })).toBe(0);
    expect(await run({ sup: false })).toBe(0);
    expect(await run({ store: false })).toBe(0);
    expect(await run({ path: "/h/.ssh/id" })).toBe(0); // sensitive
    expect(await run({ path: "/h/x.txt" })).toBe(0); // ungrantable subject
    const h = yolo({ answers: ["Deny", "Deny"] }, "decline");
    await h.call("read", "/w/other/a.txt"); // denied → suppressed
    await h.call("read", "/w/other/b.txt");
    // YOLO is now asked BEFORE the recent-denial short-circuit (#1115): the retry asks once
    // more, the decline leaves the suppression in force (no second prompt).
    expect(h.asks).toHaveLength(2);
    expect(h.selects).toHaveLength(1);
  });

  it("#E31 auto-allow proceeds without a prompt, logs and counts", async () => {
    const h = yolo();
    expect(await h.call("write", "/o/f.txt")).toBeUndefined();
    expect(h.selects).toHaveLength(0);
    expect(h.logs).toContain("[path-gate] yolo-allowed tool=write access=w path=/o/f.txt session=S1 sensitive=false");
    expect(h.counters).toMatchObject({ yoloAllowed: 1 });
  });

  it("#E32 refused blocks with yolo-refused", async () => {
    const h = yolo({}, "refused");
    const r = await h.call("read", "/w/other/a.txt");
    expect(r).toMatchObject({ block: true });
    expect(r!.reason.startsWith("path-gate: yolo-refused")).toBe(true);
    expect(h.selects).toHaveLength(0);
    expect(h.logs.some((l) => l.startsWith("[path-gate] yolo-refused"))).toBe(true);
    expect(h.counters.blocked).toBe(1);
  });

  it("#E33 decline falls through to the ordinary prompt", async () => {
    const h = yolo({ answers: ["Allow once"] }, "decline");
    await h.call("read", "/w/other/a.txt");
    expect(h.selects).toHaveLength(1);
    expect(h.selects[0].title).toMatch(/^Agent wants to read outside its workspace: /);
  });

  it("#E34/#E35 a select Deny or dismiss is reported with the select id and subject; nothing else is", async () => {
    const cases: Array<[string | undefined, boolean, boolean]> = [
      ["Deny", true, true],
      [undefined, true, true],
      ["Allow once", true, false],
      ["bogus", true, false],
      ["Deny", false, false], // store mismatch
    ];
    for (const [answer, store, reported] of cases) {
      const h = yolo({ answers: [answer], storeMatch: store }, "decline");
      await h.call("read", "/w/other/a.txt");
      expect(h.reports.length).toBe(reported ? 1 : 0);
      if (reported) {
        expect(h.reports[0]).toEqual({ promptId: h.selects[0].id, path: "/w/other/a.txt", subject: h.selects[0].metadata.subject });
        expect(h.selects[0].metadata.subject).toBe("/w/other");
      }
    }
  });

  it("#E36 disabled gate and in-root calls never ask", async () => {
    const off = yolo({ cfg: { enabled: false, timeoutSeconds: 120 } });
    await off.call("read", "/w/other/a.txt");
    const inRoot = yolo();
    await inRoot.call("read", "src/a.ts");
    expect(off.asks).toHaveLength(0);
    expect(inRoot.asks).toHaveLength(0);
  });

  it("#F1 an in-scope call is not queued behind an open out-of-scope prompt", async () => {
    const h = yolo({ answers: ["hang"] }, "decline");
    const first = h.call("read", "/w/other/a.txt");
    await tick();
    expect(h.selects).toHaveLength(1);
    h.deps.yoloDecide = async () => "auto-allow";
    expect(await h.call("write", "/w/other2/out.txt")).toBeUndefined();
    h.cancelled.length = 0;
    h.advance(120_000);
    await first;
  });

  it("#X3 a throwing yoloDecide falls through to the prompt, not the fail-closed catch", async () => {
    const h = yolo({ answers: ["Allow once"] }, "throw");
    expect(await h.call("read", "/w/other/a.txt")).toBeUndefined();
    expect(h.selects).toHaveLength(1);
  });

  it("#X7 a throwing reportRefusal still blocks as denied", async () => {
    const h = yolo({ answers: ["Deny"] }, "decline");
    h.deps.reportRefusal = () => {
      throw new Error("send failed");
    };
    const r = await h.call("read", "/w/other/a.txt");
    expect(r!.reason).toContain("denied");
  });

  it("#X1/#X2/#X6/#P2 the real link: 1500 ms budget, immediate decline when unsent or unsupported", async () => {
    vi.useFakeTimers();
    try {
      const mk = (send: (m: unknown) => boolean, features?: string[]) => {
        const h = harness({ answers: ["Allow once"] });
        const link = createYoloLink({ send, sessionId: () => "S1", newId: () => "r1" });
        if (features) link.handleIdentity({ features });
        h.deps.yoloSupported = () => link.supported();
        h.deps.yoloDecide = (r) => link.ask(r);
        return h;
      };
      // never answered: prompt appears at 1500 ms, not before
      const frames: unknown[] = [];
      const slow = mk((m) => (frames.push(m), true), ["path-yolo"]);
      const p = slow.call("read", "/w/other/a.txt");
      await vi.advanceTimersByTimeAsync(1499);
      expect(slow.selects).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      await p;
      expect(slow.selects).toHaveLength(1);
      expect(frames).toHaveLength(1);
      // send returns false: zero wait
      const unsent = mk(() => false, ["path-yolo"]);
      const p2 = unsent.call("read", "/w/other/a.txt");
      await vi.advanceTimersByTimeAsync(0);
      await p2;
      expect(unsent.selects).toHaveLength(1);
      // no features: no frames, zero wait
      const sent: unknown[] = [];
      const old = mk((m) => (sent.push(m), true));
      const p3 = old.call("read", "/w/other/a.txt");
      await vi.advanceTimersByTimeAsync(0);
      await p3;
      expect(old.selects).toHaveLength(1);
      expect(sent).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("#P1 in-root reads add no send and stay fast", async () => {
    const sent: unknown[] = [];
    const h = harness();
    const link = createYoloLink({ send: (m) => (sent.push(m), true), sessionId: () => "S1" });
    link.handleIdentity({ features: ["path-yolo"] });
    h.deps.yoloSupported = () => link.supported();
    h.deps.yoloDecide = (r) => link.ask(r);
    const times: number[] = [];
    for (let i = 0; i < 2000; i++) {
      const t0 = performance.now();
      await h.call("read", "src/a.ts");
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length * 0.95)]).toBeLessThan(1);
    expect(sent).toHaveLength(0);
  });
});

describe("path-gate × YOLO precedes recent-denial (#1115, change: harden-path-and-process-guards)", () => {
  type V = "auto-allow" | "refused" | "decline" | "throw" | "never";
  const ALWAYS = "Always allow /w/other/docs…";
  function dyn(opts: Parameters<typeof harness>[0] = {}) {
    const h = harness(opts);
    const state = { verdict: "decline" as V, supported: true };
    const asks: unknown[] = [];
    const reports: unknown[] = [];
    h.deps.yoloSupported = () => state.supported;
    h.deps.yoloDecide = (r) => {
      asks.push(r);
      if (state.verdict === "throw") return Promise.reject(new Error("link down"));
      if (state.verdict === "never") return new Promise(() => {});
      return Promise.resolve(state.verdict);
    };
    h.deps.reportRefusal = (r) => void reports.push(r);
    return { ...h, state, asks, reports };
  }
  const denied = (h: ReturnType<typeof dyn>, path = "/w/other/a.txt") => h.call("read", path);
  const timedOut = async (h: ReturnType<typeof dyn>, path = "/w/other/a.txt") => {
    const p = h.call("read", path);
    await tick();
    h.advance(120_000);
    return p;
  };
  const sup = (h: ReturnType<typeof dyn>) => (h.deps.suppression as unknown as { denied: Map<string, number> }).denied;

  it("#S12 a timeout is overridden by a live YOLO session within the window", async () => {
    const h = dyn({ answers: ["hang"] });
    expect((await timedOut(h))!.reason).toContain("timeout");
    h.advance(30_000);
    h.state.verdict = "auto-allow";
    expect(await h.call("write", "/w/other/b.txt")).toBeUndefined();
    expect(h.logs.some((l) => l.startsWith("[path-gate] yolo-allowed"))).toBe(true);
    expect(h.selects).toHaveLength(1);
    expect(h.asks).toHaveLength(2);
  });

  it("#S13 an explicit Deny the server remembered stays refused", async () => {
    const h = dyn({ answers: ["Deny"] });
    await denied(h);
    expect(h.reports).toHaveLength(1);
    h.advance(30_000);
    h.state.verdict = "refused";
    const r = await h.call("write", "/w/other/b.txt");
    expect(r!.reason).toContain("yolo-refused");
    expect(r!.reason).not.toContain("recently-denied");
    expect(r!.reason).toContain("Settings ▸ Access");
    expect(h.selects).toHaveLength(1);
  });

  it.each([
    ["Deny", ["Deny"]],
    ["timeout", ["hang"]],
  ])("#S14 a sensitive target keeps suppression and never asks YOLO (%s)", async (kind, answers) => {
    const h = dyn({ answers });
    h.state.verdict = "auto-allow";
    if (kind === "timeout") await timedOut(h, "/h/.ssh/x");
    else await denied(h, "/h/.ssh/x");
    h.advance(30_000);
    const r = await h.call("read", "/h/.ssh/y");
    expect(r!.reason).toContain("recently-denied");
    expect(h.asks).toHaveLength(0);
  });

  it.each([
    ["Deny", ["Deny"]],
    ["timeout", ["hang"]],
  ])("#S15 an ungrantable subject keeps suppression and never asks YOLO (%s)", async (kind, answers) => {
    const h = dyn({ answers });
    h.state.verdict = "auto-allow";
    if (kind === "timeout") await timedOut(h, "/h/notes.txt");
    else await denied(h, "/h/notes.txt");
    h.advance(30_000);
    const r = await h.call("read", "/h/other.txt");
    expect(r!.reason).toContain("recently-denied");
    expect(h.asks).toHaveLength(0);
  });

  it.each([["decline"], ["throw"]] as const)("#S16/#X8 a YOLO %s leaves suppression in force without a prompt", async (verdict) => {
    const h = dyn({ answers: ["Deny"] });
    await denied(h);
    h.advance(30_000);
    h.state.verdict = verdict;
    const r = await h.call("read", "/w/other/b.txt");
    expect(r!.reason).toContain("recently-denied");
    expect(r!.reason).not.toContain("path-gate: error");
    expect(h.selects).toHaveLength(1);
    expect(h.asks).toHaveLength(2);
  });

  it("#X8 a throwing YOLO with no suppression falls through to the ordinary prompt", async () => {
    const h = dyn({ answers: ["Allow once"] });
    h.state.verdict = "throw";
    expect(await denied(h)).toBeUndefined();
    expect(h.selects).toHaveLength(1);
  });

  it("#S17 no UI blocks as no-ui and never asks YOLO", async () => {
    const h = dyn({ hasUI: false });
    h.state.verdict = "auto-allow";
    const r = await denied(h);
    expect(r!.reason).toContain("no-ui");
    expect(h.asks).toHaveLength(0);
  });

  it.each([["unsupported"], ["store mismatch"], ["no decide fn"]])("#S18 no YOLO link (%s) keeps recently-denied, no ask", async (kind) => {
    const h = dyn({ answers: ["Deny"], storeMatch: kind !== "store mismatch" });
    if (kind === "unsupported") h.state.supported = false;
    if (kind === "no decide fn") h.deps.yoloDecide = undefined;
    await denied(h);
    h.advance(30_000);
    const r = await h.call("read", "/w/other/b.txt");
    expect(r!.reason).toContain("recently-denied");
    expect(h.asks).toHaveLength(0);
    expect(h.selects).toHaveLength(1);
  });

  it("#S19 window boundary: no YOLO → 120 s semantics unchanged; live YOLO overrides at every point", async () => {
    const none = dyn({ answers: ["Deny", "Allow once"] });
    none.state.supported = false;
    await denied(none);
    none.advance(119_999);
    expect((await none.call("read", "/w/other/b.txt"))!.reason).toContain("recently-denied");
    none.advance(2);
    expect(await none.call("read", "/w/other/b.txt")).toBeUndefined();
    expect(none.selects).toHaveLength(2);

    const live = dyn({ answers: ["Deny"] });
    await denied(live); // decline → Deny → suppressed
    const keys = [...sup(live).entries()];
    live.state.verdict = "auto-allow";
    for (const ms of [119_999, 1, 1]) {
      live.advance(ms);
      expect(await live.call("read", "/w/other/b.txt")).toBeUndefined();
    }
    expect([...sup(live).entries()].length).toBe(keys.length); // map not mutated by YOLO allows
    expect(live.selects).toHaveLength(1);
  });

  it("#S20 a declined always-allow confirmation leaves no refusal; a live YOLO session then allows", async () => {
    const h = dyn({ answers: [ALWAYS], confirms: [false] });
    const r = await h.call("read", "/w/other/docs/a.md");
    expect(r!.reason).toContain("denied");
    expect(h.reports).toHaveLength(0);
    h.advance(30_000);
    h.state.verdict = "auto-allow";
    expect(await h.call("read", "/w/other/docs/b.md")).toBeUndefined();
    expect(h.logs.some((l) => l.startsWith("[path-gate] yolo-allowed"))).toBe(true);
  });

  it("#S21 a Deny while the link is down is not reported; recently-denied until the link returns", async () => {
    const h = dyn({ answers: ["Deny"] });
    h.state.supported = false;
    await denied(h);
    expect(h.reports).toHaveLength(0);
    h.advance(10_000);
    expect((await h.call("read", "/w/other/b.txt"))!.reason).toContain("recently-denied");
    expect(h.asks).toHaveLength(0);
    h.state.supported = true;
    h.state.verdict = "auto-allow";
    h.advance(10_000);
    expect(await h.call("read", "/w/other/b.txt")).toBeUndefined();
  });

  it("#S22 an unrecognised answer is not reported; an explicit Deny is, exactly once", async () => {
    const unknown = dyn({ answers: ["bogus"] });
    expect((await denied(unknown))!.reason).toContain("denied");
    expect(unknown.reports).toHaveLength(0);
    unknown.advance(30_000);
    unknown.state.verdict = "auto-allow";
    expect(await unknown.call("read", "/w/other/b.txt")).toBeUndefined();

    const explicit = dyn({ answers: ["Deny"] });
    await denied(explicit);
    expect(explicit.reports).toEqual([{ promptId: explicit.selects[0].id, path: "/w/other/a.txt", subject: "/w/other" }]);
  });

  it("#S24 non-YOLO session: a queued sibling is refused by the in-mutex re-check, no second prompt", async () => {
    const h = harness({ answers: ["hang"] });
    const first = h.call("read", "/w/other/a.txt");
    await tick();
    const second = h.call("read", "/w/other/b.txt");
    await tick();
    h.advance(120_000);
    expect((await first)!.reason).toContain("timeout");
    expect((await second)!.reason).toContain("recently-denied");
    expect(h.selects).toHaveLength(1);
  });

  it("#X9 a throwing reportRefusal still blocks the Deny; a later live YOLO allows", async () => {
    const h = dyn({ answers: ["Deny"] });
    h.deps.reportRefusal = () => {
      throw new Error("lost");
    };
    expect((await denied(h))!.reason).toContain("denied");
    h.advance(30_000);
    h.state.verdict = "auto-allow";
    expect(await h.call("read", "/w/other/b.txt")).toBeUndefined();
  });

  it("#X11 an internal error before the reordered YOLO block fails closed", async () => {
    const h = dyn();
    h.state.verdict = "auto-allow";
    h.deps.getRoots = async () => {
      throw new Error("roots exploded");
    };
    const r = await denied(h);
    expect(r!.reason).toContain("error");
    expect(h.asks).toHaveLength(0);
  });

  it("#X12 a stale YOLO session (decline) never yields an allow; the window then lapses to a prompt", async () => {
    const h = dyn({ answers: ["Deny", "Allow once"] });
    await denied(h);
    h.advance(30_000);
    h.state.verdict = "decline"; // server-side YOLO session already ended
    expect((await h.call("read", "/w/other/b.txt"))!.reason).toContain("recently-denied");
    h.advance(120_000);
    expect(await h.call("read", "/w/other/b.txt")).toBeUndefined();
    expect(h.selects).toHaveLength(2);
  });

  it("#P1/#P3 suppressed retries: p95 < 1 ms (YOLO supported and not), non-YOLO makes no server round-trip", async () => {
    const measure = async (h: ReturnType<typeof dyn>) => {
      const times: number[] = [];
      for (let i = 0; i < 2000; i++) {
        const t0 = performance.now();
        await h.call("read", "/w/other/b.txt");
        times.push(performance.now() - t0);
      }
      times.sort((a, b) => a - b);
      return times[Math.floor(times.length * 0.95)];
    };
    const yoloH = dyn({ answers: ["Deny"] });
    await denied(yoloH);
    expect(await measure(yoloH)).toBeLessThan(1);
    const plain = dyn({ answers: ["Deny"] });
    plain.state.supported = false;
    await denied(plain);
    expect(await measure(plain)).toBeLessThan(1);
    expect(plain.asks).toHaveLength(0);
  });

  it("#P2 a silent server costs exactly the 1500 ms budget, then recently-denied (never a prompt)", async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      const link = createYoloLink({ send: () => true, sessionId: () => "S1", newId: () => "r1" });
      link.handleIdentity({ features: ["path-yolo"] });
      h.deps.yoloSupported = () => link.supported();
      h.deps.yoloDecide = (r) => link.ask(r);
      (h.deps.suppression as unknown as { deny(k: string): void }).deny("S1\u0000/w/other");
      let settled: { reason: string } | undefined;
      const p = h.call("read", "/w/other/a.txt").then((r) => {
        settled = r as never;
      });
      await vi.advanceTimersByTimeAsync(1499);
      expect(settled).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      await p;
      expect(settled!.reason).toContain("recently-denied");
      expect(h.selects).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
