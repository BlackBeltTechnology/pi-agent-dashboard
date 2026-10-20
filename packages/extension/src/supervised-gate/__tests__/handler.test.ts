/**
 * Supervised gate handler — L1 (change: add-supervised-tool-approval).
 * Test-plan: E7 E9 E11 E15 E16 E17 E22a E23 E24 E29 E38 E40 X1 X2 X3 X5 X13 X15 X16 X17 X20 X25 P1 P2
 * (X18/X19 → chain.test.ts, X4/E12 → bridge-wiring.test.ts, E44 → summary.test.ts, E41 → copy-scan.test.ts,
 * X10/X11/spikes → pi-runtime-spikes.test.ts).
 */
import { clearToolGateOwner, markToolGateOwner, toolGateOwner } from "@blackbelt-technology/pi-dashboard-shared/tool-gate/owner.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectiveDeadlineMs, sanitizeOperatorText } from "../handler.js";
import { flush, makeGate } from "./harness.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("per-call mode + classification", () => {
  it("#E11 Full access is inert: undefined, no request, no decision entry", async () => {
    const h = makeGate({ mode: false });
    expect(await h.call("bash")).toBeUndefined();
    expect(h.prompter.reqs).toHaveLength(0);
    expect(h.records).toHaveLength(0);
  });

  it("the mode is read per call (a flip applies to the next call in the same turn)", async () => {
    let on = false;
    const h = makeGate({ mode: () => on });
    expect(await h.call("bash")).toBeUndefined();
    on = true;
    const p = h.call("bash");
    await flush();
    expect(h.prompter.reqs).toHaveLength(1);
    h.prompter.answer("Allow once");
    expect(await p).toBeUndefined();
  });

  it("#E7 the configured set is authoritative: a configured `read` raises a prompt", async () => {
    const h = makeGate({ cfg: { tools: ["read"] } });
    const p = h.call("read", { path: "/w/repo/a.txt" });
    await flush();
    expect(h.prompter.reqs).toHaveLength(1);
    h.prompter.answer("Deny");
    expect((await p)?.block).toBe(true);
  });

  it("default set gates exec/mutation; read family runs without a prompt", async () => {
    const h = makeGate();
    for (const t of ["read", "grep", "find", "ls"]) expect(await h.call(t, { path: "x" })).toBeUndefined();
    expect(h.prompter.reqs).toHaveLength(0);
    // case-insensitive: the lowercase `agent` matches the configured `Agent`
    const p = h.call("agent", { subagent_type: "x", prompt: "t" });
    await flush();
    expect(h.prompter.reqs).toHaveLength(1);
    h.prompter.answer("Deny");
    await p;
  });

  it("#E24 a custom set extending the default gates the added tool, not logged unclassified", async () => {
    const h = makeGate({ cfg: { tools: ["bash", "powershell", "write", "edit", "Agent", "ctx_execute"] } });
    const p = h.call("ctx_execute", { code: "1" });
    await flush();
    expect(h.prompter.reqs).toHaveLength(1);
    h.prompter.answer("Allow once");
    await p;
    expect(h.logs.some((l) => l.includes("unclassified"))).toBe(false);
  });

  it("#E23 unclassified tool runs, logged exactly once per session; annotations ignored", async () => {
    const a = makeGate({ sid: "A" });
    await a.call("ctx_execute");
    await a.call("ctx_execute");
    await a.call("x_tool", { annotations: { destructiveHint: true } });
    expect(a.prompter.reqs).toHaveLength(0);
    expect(a.logs.filter((l) => l === "[supervised] unclassified tool ctx_execute")).toHaveLength(1);
    expect(a.logs.filter((l) => l === "[supervised] unclassified tool x_tool")).toHaveLength(1);
    // another session of the same gate logs once more
    let sid = "A";
    const h = makeGate({ sid: () => sid });
    await h.call("ctx_execute");
    sid = "B";
    await h.call("ctx_execute");
    await h.call("ctx_execute");
    expect(h.logs.filter((l) => l === "[supervised] unclassified tool ctx_execute")).toHaveLength(2);
    // a `bash` call carrying a readOnlyHint annotation still prompts
    const p = h.call("bash", { command: "ls", annotations: { readOnlyHint: true } });
    await flush();
    expect(h.prompter.reqs).toHaveLength(1);
    h.prompter.answer("Deny");
    await p;
  });

  it("wrapper tools and read family are classified (never logged)", async () => {
    const h = makeGate();
    for (const t of ["codemode", "tool_search", "read", "grep"]) await h.call(t);
    expect(h.logs.filter((l) => l.includes("unclassified"))).toHaveLength(0);
  });
});

describe("owner self-disable (#E29, #X24)", () => {
  it("#E29 owner chat-gateway ⇒ undefined and no request; env alone never disables", async () => {
    const h = makeGate({ owner: () => "chat-gateway" });
    expect(await h.call("bash")).toBeUndefined();
    expect(h.prompter.reqs).toHaveLength(0);

    process.env.PI_EXT_CHAT_GATEWAY_GUARD_POLICY = JSON.stringify({ approval: ["bash"] });
    try {
      const e = makeGate({ owner: () => undefined });
      const p = e.call("bash");
      await flush();
      expect(e.prompter.reqs).toHaveLength(1); // env is never sniffed
      e.prompter.answer("Deny");
      await p;
    } finally {
      delete process.env.PI_EXT_CHAT_GATEWAY_GUARD_POLICY;
    }
  });

  it("reads the real shared owner slot by default (cleared slot ⇒ prompts, marked ⇒ inert)", async () => {
    const h = makeGate({ sid: "owner-test" });
    // the harness injects getOwner; exercise the default via a fresh gate without the override
    const { createSupervisedGate } = await import("../handler.js");
    const gate = createSupervisedGate({ ...h.deps, getOwner: undefined });
    markToolGateOwner("owner-test", "chat-gateway");
    try {
      expect(toolGateOwner("owner-test")).toBe("chat-gateway");
      expect(await gate.handler({ toolName: "bash", toolCallId: "t", input: {} }, h.ctx())).toBeUndefined();
    } finally {
      clearToolGateOwner("owner-test");
    }
  });
});

describe("no UI / error / approval mapping", () => {
  it("#X13 no UI blocks at once with supervised: no-ui (0 ms timer advance, no request)", async () => {
    const h = makeGate();
    const r = await h.call("bash", { command: "ls" }, "tc", { hasUI: false });
    expect(r).toEqual({ block: true, reason: "supervised: no-ui" });
    expect(h.prompter.reqs).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("#X25 approved: undefined returned and event.input untouched", async () => {
    const h = makeGate();
    const input = { command: "echo hi" };
    const frozen = JSON.stringify(input);
    const p = h.gate.handler({ toolName: "bash", toolCallId: "t", input }, h.ctx());
    await flush();
    h.prompter.answer("Allow once");
    expect(await p).toBeUndefined();
    expect(JSON.stringify(input)).toBe(frozen);
    expect(h.records.map((r) => r.outcome)).toEqual(["approved"]);
  });

  it("#E16 answer mapping: only exact `Allow once` runs the tool", async () => {
    const cases: Array<[string, boolean, string | null]> = [
      ["Allow once", false, null],
      ["Deny", true, "supervised: denied"],
      ["allow once", true, 'supervised: denied — operator said: "allow once"'],
      ["", true, "supervised: denied"],
      ["run it in /tmp", true, 'supervised: denied — operator said: "run it in /tmp"'],
    ];
    for (const [answer, blocked, reason] of cases) {
      const h = makeGate();
      const p = h.call("bash");
      await flush();
      h.prompter.answer(answer);
      const r = await p;
      expect(!!r, answer).toBe(blocked);
      if (reason) expect(r?.reason, answer).toBe(reason);
    }
  });

  it("#E17 reason hygiene: control chars stripped; 499/500 intact, 501 → 500", async () => {
    const run = async (text: string) => {
      const h = makeGate();
      const p = h.call("bash");
      await flush();
      h.prompter.answer(text);
      return (await p)!.reason;
    };
    const r = await run("\x1b[31mno\x07pe\r\n");
    expect(r).toBe('supervised: denied — operator said: "[31mnope"');
    expect(r).not.toMatch(/[\u0000-\u001f\u007f]/);
    const prefix = 'supervised: denied — operator said: "';
    for (const [len, expected] of [[499, 499], [500, 500], [501, 500]] as const) {
      const out = await run("x".repeat(len));
      expect(out.slice(prefix.length, -1)).toHaveLength(expected);
    }
    expect(sanitizeOperatorText("\x07\x00")).toBe("");
    // a control-only answer carries no operator text
    expect(await run("\x07")).toBe("supervised: denied");
  });

  it("#X5 outcomes are distinguishable: denied / dismissed / timeout / error / aborted", async () => {
    const reasons: Record<string, string> = {};
    const outcomes: string[] = [];
    // denied
    let h = makeGate();
    let p = h.call("bash");
    await flush();
    h.prompter.answer("Deny");
    reasons.denied = (await p)!.reason;
    outcomes.push(...h.records.map((r) => r.outcome));
    // dismissed (client cancel the gate did not initiate)
    h = makeGate();
    p = h.call("bash");
    await flush();
    h.prompter.dismiss();
    reasons.dismissed = (await p)!.reason;
    outcomes.push(...h.records.map((r) => r.outcome));
    // timeout
    h = makeGate();
    p = h.call("bash");
    await flush();
    await vi.advanceTimersByTimeAsync(120_000);
    reasons.timeout = (await p)!.reason;
    outcomes.push(...h.records.map((r) => r.outcome));
    // error (sync throw from the transport)
    h = makeGate();
    h.deps.prompter.request = () => {
      throw new Error("boom");
    };
    const { createSupervisedGate } = await import("../handler.js");
    p = createSupervisedGate(h.deps).handler({ toolName: "bash", toolCallId: "t", input: {} }, h.ctx()) as never;
    reasons.error = (await p)!.reason;
    // aborted
    h = makeGate();
    const ac = new AbortController();
    p = h.call("bash", {}, "t", { signal: ac.signal });
    await flush();
    ac.abort();
    reasons.aborted = (await p)!.reason;
    outcomes.push(...h.records.map((r) => r.outcome));
    expect(reasons).toEqual({
      denied: "supervised: denied",
      dismissed: "supervised: dismissed",
      timeout: "supervised: timeout",
      error: "supervised: error",
      aborted: "supervised: aborted",
    });
    expect(outcomes).toEqual(["denied", "dismissed", "timeout", "aborted"]);
  });

  it("#X1 unanswered approval fails closed: timeout, cancel(id) once, tool blocked", async () => {
    const h = makeGate();
    const p = h.call("bash");
    await flush();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await p).toEqual({ block: true, reason: "supervised: timeout" });
    expect(h.prompter.cancel).toHaveBeenCalledTimes(1);
    expect(h.prompter.cancel).toHaveBeenCalledWith(h.prompter.reqs[0].id);
    expect(h.records[0]).toMatchObject({ outcome: "timeout", answeredSurface: "timeout" });
  });

  it("#X2 sync throw fails closed (block, reason supervised: error)", async () => {
    const h = makeGate();
    h.deps.prompter.request = () => {
      throw new Error("sync");
    };
    const { createSupervisedGate } = await import("../handler.js");
    const r = await createSupervisedGate(h.deps).handler({ toolName: "bash", toolCallId: "t", input: {} }, h.ctx());
    expect(r).toEqual({ block: true, reason: "supervised: error" });
  });

  it("#X3 rejected decision fails closed", async () => {
    const h = makeGate();
    h.deps.prompter.request = () => Promise.reject(new Error("rejected"));
    const { createSupervisedGate } = await import("../handler.js");
    const r = await createSupervisedGate(h.deps).handler({ toolName: "bash", toolCallId: "t", input: {} }, h.ctx());
    expect(r).toEqual({ block: true, reason: "supervised: error" });
  });

  it("whole handler fails closed: a throwing getConfig blocks with supervised: error", async () => {
    const h = makeGate();
    h.deps.getConfig = () => {
      throw new Error("cfg");
    };
    const { createSupervisedGate } = await import("../handler.js");
    const r = await createSupervisedGate(h.deps).handler({ toolName: "bash", toolCallId: "t", input: {} }, h.ctx());
    expect(r).toEqual({ block: true, reason: "supervised: error" });
  });

  it("the prompt is a select with Allow once / Deny, allowOther and the supervised metadata", async () => {
    const h = makeGate();
    const p = h.call("bash", { command: "rm -rf build" }, "tc9");
    await flush();
    const req = h.prompter.reqs[0];
    expect(req.options).toEqual(["Allow once", "Deny"]);
    expect(req.question).toBe("Run this command?");
    expect(req.metadata).toMatchObject({
      kind: "supervised-tool-approval",
      tool: "bash",
      command: "rm -rf build",
      cwd: "/w/repo",
      toolCallId: "tc9",
      allowOther: true,
    });
    expect(typeof req.metadata.deadline).toBe("number");
    expect(String(req.metadata.plainMessage)).toContain("rm -rf build");
    expect(String(req.metadata.message)).toContain("rm -rf build");
    h.prompter.answer("Deny");
    await p;
  });
});

describe("single clock (#E9, #E15)", () => {
  it("#E9 boundary: 119.9 s honoured; 120.0 s and 120.1 s block as timeout, cancel once", async () => {
    for (const [ms, honoured] of [[119_900, true], [120_000, false], [120_100, false]] as const) {
      const h = makeGate({ busMs: 300_000 });
      const p = h.call("bash");
      await flush();
      await vi.advanceTimersByTimeAsync(ms);
      h.prompter.answer("Allow once");
      const r = await p;
      if (honoured) {
        expect(r, String(ms)).toBeUndefined();
        expect(h.prompter.cancel).not.toHaveBeenCalled();
      } else {
        expect(r, String(ms)).toEqual({ block: true, reason: "supervised: timeout" });
        expect(h.prompter.cancel).toHaveBeenCalledTimes(1);
        expect(h.records[0].outcome).toBe("timeout");
      }
    }
  });

  it("#E15 effective deadline = max(1, min(cfg, bus−1)) and the gate timer precedes the bus backstop", async () => {
    const rows: Array<[number, number, number]> = [
      [120, 300, 120],
      [120, 60, 59],
      [10, 11, 10],
      [10, 10, 9],
      [120, 2, 1],
      [120, 1, 1],
      [120, 0, 120],
      [120, -1, 120],
    ];
    for (const [cfgS, busS, expected] of rows) {
      const h = makeGate({ cfg: { timeoutSeconds: cfgS }, busMs: busS * 1000 });
      const openedAt = Date.now();
      const p = h.call("bash");
      await flush();
      const deadline = h.prompter.reqs[0].metadata.deadline as number;
      expect((deadline - openedAt) / 1000, `${cfgS}/${busS}`).toBe(expected);
      expect(effectiveDeadlineMs(cfgS, busS * 1000) / 1000).toBe(expected);
      if (busS > 1) expect(expected * 1000).toBeLessThan(busS * 1000); // gate timer fires before the bus backstop
      h.prompter.answer("Deny");
      await p;
    }
  });

  it("an out-of-range configured timeout resolves to 120 s even if config is mis-injected", () => {
    expect(effectiveDeadlineMs(5, 300_000)).toBe(120_000);
    expect(effectiveDeadlineMs("abc", undefined)).toBe(120_000);
    expect(effectiveDeadlineMs(3601, undefined)).toBe(120_000);
  });
});

describe("per-session mutex (#E38) and abort (#X15 #X16 #X17)", () => {
  it("#E38 session A's second call waits for the first; B is never queued; deadline starts at own open", async () => {
    let sid = "A";
    const h = makeGate({ sid: () => sid });
    const a1 = h.call("bash", { command: "one" }, "a1");
    const a2 = h.call("bash", { command: "two" }, "a2");
    sid = "B";
    const b1 = h.call("bash", { command: "three" }, "b1");
    await flush();
    expect(h.prompter.reqs.map((r) => (r.metadata as { command: string }).command)).toEqual(["one", "three"]);
    await vi.advanceTimersByTimeAsync(50_000);
    h.prompter.answer("Allow once", "dashboard-default", 0); // a1
    await flush();
    expect(h.prompter.reqs).toHaveLength(3);
    const a2req = h.prompter.reqs[2];
    expect((a2req.metadata as { command: string }).command).toBe("two");
    // a2's deadline was computed at its own open (≈ now + 120 s), not at dispatch
    expect((a2req.metadata.deadline as number) - Date.now()).toBe(120_000);
    h.prompter.answer("Allow once", "dashboard-default", 2);
    h.prompter.answer("Allow once", "dashboard-default", 1);
    expect(await Promise.all([a1, a2, b1])).toEqual([undefined, undefined, undefined]);
  });

  it("#X15 abort while queued: A2 blocked aborted, request never called, A1 untouched", async () => {
    const h = makeGate();
    const a1 = h.call("bash", { command: "one" }, "a1");
    const ac = new AbortController();
    const a2 = h.call("bash", { command: "two" }, "a2", { signal: ac.signal });
    await flush();
    expect(h.prompter.reqs).toHaveLength(1);
    ac.abort();
    expect(await a2).toEqual({ block: true, reason: "supervised: aborted" });
    expect(h.prompter.reqs).toHaveLength(1);
    expect(h.prompter.isPending(0)).toBe(true);
    expect(h.prompter.cancel).not.toHaveBeenCalled();
    h.prompter.answer("Allow once");
    expect(await a1).toBeUndefined();
    // the queue still works after the abandoned waiter
    const a3 = h.call("bash", { command: "three" }, "a3");
    await flush();
    expect(h.prompter.reqs).toHaveLength(2);
    h.prompter.answer("Allow once");
    expect(await a3).toBeUndefined();
  });

  it("#X15b a call that was aborted while queued never opens a card even after the first resolves", async () => {
    const h = makeGate();
    const a1 = h.call("bash", {}, "a1");
    const ac = new AbortController();
    const a2 = h.call("bash", {}, "a2", { signal: ac.signal });
    await flush();
    ac.abort();
    h.prompter.answer("Allow once");
    await a1;
    await a2;
    await flush();
    expect(h.prompter.reqs).toHaveLength(1);
  });

  it("#X16 abort with the prompt open: cancel(id), outcome aborted, mutex released", async () => {
    const h = makeGate();
    const ac = new AbortController();
    const a1 = h.call("bash", {}, "a1", { signal: ac.signal });
    await flush();
    ac.abort();
    expect(await a1).toEqual({ block: true, reason: "supervised: aborted" });
    expect(h.prompter.cancel).toHaveBeenCalledTimes(1);
    expect(h.prompter.cancel).toHaveBeenCalledWith(h.prompter.reqs[0].id);
    expect(h.records[0].outcome).toBe("aborted");
    const next = h.call("bash", {}, "a2");
    await flush();
    expect(h.prompter.reqs).toHaveLength(2); // the next call opens
    h.prompter.answer("Allow once");
    await next;
  });

  it("#X17 signal already aborted at entry: blocked aborted, no prompt", async () => {
    const h = makeGate();
    const ac = new AbortController();
    ac.abort();
    expect(await h.call("bash", {}, "a1", { signal: ac.signal })).toEqual({ block: true, reason: "supervised: aborted" });
    expect(h.prompter.reqs).toHaveLength(0);
  });
});

describe("decision record (#E40) and hand-off hook", () => {
  it("#E40 600-char command with a vault secret: entry ≤500 chars, secret absent, console line control-free", async () => {
    const secret = "S3CR3T-VAULT-VALUE";
    const command = `echo ${secret} ${"x".repeat(600)}`;
    const redact = (s: string) => s.split(secret).join("[REDACTED:VAULT]");
    const h = makeGate({ redact });
    const p = h.call("bash", { command });
    await flush();
    h.prompter.answer("Allow once", "dashboard-default");
    await p;
    expect(h.records).toHaveLength(1);
    const rec = h.records[0];
    expect(rec).toMatchObject({ sessionId: "S1", tool: "bash", outcome: "approved", answeredSurface: "dashboard", via: "supervised" });
    expect(rec.summary.length).toBeLessThanOrEqual(500);
    expect(rec.summary).not.toContain(secret);
    expect(rec.summary).toContain("[REDACTED:VAULT]");
    const line = h.logs.find((l) => l.startsWith("[supervised] approved"));
    expect(line).toBeTruthy();
    expect(line).not.toMatch(/[\u0000-\u001f\u007f]/);
    // the operator-visible prompt is masked too
    expect(JSON.stringify(h.prompter.reqs[0].metadata)).not.toContain(secret);
  });

  it("a control-character command cannot forge a console line", async () => {
    const h = makeGate();
    const p = h.call("bash", { command: "ls\n[supervised] approved tool=rm via=forged" });
    await flush();
    h.prompter.answer("Allow once");
    await p;
    expect(h.logs.filter((l) => l.includes("\n"))).toHaveLength(0);
  });

  it("answeredSurface: tui source → tui", async () => {
    const h = makeGate();
    const p = h.call("bash");
    await flush();
    h.prompter.answer("Allow once", "tui");
    await p;
    expect(h.records[0].answeredSurface).toBe("tui");
  });

  it("B2: answeredSurface stays in the D11 vocabulary — a bus dismiss is `dashboard`, a hand-off allow is not `path-gate`", async () => {
    const allowed = new Set(["dashboard", "tui", "chat-gateway", "timeout", "aborted", "error"]);
    let h = makeGate();
    let p = h.call("bash");
    await flush();
    h.prompter.dismiss();
    await p;
    expect(h.records[0].answeredSurface).toBe("dashboard");
    const ids = new Set(["t1"]);
    h = makeGate({ handoff: (_s, id) => ids.delete(id) });
    await h.call("edit", { path: "/w/o/f.txt", edits: [] }, "t1");
    expect(h.records[0]).toMatchObject({ via: "path-gate" });
    expect(allowed.has(h.records[0].answeredSurface)).toBe(true);
    expect(h.records[0].answeredSurface).not.toBe("path-gate");
  });

  it("a consumed hand-off allows without asking and logs via path-gate; ids are one-shot", async () => {
    const ids = new Set(["t1"]);
    const h = makeGate({ handoff: (_s, id) => ids.delete(id) });
    expect(await h.call("edit", { path: "/w/o/f.txt", edits: [] }, "t1")).toBeUndefined();
    expect(h.prompter.reqs).toHaveLength(0);
    expect(h.records).toMatchObject([{ tool: "edit", outcome: "approved", via: "path-gate" }]);
    const p = h.call("edit", { path: "/w/o/f.txt", edits: [] }, "t1"); // second call, same id → prompts
    await flush();
    expect(h.prompter.reqs).toHaveLength(1);
    h.prompter.answer("Deny");
    await p;
  });

  it("#E22a no toolCallId never consults the hand-off (a supervised prompt, never zero)", async () => {
    const consume = vi.fn(() => true);
    const h = makeGate({ handoff: consume });
    const p = h.gate.handler({ toolName: "edit", input: { path: "/x", edits: [] } }, h.ctx());
    await flush();
    expect(consume).not.toHaveBeenCalled();
    expect(h.prompter.reqs).toHaveLength(1);
    h.prompter.answer("Deny");
    await p;
  });
});

describe("session state (#X20)", () => {
  it("clearSession drops the mutex chain and the unclassified-log set of that session only", async () => {
    let sid = "s1";
    const h = makeGate({ sid: () => sid });
    await h.call("ctx_execute");
    const p = h.call("bash");
    await flush();
    sid = "s2";
    await h.call("ctx_execute");
    expect(h.gate.hasSessionState("s1")).toEqual({ chain: true, unclassified: true });
    h.gate.clearSession("s1");
    expect(h.gate.hasSessionState("s1")).toEqual({ chain: false, unclassified: false });
    expect(h.gate.hasSessionState("s2").unclassified).toBe(true);
    h.prompter.answer("Deny");
    await p;
  });
});

describe("performance (#P1 #P2)", () => {
  const p95 = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length * 0.95)];

  async function measure(mode: boolean, tool: string) {
    vi.useRealTimers();
    const sessions: Record<string, string> = {};
    for (let i = 0; i < 100; i++) sessions[`other${i}`] = "chat-gateway";
    const h = makeGate({ mode, owner: (sid) => sessions[sid] });
    const handler = h.gate.handler;
    const ctx = h.ctx();
    const event = { toolName: tool, toolCallId: "t", input: { path: "x" } };
    // baseline: an empty async handler
    const baseline: number[] = [];
    const noop = async () => undefined;
    const timed: number[] = [];
    for (let i = 0; i < 10_000; i++) {
      let t0 = performance.now();
      await noop();
      baseline.push(performance.now() - t0);
      t0 = performance.now();
      await handler(event, ctx);
      timed.push(performance.now() - t0);
    }
    return p95(timed) - p95(baseline);
  }

  it("#P1 10 000 bash dispatches, mode false, owner slot populated: p95 added latency < 1 ms", async () => {
    expect(await measure(false, "bash")).toBeLessThan(1);
  }, 30_000);

  it("#P2 10 000 read calls, mode true (allow path): p95 added latency < 1 ms", async () => {
    expect(await measure(true, "read")).toBeLessThan(1);
  }, 30_000);
});
