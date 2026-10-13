/**
 * Adapter core behaviour through the scripted fake agent: prompts, echo, queue,
 * permissions, config options, commands.
 * See change: add-acp-session-driver (test-plan #E29–#E38).
 */
import { describe, expect, it } from "vitest";
import { makeHarness, startReady } from "./adapter-harness.js";

const userBubbles = (h: ReturnType<typeof makeHarness>) =>
  h.events().filter((e) => e.eventType === "message_start" && (e.data.message as any)?.role === "user");

describe("fresh registration", () => {
  it("replay_complete follows the first register, before any event (server holds events until then)", async () => {
    const h = makeHarness({ protocol: 1 });
    await startReady(h);
    const types = h.sent.map((m) => m.type);
    expect(types[0]).toBe("session_register");
    expect(types[1]).toBe("replay_complete");
    expect(types.indexOf("event_forward")).toBeGreaterThan(1);
  });
});

describe("prompts + echo", () => {
  it("E29: v2 early echo before acceptance yields exactly one user bubble", async () => {
    const h = makeHarness({ protocol: 2, knobs: { echoUser: "before", acceptedMessageId: "u1" } });
    await startReady(h);
    h.prompt("hello", { promptId: "p1" });
    await h.waitFor(() => h.eventTypes().includes("agent_settled"));
    expect(userBubbles(h)).toHaveLength(1);
    expect(h.of("prompt_received")).toEqual([expect.objectContaining({ fresh: true, promptId: "p1" })]);
  });

  it("v2 echo after acceptance is also dropped", async () => {
    const h = makeHarness({ protocol: 2, knobs: { echoUser: "after" } });
    await startReady(h);
    h.prompt("hello");
    await h.waitFor(() => h.eventTypes().includes("agent_settled"));
    expect(userBubbles(h)).toHaveLength(1);
  });

  it("E30: v1 echo dropped during the active prompt; a later agent-inserted user message is emitted once", async () => {
    const h = makeHarness({ protocol: 1 });
    await startReady(h);
    h.prompt("hello", { promptId: "p1" });
    await h.waitFor(() => h.eventTypes().includes("agent_settled"));
    expect(userBubbles(h)).toHaveLength(1);
    expect(h.of("prompt_received")).toHaveLength(1);
    // agent-inserted message with no pending prompt
    h.agentOut.write(`${JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "s", update: { sessionUpdate: "user_message_chunk", content: { type: "text", text: "from agent" } } } })}\n`);
    h.agentOut.write(`${JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "s", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "ok" } } } })}\n`);
    await h.waitFor(() => userBubbles(h).length === 2);
    expect(userBubbles(h)).toHaveLength(2);
  });

  it("sends text and image blocks to session/prompt", async () => {
    const h = makeHarness({ protocol: 1 });
    await startReady(h);
    h.prompt("look", { images: [{ type: "image", data: "AAAA", mimeType: "image/png" }] });
    await h.waitFor(() => h.received().some((m) => m.method === "session/prompt"));
    const req = h.received().find((m) => m.method === "session/prompt")!;
    expect(req.params.prompt).toEqual([{ type: "text", text: "look" }, { type: "image", data: "AAAA", mimeType: "image/png" }]);
  });
});

describe("queue", () => {
  it("E31: prompts while running are queued, edited/promoted, sent in order once each", async () => {
    const h = makeHarness({ protocol: 1, knobs: { delayMs: 40 } });
    await startReady(h);
    h.prompt("P1");
    h.prompt("P2");
    h.prompt("P3");
    expect(h.of("prompt_received").map((m) => m.fresh)).toEqual([true, false, false]);
    h.send({ type: "edit_followup_entry", index: 1, text: "P3-edited" } as never);
    h.send({ type: "promote_followup_entry", index: 1 } as never);
    const lastQueue = () => h.of("queue_update").at(-1)!;
    expect(lastQueue().followUp.map((f) => f.text)).toEqual(["P3-edited", "P2"]);
    await h.waitFor(() => h.received().filter((m) => m.method === "session/prompt").length === 3, 8000);
    const texts = h.received().filter((m) => m.method === "session/prompt").map((m) => m.params.prompt[0].text);
    expect(texts).toEqual(["P1", "P3-edited", "P2"]);
    await h.waitFor(() => h.eventTypes().filter((t) => t === "agent_settled").length === 3, 8000);
    expect(lastQueue().followUp).toEqual([]);
  }, 15000);

  it("E32: steer is queued, nothing sent until idle", async () => {
    const h = makeHarness({ protocol: 1, knobs: { delayMs: 30 } });
    await startReady(h);
    h.prompt("first");
    h.prompt("steer me", { delivery: "steer" });
    expect(h.of("prompt_received").map((m) => m.fresh)).toEqual([true, false]);
    expect(h.received().filter((m) => m.method === "session/prompt")).toHaveLength(1);
    await h.waitFor(() => h.received().filter((m) => m.method === "session/prompt").length === 2, 8000);
  }, 15000);

  it("an idle steer (the browser default) runs at once, not queued", async () => {
    const h = makeHarness({ protocol: 1 });
    await startReady(h);
    h.prompt("hello", { delivery: "steer" });
    expect(h.of("prompt_received").map((m) => m.fresh)).toEqual([true]);
    await h.waitFor(() => h.eventTypes().includes("agent_settled"));
  });

  it("remove and clear act on the queue", async () => {
    const h = makeHarness({ protocol: 1, knobs: { delayMs: 200 } });
    await startReady(h);
    h.prompt("a");
    h.prompt("b");
    h.prompt("c");
    h.send({ type: "remove_followup_entry", index: 0 } as never);
    expect(h.of("queue_update").at(-1)!.followUp.map((f) => f.text)).toEqual(["c"]);
    h.send({ type: "clear_followup_entries", indices: "all" } as never);
    expect(h.of("queue_update").at(-1)!.followUp).toEqual([]);
    await h.adapter.stop();
  });

  it("E33: a rejected prompt ends the turn with an error and the queue continues", async () => {
    const h = makeHarness({ protocol: 1, knobs: { rejectPrompt: true } });
    await startReady(h);
    h.prompt("boom");
    await h.waitFor(() => h.eventTypes().includes("agent_settled"));
    const end = h.events().find((e) => e.eventType === "agent_end")!;
    expect((end.data.messages as any[]).at(-1)).toMatchObject({ stopReason: "error", errorMessage: expect.stringContaining("rejected") });
    // idle again → next prompt is dispatched
    h.prompt("second");
    await h.waitFor(() => h.received().filter((m) => m.method === "session/prompt").length === 2);
  });
});

describe("abort + permissions", () => {
  it("E34: abort sends session/cancel and answers the pending permission cancelled", async () => {
    const h = makeHarness({ protocol: 1, knobs: { permission: true } });
    await startReady(h);
    h.prompt("go");
    await h.waitFor(() => h.of("prompt_request").length === 1);
    h.send({ type: "abort" } as never);
    await h.waitFor(() => h.received().some((m) => m.method === "session/cancel"));
    await h.waitFor(() => h.received().some((m) => m.id !== undefined && m.result?.outcome?.outcome === "cancelled"));
    expect(h.of("prompt_cancel")).toHaveLength(1);
    await h.waitFor(() => h.eventTypes().includes("agent_settled"));
  });

  it("E35: permission prompt shape and outcomes (select / dismiss)", async () => {
    const h = makeHarness({ protocol: 1, knobs: { permission: true } });
    await startReady(h);
    h.prompt("go");
    await h.waitFor(() => h.of("prompt_request").length === 1);
    const req = h.of("prompt_request")[0]!;
    expect(req).toMatchObject({
      prompt: { type: "select", question: "Run npm test", options: ["Allow once", "Deny"] },
      component: { type: "generic-dialog", props: { question: "Run npm test", type: "select", options: ["Allow once", "Deny"] } },
      placement: "inline",
    });
    h.send({ type: "prompt_response", promptId: req.promptId, answer: "Allow once", source: "dashboard" } as never);
    await h.waitFor(() => h.received().some((m) => m.result?.outcome?.outcome === "selected"));
    expect(h.received().find((m) => m.result?.outcome)!.result.outcome).toEqual({ outcome: "selected", optionId: "allow" });
    await h.waitFor(() => h.eventTypes().includes("agent_settled"));
    expect(h.eventTypes()).toEqual(expect.arrayContaining(["ui_prompt_start", "ui_prompt_end"]));

    const d = makeHarness({ protocol: 2, knobs: { permission: true } });
    await startReady(d);
    d.prompt("go");
    await d.waitFor(() => d.of("prompt_request").length === 1);
    expect(d.of("prompt_request")[0]!.prompt.question).toBe("Run npm test?");
    d.send({ type: "prompt_response", promptId: d.of("prompt_request")[0]!.promptId, cancelled: true, source: "dashboard" } as never);
    await d.waitFor(() => d.received().some((m) => m.result?.outcome?.outcome === "cancelled"));
  });
});

describe("config options + commands", () => {
  it("E36: models_list from the agent; set_model / set_thinking_level via set_config_option", async () => {
    const h = makeHarness({ protocol: 1 });
    await startReady(h);
    expect(h.of("models_list").at(-1)!.models.map((m) => `${m.provider}/${m.id}`)).toEqual(["acp:qmt/openai/gpt-5", "acp:qmt/anthropic/claude"]);
    expect(h.events().find((e) => e.eventType === "model_select")?.data).toEqual({ model: { provider: "acp:qmt", id: "openai/gpt-5" } });
    h.send({ type: "set_model", provider: "acp:qmt", modelId: "anthropic/claude" } as never);
    await h.waitFor(() => h.events().some((e) => (e.data.model as any)?.id === "anthropic/claude"));
    h.send({ type: "set_thinking_level", level: "high" } as never);
    await h.waitFor(() => h.events().some((e) => e.data.thinkingLevel === "high"));
    const calls = h.received().filter((m) => m.method === "session/set_config_option");
    expect(calls.map((c) => [c.params.configId, c.params.value])).toEqual([["model", "anthropic/claude"], ["thought_level", "high"]]);
  });

  it("E37: an unanswered set_config_option times out with a notify and the session stays usable", async () => {
    const h = makeHarness({ protocol: 1, knobs: { withhold: ["session/set_config_option"] }, settings: { requestTimeoutMs: 300 } });
    await startReady(h);
    const t0 = Date.now();
    h.send({ type: "set_model", provider: "acp:qmt", modelId: "anthropic/claude" } as never);
    await h.waitFor(() => h.of("notify").length === 1);
    const dt = Date.now() - t0;
    expect(dt).toBeGreaterThanOrEqual(280);
    expect(dt).toBeLessThan(1500);
    expect(h.of("notify")[0]!.level).toBe("error");
    h.prompt("still works");
    await h.waitFor(() => h.eventTypes().includes("agent_settled"));
  });

  it("E38: commands + session name produce no chat events", async () => {
    const h = makeHarness({ protocol: 1 });
    await startReady(h);
    const before = h.events().length;
    const up = (update: unknown) => h.agentOut.write(`${JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "s", update } })}\n`);
    up({ sessionUpdate: "available_commands_update", availableCommands: [{ name: "review", description: "Review code" }] });
    up({ sessionUpdate: "session_info_update", title: "T" });
    await h.waitFor(() => h.of("session_name_update").length === 1);
    expect(h.of("commands_list").at(-1)!.commands).toEqual([{ name: "review", description: "Review code", source: "acp" }]);
    expect(h.of("session_name_update")[0]!.name).toBe("T");
    expect(h.events().length).toBe(before);
  });
});
