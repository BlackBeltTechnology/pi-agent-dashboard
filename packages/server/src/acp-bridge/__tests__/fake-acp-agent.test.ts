/**
 * Self-test of the scripted fake ACP agent (task 0.2): deterministic replay in
 * v1/v2 modes and every knob the later acp-bridge tests rely on.
 * In-process over PassThrough streams — no child process.
 * See change: add-acp-session-driver.
 */
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { type FakeAgentKnobs, runFakeAgent } from "./fake-acp-agent.mjs";

type Msg = Record<string, any>;

function harness(protocol: 1 | 2, knobs: FakeAgentKnobs = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  const lines: string[] = [];
  let buf = "";
  output.on("data", (c: Buffer) => {
    buf += c.toString("utf8");
    let nl = buf.indexOf("\n");
    while (nl >= 0) {
      lines.push(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      nl = buf.indexOf("\n");
    }
  });
  const agent = runFakeAgent({ input, output, protocol, knobs });
  const send = (m: Msg) => input.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
  const parsed = () => lines.flatMap((l) => { try { return [JSON.parse(l) as Msg]; } catch { return []; } });
  const waitFor = async (pred: () => boolean, ms = 2000) => {
    const t0 = Date.now();
    while (!pred()) {
      if (Date.now() - t0 > ms) throw new Error(`timeout; got ${lines.length} lines`);
      await new Promise((r) => setTimeout(r, 5));
    }
  };
  return { agent, send, lines, parsed, waitFor, input };
}

const updates = (msgs: Msg[]) => msgs.filter((m) => m.method === "session/update").map((m) => m.params.update);

describe("fake ACP agent", () => {
  it("handshake: initialize + session/new return the fixture", async () => {
    const h = harness(1);
    h.send({ id: 1, method: "initialize", params: { protocolVersion: 1 } });
    h.send({ id: 2, method: "session/new", params: { cwd: "/tmp", mcpServers: [] } });
    await h.waitFor(() => h.parsed().length >= 2);
    const [init, sess] = h.parsed();
    expect(init!.result.protocolVersion).toBe(1);
    expect(sess!.result.sessionId).toBe("sess_synthetic_1");
    expect(sess!.result.configOptions.length).toBeGreaterThan(0);
  });

  it("v1 turn: echo, scripted updates, then stopReason response", async () => {
    const h = harness(1);
    h.send({ id: 3, method: "session/prompt", params: { sessionId: "s", prompt: [{ type: "text", text: "hello" }] } });
    await h.waitFor(() => h.parsed().some((m) => m.id === 3));
    const msgs = h.parsed();
    const ups = updates(msgs);
    expect(ups[0]).toMatchObject({ sessionUpdate: "user_message_chunk", content: { text: "hello" } });
    expect(ups.map((u) => u.sessionUpdate)).toContain("tool_call");
    expect(msgs.find((m) => m.id === 3)!.result).toEqual({ stopReason: "end_turn" });
  });

  it("v2 turn: accepts with messageId first, ends with state_update idle", async () => {
    const h = harness(2);
    h.send({ id: 3, method: "session/prompt", params: { sessionId: "s", prompt: [{ type: "text", text: "hello" }] } });
    await h.waitFor(() => updates(h.parsed()).some((u) => u.sessionUpdate === "state_update" && u.state === "idle"));
    const msgs = h.parsed();
    expect(msgs.find((m) => m.id === 3)!.result.messageId).toMatch(/^u-accepted/);
    expect(msgs.findIndex((m) => m.id === 3)).toBeLessThan(msgs.findIndex((m) => m.method === "session/update"));
  });

  it("is deterministic across runs", async () => {
    const run = async () => {
      const h = harness(1);
      h.send({ id: 3, method: "session/prompt", params: { sessionId: "s", prompt: [{ type: "text", text: "x" }] } });
      await h.waitFor(() => h.parsed().some((m) => m.id === 3));
      return h.lines.join("\n");
    };
    expect(await run()).toBe(await run());
  });

  it("knobs: withhold, rejectPrompt, hostileSessionId, initializeVersion", async () => {
    const h = harness(1, { withhold: ["initialize"], hostileSessionId: true, initializeVersion: 3 });
    h.send({ id: 1, method: "initialize", params: {} });
    h.send({ id: 2, method: "session/new", params: {} });
    await h.waitFor(() => h.parsed().length >= 1);
    expect(h.parsed()).toHaveLength(1);
    expect(h.parsed()[0]!.result.sessionId).toBe("../../../etc/x");

    const r = harness(1, { rejectPrompt: true });
    r.send({ id: 5, method: "session/prompt", params: { prompt: [] } });
    await r.waitFor(() => r.parsed().length >= 1);
    expect(r.parsed()[0]!.error.code).toBe(-32000);

    const v = harness(1, { initializeVersion: 3 });
    v.send({ id: 1, method: "initialize", params: {} });
    await v.waitFor(() => v.parsed().length >= 1);
    expect(v.parsed()[0]!.result.protocolVersion).toBe(3);
  });

  it("knobs: non-JSON, over-long line, fs/terminal/_ requests, unknown variant", async () => {
    const h = harness(1, { nonJson: true, longLine: 70_000, requestFs: true, unknownVariant: true });
    h.send({ id: 3, method: "session/prompt", params: { prompt: [{ type: "text", text: "x" }] } });
    await h.waitFor(() => h.parsed().some((m) => m.id === 3));
    expect(h.lines).toContain("this is not json");
    expect(h.lines.some((l) => l.length === 70_000)).toBe(true);
    const methods = h.parsed().map((m) => m.method);
    expect(methods).toEqual(expect.arrayContaining(["fs/read_text_file", "terminal/create", "_x/y", "_x/n"]));
    expect(updates(h.parsed()).some((u) => u.sessionUpdate === "_querymt_hook_notice")).toBe(true);
  });

  it("knobs: echoUser before / none", async () => {
    const before = harness(2, { echoUser: "before" });
    before.send({ id: 3, method: "session/prompt", params: { prompt: [{ type: "text", text: "x" }] } });
    await before.waitFor(() => before.parsed().some((m) => m.id === 3));
    const msgs = before.parsed();
    expect(msgs.findIndex((m) => m.method === "session/update")).toBeLessThan(msgs.findIndex((m) => m.id === 3));

    const none = harness(1, { echoUser: "none" });
    none.send({ id: 3, method: "session/prompt", params: { prompt: [{ type: "text", text: "x" }] } });
    await none.waitFor(() => none.parsed().some((m) => m.id === 3));
    expect(updates(none.parsed()).some((u) => u.sessionUpdate === "user_message_chunk")).toBe(false);
  });

  it("permission turn: waits for the answer; cancel ends the turn cancelled", async () => {
    const h = harness(1, { permission: true });
    h.send({ id: 3, method: "session/prompt", params: { prompt: [{ type: "text", text: "go" }] } });
    await h.waitFor(() => h.parsed().some((m) => m.method === "session/request_permission"));
    const req = h.parsed().find((m) => m.method === "session/request_permission")!;
    expect(h.parsed().some((m) => m.id === 3)).toBe(false);
    h.send({ id: req.id, result: { outcome: { outcome: "selected", optionId: "allow" } } });
    await h.waitFor(() => h.parsed().some((m) => m.id === 3));
    expect(h.parsed().find((m) => m.id === 3)!.result.stopReason).toBe("end_turn");

    const c = harness(1, { permission: true });
    c.send({ id: 3, method: "session/prompt", params: { prompt: [{ type: "text", text: "go" }] } });
    await c.waitFor(() => c.parsed().some((m) => m.method === "session/request_permission"));
    const creq = c.parsed().find((m) => m.method === "session/request_permission")!;
    c.send({ method: "session/cancel", params: { sessionId: "s" } });
    c.send({ id: creq.id, result: { outcome: { outcome: "cancelled" } } });
    await c.waitFor(() => c.parsed().some((m) => m.id === 3));
    expect(c.parsed().find((m) => m.id === 3)!.result.stopReason).toBe("cancelled");
  });

  it("set_config_option answers and emits config_option_update; unknown methods get -32601", async () => {
    const h = harness(1);
    h.send({ id: 7, method: "session/set_config_option", params: { sessionId: "s", configId: "model", value: "anthropic/claude" } });
    h.send({ id: 8, method: "nope/nope", params: {} });
    await h.waitFor(() => h.parsed().some((m) => m.id === 8));
    const cfg = updates(h.parsed()).find((u) => u.sessionUpdate === "config_option_update");
    expect(cfg.configOptions.find((o: Msg) => o.configId === "model").currentValue).toBe("anthropic/claude");
    expect(h.parsed().find((m) => m.id === 8)!.error.code).toBe(-32601);
  });
});
