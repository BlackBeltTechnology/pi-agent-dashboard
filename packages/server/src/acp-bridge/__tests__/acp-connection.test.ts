/**
 * JSON-RPC peer / hostile-input boundary. See change: add-acp-session-driver
 * (test-plan #E23, #E24, #E25, #E28, #P4).
 */
import { PassThrough } from "node:stream";
import { DEFAULT_ACP_SETTINGS } from "@blackbelt-technology/pi-dashboard-shared/acp/acp-config.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAcpConnection, LineSplitter } from "../acp-connection.js";
import { makeHarness, startReady } from "./adapter-harness.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("version negotiation (E23)", () => {
  const cases: Array<[boolean, number, "ok" | "fail"]> = [
    [false, 1, "ok"],
    [false, 2, "fail"],
    [false, 3, "fail"],
    [true, 1, "ok"],
    [true, 2, "ok"],
    [true, 3, "fail"],
  ];
  for (const [flag, answer, expected] of cases) {
    it(`flag ${flag ? "on" : "off"}, agent answers ${answer} → ${expected}`, async () => {
      const h = makeHarness({ protocol: answer === 2 ? 2 : 1, settings: { protocolV2: flag }, knobs: { initializeVersion: answer } });
      await h.adapter.start();
      if (expected === "ok") {
        expect(h.exits).toEqual([]);
        expect(h.logs.join("\n")).toContain(`protocol=v${answer}`);
        const init = h.received().find((m) => m.method === "initialize")!;
        expect(init.params.protocolVersion).toBe(flag ? 2 : 1);
        expect(init.params.clientCapabilities).toEqual({ fs: { readTextFile: false, writeTextFile: false }, terminal: false });
        await h.adapter.stop();
      } else {
        expect(h.exits).toEqual([1]);
        const end = h.events().find((e) => e.eventType === "agent_end")!;
        expect(JSON.stringify(end.data)).toContain("unsupported ACP protocol version");
      }
    });
  }
});

describe("refused client methods (E24)", () => {
  it("fs/*, terminal/*, _x/y get -32601; notifications get no reply", async () => {
    const h = makeHarness({ protocol: 1, knobs: { requestFs: true } });
    await startReady(h);
    h.prompt("x");
    await h.waitFor(() => h.eventTypes().includes("agent_settled"));
    const replies = h.received().filter((m) => m.error?.code === -32601);
    expect(replies).toHaveLength(3);
    // nothing answered the notification `_x/n`: replies carry only the 3 request ids
    expect(h.received().filter((m) => m.method === undefined && m.id !== undefined && m.error)).toHaveLength(3);
  });
});

describe("LineSplitter (E25)", () => {
  it("delivers ≤cap, discards cap+1, resumes at the next line; memory stays bounded", () => {
    const cap = 65536;
    const s = new LineSplitter(cap);
    const mk = (n: number) => Buffer.from(`${"a".repeat(n)}\n`);
    const lines = [...s.push(mk(cap - 1)), ...s.push(mk(cap)), ...s.push(mk(cap + 1)), ...s.push(Buffer.from('{"ok":1}\n'))];
    expect(lines.map((l) => l.length)).toEqual([cap - 1, cap, 8]);
    expect(s.discarded).toBe(1);
  });

  it("discards an over-long line spread over many chunks", () => {
    const s = new LineSplitter(1024);
    const out: string[] = [];
    for (let i = 0; i < 100; i++) out.push(...s.push(Buffer.alloc(100, 0x61)));
    out.push(...s.push(Buffer.from("\nnext\n")));
    expect(out).toEqual(["next"]);
    expect(s.discarded).toBe(1);
  });

  it("splits lines across chunk boundaries", () => {
    const s = new LineSplitter(100);
    expect(s.push(Buffer.from("ab"))).toEqual([]);
    expect(s.push(Buffer.from("c\nde"))).toEqual(["abc"]);
    expect(s.push(Buffer.from("f\n"))).toEqual(["def"]);
  });

  it("connection skips non-JSON and counts it; later requests still resolve", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const c = createAcpConnection({ input, output, maxLineBytes: 65536, requestTimeoutMs: 1000 });
    input.write("starting up...\n");
    input.write(`${"x".repeat(70000)}\n`);
    const p = c.request("m", {});
    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } })}\n`);
    await expect(p).resolves.toEqual({ ok: true });
    expect(c.counters()).toEqual({ skippedLines: 1, discardedLines: 1 });
  });

  it("rejects pending requests when closed", async () => {
    const c = createAcpConnection({ input: new PassThrough(), output: new PassThrough(), maxLineBytes: 1000, requestTimeoutMs: 5000 });
    const p = c.request("m", {});
    c.close(new Error("gone"));
    await expect(p).rejects.toThrow("gone");
  });
});

describe("hostile ACP session id (E28)", () => {
  it("the agent's session id is never used as a path or dashboard id", async () => {
    const h = makeHarness({ protocol: 1, knobs: { hostileSessionId: true } });
    await startReady(h);
    h.prompt("hi");
    await h.waitFor(() => h.eventTypes().includes("agent_settled"));
    const prompt = h.received().find((m) => m.method === "session/prompt")!;
    expect(prompt.params.sessionId).toBe("../../../etc/x"); // opaque, only echoed back to the agent
    expect(JSON.stringify(h.sent.filter((m) => m.type === "session_register"))).not.toContain("etc/x");
    expect(h.sent.every((m) => (m as { sessionId?: string }).sessionId === undefined || (m as { sessionId: string }).sessionId === "11111111-2222-4333-8444-555555555555")).toBe(true);
  });
});

describe("untrusted output flood (P4)", () => {
  it("1000 usage_update + 1000 unreferenced terminal chunks: no chat events, ≤1 diagnostic/min", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const h = makeHarness({ protocol: 2 });
    await startReady(h);
    const before = h.events().length;
    const wr = (update: unknown) => h.agentOut.write(`${JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "s", update } })}\n`);
    for (let i = 0; i < 1000; i++) {
      wr({ sessionUpdate: "usage_update", used: i, size: 10 });
      wr({ sessionUpdate: "terminal_output_chunk", terminalId: "orphan", data: "eA==" });
    }
    await vi.waitFor(() => expect(DEFAULT_ACP_SETTINGS.maxLineBytes).toBeGreaterThan(0));
    await new Promise<void>((r) => setImmediate(r));
    expect(h.events().length).toBe(before);
    const diag = () => h.of("bridge_diagnostic").filter((m) => m.detail.includes("counters"));
    expect(diag()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(diag()).toHaveLength(1);
    expect(diag()[0]!.detail).toContain("usage=1000");
    expect(diag()[0]!.detail).toContain("unreferencedTerminal=1000");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(diag()).toHaveLength(1); // unchanged counters → no repeat report
    await h.adapter.stop();
  });
});
