/**
 * chat-gateway orchestrator tests — the inbound/outbound loop end to end with a
 * fake host seam and a recording adapter.
 *
 * Covers the boundary/refusal rows that must never reach a session (X10, X1,
 * X8), the delivery mapping (X6), the single-edited-message invariant (F7), the
 * cross-surface dismissal (F2), and sticky routing (E10/E11).
 *
 * See change: add-chat-gateway.
 */
import { describe, expect, it } from "vitest";
import { RecordingAdapter } from "../../adapters/__tests__/recording-adapter.js";
import type { Binding } from "../../shared/types.js";
import { resolveConfig } from "../config.js";
import { createChatGateway } from "../gateway.js";
import type { BindingStore } from "../routing.js";
import { createSpawnCorrelator } from "../routing.js";
import { createFakeSeam } from "./fake-seam.js";

const flush = () => new Promise((r) => setTimeout(r, 0));

function memoryStore(seed: Binding[] = []): BindingStore {
  const m = new Map<string, Binding>();
  for (const b of seed) m.set(`${b.platform}:${b.channelId}:${b.threadId ?? "-"}`, b);
  return {
    load: () => {},
    get: (k) => m.get(k),
    set: (b) => {
      m.set(`${b.platform}:${b.channelId}:${b.threadId ?? "-"}`, b);
    },
    remove: (k) => {
      m.delete(k);
    },
    all: () => [...m.values()],
    persist: () => {},
  };
}

function baseConfig(over: Record<string, unknown> = {}) {
  return resolveConfig({
    token: "test-token",
    allowlist: ["u1"],
    admins: ["u1"],
    groupChannels: [],
    allowedRoots: ["/repos"],
    editThrottleMs: 0,
    ...over,
  });
}

function makeGateway(opts: {
  config?: ReturnType<typeof baseConfig>;
  store?: BindingStore;
  seam?: ReturnType<typeof createFakeSeam>;
  adapter?: RecordingAdapter;
}) {
  const seam = opts.seam ?? createFakeSeam();
  const adapter = opts.adapter ?? new RecordingAdapter();
  const store = opts.store ?? memoryStore();
  const gateway = createChatGateway({
    platform: "discord",
    seam,
    adapter,
    config: opts.config ?? baseConfig(),
    store,
    correlator: createSpawnCorrelator(),
    now: () => 1_000,
  });
  return { gateway, seam, adapter, store };
}

const boundBinding = (over: Partial<Binding> = {}): Binding => ({
  platform: "discord",
  channelId: "c1",
  sessionId: "s1",
  cwd: "/repos/proj",
  boundBy: "u1",
  source: "attach",
  createdAt: 1,
  ...over,
});

describe("chat-gateway orchestrator", () => {
  it("X10: a non-allowlisted user never reaches a session", async () => {
    const { gateway, seam, adapter } = makeGateway({
      store: memoryStore([boundBinding()]),
    });
    seam.sessions = [{ id: "s1", cwd: "/repos/proj" }];

    await gateway.handleInbound({
      platform: "discord",
      channelId: "c1",
      userId: "intruder",
      text: "hi",
      isDM: true,
      startedAt: 0,
    });

    expect(seam.sentPrompts).toEqual([]);
    expect(adapter.sent).toHaveLength(1);
    expect(adapter.sent[0].content).toContain("not_allowlisted");
  });

  it("L4: a non-opted-in guild channel is inert even for an allowlisted user", async () => {
    const { gateway, seam, adapter } = makeGateway({ store: memoryStore([boundBinding()]) });
    seam.sessions = [{ id: "s1", cwd: "/repos/proj" }];

    await gateway.handleInbound({
      platform: "discord",
      channelId: "c1",
      userId: "u1",
      text: "hi",
      isDM: false,
      startedAt: 0,
    });

    // F2: a channel the operator never opted in must see NOTHING — no prompt
    // reaches a session and the bot does not reply (no noise / 429 / ban).
    expect(seam.sentPrompts).toEqual([]);
    expect(adapter.sent).toEqual([]);
  });

  it("X6: a plain message is followUp; a steer-prefixed one is steer", async () => {
    const { gateway, seam } = makeGateway({ store: memoryStore([boundBinding()]) });
    seam.sessions = [{ id: "s1", cwd: "/repos/proj" }];

    await gateway.handleInbound({
      platform: "discord",
      channelId: "c1",
      userId: "u1",
      text: "keep going",
      isDM: true,
      startedAt: 0,
    });
    await gateway.handleInbound({
      platform: "discord",
      channelId: "c1",
      userId: "u1",
      text: "!stop that",
      isDM: true,
      startedAt: 0,
    });

    expect(seam.sentPrompts).toEqual([
      { sessionId: "s1", text: "keep going", delivery: "followUp" },
      { sessionId: "s1", text: "stop that", delivery: "steer" },
    ]);
  });

  it("E10: a second message reuses the bound session and never re-spawns", async () => {
    const { gateway, seam } = makeGateway({ store: memoryStore([boundBinding()]) });
    seam.sessions = [{ id: "s1", cwd: "/repos/proj" }];

    for (const text of ["one", "two"]) {
      await gateway.handleInbound({
        platform: "discord",
        channelId: "c1",
        userId: "u1",
        text,
        isDM: true,
        startedAt: 0,
      });
    }

    expect(seam.sentPrompts.map((p) => p.sessionId)).toEqual(["s1", "s1"]);
    expect(seam.spawns).toHaveLength(0);
  });

  it("E11: a thread resolves an independent binding key", async () => {
    const store = memoryStore([boundBinding()]);
    const { gateway, seam } = makeGateway({ store });
    seam.sessions = [
      { id: "s1", cwd: "/repos/proj" },
      { id: "s2", cwd: "/repos/proj" },
    ];
    store.set(boundBinding({ threadId: "t9", sessionId: "s2" }));

    await gateway.handleInbound({
      platform: "discord",
      channelId: "c1",
      threadId: "t9",
      userId: "u1",
      text: "in thread",
      isDM: true,
      startedAt: 0,
    });

    expect(seam.sentPrompts).toEqual([
      { sessionId: "s2", text: "in thread", delivery: "followUp" },
    ]);
  });

  it("X1: an unreachable bound session produces an in-channel error, not silence", async () => {
    const { gateway, adapter } = makeGateway({ store: memoryStore([boundBinding()]) });
    // No live sessions at all.

    await gateway.handleInbound({
      platform: "discord",
      channelId: "c1",
      userId: "u1",
      text: "hi",
      isDM: true,
      startedAt: 0,
    });

    expect(adapter.sent).toHaveLength(1);
    expect(adapter.sent[0].content).toMatch(/unreachable/i);
  });

  it("X8: a failed spawn reports in-channel and leaves no dangling binding", async () => {
    const store = memoryStore();
    const seam = createFakeSeam();
    seam.spawnResult = { success: false, message: "boom" };
    const { gateway, adapter } = makeGateway({
      store,
      seam,
      config: baseConfig({ fixedMap: { "discord:c1:-": "/repos/proj" } }),
    });

    await gateway.handleInbound({
      platform: "discord",
      channelId: "c1",
      userId: "u1",
      text: "hi",
      isDM: true,
      startedAt: 0,
    });

    expect(adapter.sent).toHaveLength(1);
    expect(adapter.sent[0].content).toContain("Spawn failed");
    expect(store.all()).toEqual([]);
  });

  it("E3: spawning with an empty allowedRoots is refused", async () => {
    const seam = createFakeSeam();
    const { gateway, adapter } = makeGateway({
      seam,
      config: baseConfig({ allowedRoots: [], fixedMap: { "discord:c1:-": "/repos/proj" } }),
    });

    await gateway.handleInbound({
      platform: "discord",
      channelId: "c1",
      userId: "u1",
      text: "hi",
      isDM: true,
      startedAt: 0,
    });

    expect(seam.spawns).toHaveLength(0);
    // Two refusals reach this path — `resolveCwd` refuses because every
    // candidate is outside the (empty) whitelist, and `spawnIn` refuses
    // explicitly. Either way: NO spawn, ONE in-channel refusal.
    expect(adapter.sent).toHaveLength(1);
    expect(adapter.sent[0].content).toMatch(/refus|allowedRoots|No session/i);
  });

  it("F7: a delta burst produces exactly ONE message id, edited in place", async () => {
    const { gateway, seam, adapter } = makeGateway({ store: memoryStore([boundBinding()]) });
    seam.sessions = [{ id: "s1", cwd: "/repos/proj" }];
    adapter.reset();

    const frame = (text: string) => ({
      type: "event",
      sessionId: "s1",
      seq: 1,
      event: {
        eventType: "message_update",
        timestamp: 0,
        data: { message: { role: "assistant", content: [{ type: "text", text }] } },
      },
    });

    for (let i = 1; i <= 30; i++) {
      gateway.handleFrame("s1", frame("x".repeat(i)));
      await flush();
    }

    expect(adapter.sent).toHaveLength(1);
    const id = adapter.sent[0].id;
    expect(adapter.edited.length).toBeGreaterThan(0);
    expect(adapter.edited.every((e) => e.messageId === id)).toBe(true);
    // The last edit carries the complete text.
    expect(adapter.edited[adapter.edited.length - 1].content).toBe("x".repeat(30));
  });

  it("F2: prompt_request renders controls and prompt_dismiss removes them", async () => {
    const { gateway, seam, adapter } = makeGateway({ store: memoryStore([boundBinding()]) });
    seam.sessions = [{ id: "s1", cwd: "/repos/proj" }];
    adapter.reset();

    gateway.handleFrame("s1", {
      type: "prompt_request",
      sessionId: "s1",
      promptId: "p1",
      prompt: { type: "select", title: "Pick one", options: ["a", "b"] },
    });
    await flush();
    expect(adapter.interactive).toHaveLength(1);
    expect(adapter.interactive[0].prompt.method).toBe("select");

    gateway.handleFrame("s1", { type: "prompt_dismiss", sessionId: "s1", promptId: "p1" });
    await flush();
    expect(adapter.cleaned).toHaveLength(1);
  });

  it("task 9: the L3 guard is loaded into a SPAWNED session when policy + extension are configured", async () => {
    const seam = createFakeSeam();
    const { gateway } = makeGateway({
      seam,
      config: baseConfig({
        fixedMap: { "discord:c1:-": "/repos/proj" },
        toolPolicy: { allow: ["read"], approval: ["bash"], defaultAction: "deny" },
        guardExtension: "chat-gateway-guard",
      }),
    });

    await gateway.handleInbound({
      platform: "discord",
      channelId: "c1",
      userId: "u1",
      text: "hi",
      isDM: true,
      startedAt: 0,
    });

    expect(seam.spawns).toHaveLength(1);
    expect(seam.spawns[0].extensions).toEqual(["chat-gateway-guard"]);
    expect(seam.spawns[0].extensionConfig?.["chat-gateway-guard"]).toBeDefined();
  });

  it("task 9/X5: no policy or no extension id means the guard is NOT loaded", async () => {
    const seam = createFakeSeam();
    const { gateway } = makeGateway({
      seam,
      config: baseConfig({ fixedMap: { "discord:c1:-": "/repos/proj" } }),
    });

    await gateway.handleInbound({
      platform: "discord",
      channelId: "c1",
      userId: "u1",
      text: "hi",
      isDM: true,
      startedAt: 0,
    });

    expect(seam.spawns).toHaveLength(1);
    expect(seam.spawns[0].extensions).toBeUndefined();
  });

  it("F1: an interactive response is forwarded as a prompt_response", async () => {
    const { gateway, seam, adapter } = makeGateway({ store: memoryStore([boundBinding()]) });
    seam.sessions = [{ id: "s1", cwd: "/repos/proj" }];
    adapter.reset();
    await gateway.start();

    gateway.handleFrame("s1", {
      type: "prompt_request",
      sessionId: "s1",
      promptId: "p1",
      prompt: { type: "select", title: "Pick one", options: ["a", "b"] },
    });
    await flush();

    adapter.emitInteractiveResponse({ userId: "u1", requestId: "p1", value: "b" });
    await flush();

    expect(seam.sentResponses).toEqual([
      { sessionId: "s1", response: { promptId: "p1", answer: "b", cancelled: false, source: "discord" } },
    ]);
  });

  it("4.3 resume: an ended bound session is continued from its transcript", async () => {
    const seam = createFakeSeam();
    // Session s1 is registered but ENDED, with a transcript on disk (host-recorded).
    seam.endedSessions = [
      { id: "s1", cwd: "/repos/proj", status: "ended", sessionFile: "/home/pi/.pi/s1.jsonl" },
    ];
    const { gateway, adapter } = makeGateway({
      seam,
      store: memoryStore([boundBinding()]),
    });

    await gateway.handleInbound({
      platform: "discord",
      channelId: "c1",
      userId: "u1",
      text: "keep going",
      isDM: true,
      startedAt: 0,
    });

    expect(seam.spawns).toHaveLength(1);
    expect(seam.spawns[0].resume).toEqual({ sessionFile: "/home/pi/.pi/s1.jsonl" });
    expect(seam.spawns[0].cwd).toBe("/repos/proj");
    expect(seam.sentPrompts).toEqual([]);
    expect(adapter.sent[0].content).toMatch(/resuming/i);
  });

  it("4.3 resume: an ended session whose cwd left allowedRoots is refused, no spawn", async () => {
    const seam = createFakeSeam();
    seam.endedSessions = [
      { id: "s1", cwd: "/outside", status: "ended", sessionFile: "/home/pi/.pi/s1.jsonl" },
    ];
    const { gateway, adapter } = makeGateway({
      seam,
      store: memoryStore([boundBinding({ cwd: "/outside" })]),
    });

    await gateway.handleInbound({
      platform: "discord",
      channelId: "c1",
      userId: "u1",
      text: "hi",
      isDM: true,
      startedAt: 0,
    });

    expect(seam.spawns).toHaveLength(0);
    expect(adapter.sent[0].content).toContain("allowedRoots");
  });

  it("4.3 502: a live-but-disconnected session is NOT resumed and surfaces unreachable", async () => {
    const seam = createFakeSeam();
    // Registered but neither live nor ended -> no bridge connection (X1).
    seam.endedSessions = [{ id: "s1", cwd: "/repos/proj", status: "active" }];
    const { gateway, adapter } = makeGateway({
      seam,
      store: memoryStore([boundBinding()]),
    });

    await gateway.handleInbound({
      platform: "discord",
      channelId: "c1",
      userId: "u1",
      text: "hi",
      isDM: true,
      startedAt: 0,
    });

    expect(seam.spawns).toHaveLength(0);
    expect(adapter.sent[0].content).toMatch(/unreachable/i);
  });

  it("7.2/F3: multiselect sequences toggles then submits JSON values as ONE response", async () => {
    const { gateway, seam, adapter } = makeGateway({ store: memoryStore([boundBinding()]) });
    seam.sessions = [{ id: "s1", cwd: "/repos/proj" }];
    adapter.reset();
    await gateway.start();

    gateway.handleFrame("s1", {
      type: "prompt_request",
      sessionId: "s1",
      promptId: "pm1",
      prompt: { type: "multiselect", title: "Pick many", options: ["a", "b"] },
    });
    await flush();
    // Only the FIRST toggle is rendered, not the whole sequence at once.
    expect(adapter.interactive).toHaveLength(1);
    expect(adapter.interactive[0].prompt.message).toBe("a");

    adapter.emitInteractiveResponse({ userId: "u1", requestId: "pm1:0", confirmed: true });
    await flush();
    expect(adapter.interactive).toHaveLength(2);
    expect(adapter.interactive[1].prompt.message).toBe("b");

    adapter.emitInteractiveResponse({ userId: "u1", requestId: "pm1:1", confirmed: false });
    await flush();
    expect(adapter.interactive).toHaveLength(3);
    expect(adapter.interactive[2].prompt.requestId).toBe("pm1:confirm");

    adapter.emitInteractiveResponse({ userId: "u1", requestId: "pm1:confirm", confirmed: true });
    await flush();

    expect(seam.sentResponses).toEqual([
      { sessionId: "s1", response: { promptId: "pm1", answer: '["a"]', cancelled: false, source: "discord" } },
    ]);
  });

  it("7.2/F3: cancelling the multiselect submit converges on the same root id, cancelled", async () => {
    const { gateway, seam, adapter } = makeGateway({ store: memoryStore([boundBinding()]) });
    seam.sessions = [{ id: "s1", cwd: "/repos/proj" }];
    adapter.reset();
    await gateway.start();

    gateway.handleFrame("s1", {
      type: "prompt_request",
      sessionId: "s1",
      promptId: "pm2",
      prompt: { type: "multiselect", title: "Pick", options: ["a"] },
    });
    await flush();
    adapter.emitInteractiveResponse({ userId: "u1", requestId: "pm2:0", confirmed: true });
    await flush();
    adapter.emitInteractiveResponse({ userId: "u1", requestId: "pm2:confirm", confirmed: false });
    await flush();

    expect(seam.sentResponses).toEqual([
      { sessionId: "s1", response: { promptId: "pm2", answer: undefined, cancelled: true, source: "discord" } },
    ]);
  });

  it("7.2/F4: batch sequences sub-prompts and returns index-aligned JSON answers", async () => {
    const { gateway, seam, adapter } = makeGateway({ store: memoryStore([boundBinding()]) });
    seam.sessions = [{ id: "s1", cwd: "/repos/proj" }];
    adapter.reset();
    await gateway.start();

    gateway.handleFrame("s1", {
      type: "prompt_request",
      sessionId: "s1",
      promptId: "pb1",
      prompt: {
        type: "batch",
        title: "Survey",
        metadata: { questions: [{ title: "Name" }, { title: "Colour", options: ["red", "blue"] }] },
      },
    });
    await flush();
    expect(adapter.interactive).toHaveLength(1);
    expect(adapter.interactive[0].prompt.method).toBe("input");

    adapter.emitInteractiveResponse({ userId: "u1", requestId: "pb1:0", value: "Ada" });
    await flush();
    expect(adapter.interactive).toHaveLength(2);
    expect(adapter.interactive[1].prompt.method).toBe("select");

    adapter.emitInteractiveResponse({ userId: "u1", requestId: "pb1:1", value: "blue" });
    await flush();

    expect(seam.sentResponses).toEqual([
      { sessionId: "s1", response: { promptId: "pb1", answer: '["Ada","blue"]', cancelled: false, source: "discord" } },
    ]);
  });

  it("7.2/F4: a batch with no questions answers immediately with an empty array", async () => {
    const { gateway, seam, adapter } = makeGateway({ store: memoryStore([boundBinding()]) });
    seam.sessions = [{ id: "s1", cwd: "/repos/proj" }];
    adapter.reset();
    await gateway.start();

    gateway.handleFrame("s1", {
      type: "prompt_request",
      sessionId: "s1",
      promptId: "pb2",
      prompt: { type: "batch", title: "Empty", metadata: { questions: [] } },
    });
    await flush();

    expect(adapter.interactive).toHaveLength(0);
    expect(seam.sentResponses).toEqual([
      { sessionId: "s1", response: { promptId: "pb2", answer: "[]", cancelled: false, source: "discord" } },
    ]);
  });

  it("7.2/F2: a web-first dismiss of the ROOT drops the sequence controls, no response", async () => {
    const { gateway, seam, adapter } = makeGateway({ store: memoryStore([boundBinding()]) });
    seam.sessions = [{ id: "s1", cwd: "/repos/proj" }];
    adapter.reset();
    await gateway.start();

    gateway.handleFrame("s1", {
      type: "prompt_request",
      sessionId: "s1",
      promptId: "pm3",
      prompt: { type: "multiselect", title: "Pick", options: ["a", "b"] },
    });
    await flush();
    expect(adapter.interactive).toHaveLength(1);

    gateway.handleFrame("s1", { type: "prompt_dismiss", sessionId: "s1", promptId: "pm3" });
    await flush();

    expect(adapter.cleaned).toHaveLength(1);
    expect(seam.sentResponses).toEqual([]);
  });

  it("8.1/E13: an unknown DM redeems the pairing code, is allowlisted and persisted", async () => {
    const seam = createFakeSeam();
    const { gateway, adapter } = makeGateway({ seam, store: memoryStore([boundBinding()]) });
    seam.sessions = [{ id: "s1", cwd: "/repos/proj" }];
    const code = gateway.status().pairingCode;
    expect(code).toMatch(/^\d{6}$/);

    await gateway.handleInbound({
      platform: "discord",
      channelId: "c1",
      userId: "newbie",
      text: code,
      isDM: true,
      startedAt: 0,
    });

    expect(seam.persistedAllowlists).toEqual([["u1", "newbie"]]);
    expect(adapter.sent[0].content).toMatch(/paired/i);
    expect(seam.sentPrompts).toEqual([]); // the code message is not a prompt

    // Now allowlisted: the next message reaches the session.
    await gateway.handleInbound({
      platform: "discord",
      channelId: "c1",
      userId: "newbie",
      text: "hello",
      isDM: true,
      startedAt: 0,
    });
    expect(seam.sentPrompts).toEqual([
      { sessionId: "s1", text: "hello", delivery: "followUp" },
    ]);
  });

  it("8.1: a wrong pairing code never grants access", async () => {
    const { gateway, seam, adapter } = makeGateway({ store: memoryStore([boundBinding()]) });
    seam.sessions = [{ id: "s1", cwd: "/repos/proj" }];

    await gateway.handleInbound({
      platform: "discord",
      channelId: "c1",
      userId: "newbie",
      text: "not-a-code",
      isDM: true,
      startedAt: 0,
    });

    expect(seam.persistedAllowlists).toEqual([]);
    expect(seam.sentPrompts).toEqual([]);
    expect(adapter.sent[0].content).toContain("not_allowlisted");
  });

  it("8.1: pairing is refused in a group channel (code would leak publicly)", async () => {
    const seam = createFakeSeam();
    const { gateway, seam: s, adapter } = makeGateway({
      seam,
      store: memoryStore([boundBinding()]),
      config: baseConfig({ groupChannels: ["c1"] }),
    });
    s.sessions = [{ id: "s1", cwd: "/repos/proj" }];
    const code = gateway.status().pairingCode;

    await gateway.handleInbound({
      platform: "discord",
      channelId: "c1",
      userId: "newbie",
      text: code,
      isDM: false,
      startedAt: 0,
    });

    expect(seam.persistedAllowlists).toEqual([]);
    expect(adapter.sent[0].content).toContain("not_allowlisted");
  });

  it("13.1/X7: a restarted gateway reuses the persisted binding (no re-create, no re-spawn)", async () => {
    const seam1 = createFakeSeam();
    const store1 = memoryStore();
    const g1 = makeGateway({ seam: seam1, store: store1 });
    seam1.sessions = [{ id: "s1", cwd: "/repos/proj" }];

    // First inbound attaches to the single live in-range session.
    await g1.gateway.handleInbound({
      platform: "discord",
      channelId: "c1",
      userId: "u1",
      text: "first",
      isDM: true,
      startedAt: 0,
    });
    expect(store1.all()).toHaveLength(1);

    // "Restart": a fresh gateway loads the same bindings from disk and reuses
    // them — a second message must NOT re-create or re-spawn.
    const seam2 = createFakeSeam();
    seam2.sessions = [{ id: "s1", cwd: "/repos/proj" }];
    const g2 = makeGateway({ seam: seam2, store: memoryStore(store1.all()) });
    await g2.gateway.handleInbound({
      platform: "discord",
      channelId: "c1",
      userId: "u1",
      text: "second",
      isDM: true,
      startedAt: 0,
    });

    expect(seam2.spawns).toHaveLength(0);
    expect(seam2.sentPrompts).toEqual([
      { sessionId: "s1", text: "second", delivery: "followUp" },
    ]);
  });

  it("14.4/F6: a reply past the Discord limit continues in a NEW message, never truncated", async () => {
    const { gateway, seam, adapter } = makeGateway({ store: memoryStore([boundBinding()]) });
    seam.sessions = [{ id: "s1", cwd: "/repos/proj" }];
    adapter.reset();

    const text = "x".repeat(2500);
    gateway.handleFrame("s1", {
      type: "event",
      sessionId: "s1",
      seq: 1,
      event: {
        eventType: "message_update",
        timestamp: 0,
        data: { message: { role: "assistant", content: [{ type: "text", text }] } },
      },
    });
    await flush();

    expect(adapter.sent.length).toBeGreaterThan(1);
    expect(adapter.sent.map((m) => m.content).join("")).toBe(text);
  });

  it("V.2/L3: toolPolicy without guardExtension refuses the spawn (never an ungated session)", async () => {
    const seam = createFakeSeam();
    const { gateway, adapter } = makeGateway({
      seam,
      config: baseConfig({
        fixedMap: { "discord:c1:-": "/repos/proj" },
        toolPolicy: { approval: ["bash"], defaultAction: "deny" },
        // guardExtension deliberately absent
      }),
    });

    await gateway.handleInbound({
      platform: "discord",
      channelId: "c1",
      userId: "u1",
      text: "hi",
      isDM: true,
      startedAt: 0,
    });

    expect(seam.spawns).toHaveLength(0);
    expect(adapter.sent[0].content).toMatch(/guardExtension/i);
  });

  it("V.2/L1: a click from a NON-allowlisted user is refused and does not consume the prompt", async () => {
    const { gateway, seam, adapter } = makeGateway({ store: memoryStore([boundBinding()]) });
    seam.sessions = [{ id: "s1", cwd: "/repos/proj" }];
    adapter.reset();
    await gateway.start();

    gateway.handleFrame("s1", {
      type: "prompt_request",
      sessionId: "s1",
      promptId: "pz",
      prompt: { type: "select", title: "Pick one", options: ["a", "b"] },
    });
    await flush();

    // Intruder sees the buttons in an opted-in group channel and clicks.
    adapter.emitInteractiveResponse({ userId: "intruder", requestId: "pz", value: "b", });
    await flush();
    expect(seam.sentResponses).toEqual([]);

    // The prompt survives; the allowlisted user can still answer it.
    adapter.emitInteractiveResponse({ userId: "u1", requestId: "pz", value: "a", });
    await flush();
    expect(seam.sentResponses).toEqual([
      { sessionId: "s1", response: { promptId: "pz", answer: "a", cancelled: false, source: "discord" } },
    ]);
  });

  it("E12/L2: an allowlisted NON-admin cannot create a binding (admin-only bind)", async () => {
    const seam = createFakeSeam();
    const { gateway, adapter } = makeGateway({
      seam,
      config: baseConfig({
        admins: ["admin1"],
        fixedMap: { "discord:c1:-": "/repos/proj" },
      }),
    });

    await gateway.handleInbound({
      platform: "discord",
      channelId: "c1",
      userId: "u1",
      text: "hi",
      isDM: true,
      startedAt: 0,
    });

    expect(seam.spawns).toHaveLength(0);
    expect(adapter.sent[0].content).toContain("not_admin");
  });

  it("F3: a thread spawn binds the THREAD key (not the parent) and never loops", async () => {
    const seam = createFakeSeam();
    const store = memoryStore();
    const { gateway } = makeGateway({
      seam,
      store,
      config: baseConfig({
        groupChannels: ["c1"],
        fixedMap: { "discord:c1:t9": "/repos/proj" },
      }),
    });
    await gateway.start();

    await gateway.handleInbound({
      platform: "discord",
      channelId: "c1",
      threadId: "t9",
      parentChannelId: "c1",
      userId: "u1",
      text: "hi",
      isDM: false,
      startedAt: 0,
    });
    const spawn = seam.spawns[0];
    expect(spawn).toBeDefined();
    seam.resolveSpawn("sess-thread", spawn.pluginRef ?? {});

    const b = store.get("discord:c1:t9");
    expect(b?.sessionId).toBe("sess-thread");
    expect(b?.threadId).toBe("t9");

    // A follow-up thread message must REUSE the binding, not spawn again.
    seam.sessions = [{ id: "sess-thread", cwd: "/repos/proj" }];
    await gateway.handleInbound({
      platform: "discord",
      channelId: "c1",
      threadId: "t9",
      parentChannelId: "c1",
      userId: "u1",
      text: "again",
      isDM: false,
      startedAt: 0,
    });
    expect(seam.spawns).toHaveLength(1);
    expect(seam.sentPrompts).toEqual([
      { sessionId: "sess-thread", text: "again", delivery: "followUp" },
    ]);
  });

  it("F7: a second message during the spawn window does not start a second session", async () => {
    const seam = createFakeSeam();
    const { gateway, adapter } = makeGateway({
      seam,
      config: baseConfig({ fixedMap: { "discord:c1:-": "/repos/proj" } }),
    });
    await gateway.start();

    const msg = {
      platform: "discord" as const,
      channelId: "c1",
      userId: "u1",
      text: "hi",
      isDM: true,
      startedAt: 0,
    };
    await gateway.handleInbound(msg);
    await gateway.handleInbound({ ...msg, text: "again" });

    expect(seam.spawns).toHaveLength(1);
    expect(adapter.sent.some((m) => m.content.includes("already starting"))).toBe(true);
  });

  it("F4: a restarted gateway re-subscribes persisted bindings", async () => {
    const seam = createFakeSeam();
    seam.sessions = [{ id: "s1", cwd: "/repos/proj" }];
    const { gateway } = makeGateway({ seam, store: memoryStore([boundBinding()]) });
    await gateway.start();
    expect(seam.frameHandlers.has("s1")).toBe(true);
  });

  it("F8: a new assistant turn starts a fresh message (never overwrites the previous reply)", async () => {
    const { gateway, seam, adapter } = makeGateway({ store: memoryStore([boundBinding()]) });
    seam.sessions = [{ id: "s1", cwd: "/repos/proj" }];
    await gateway.start();
    adapter.reset();

    const frame = (text: string) => ({
      type: "event",
      sessionId: "s1",
      seq: 1,
      event: {
        eventType: "message_update",
        timestamp: 0,
        data: { message: { role: "assistant", content: [{ type: "text", text }] } },
      },
    });
    gateway.handleFrame("s1", frame("first reply"));
    await flush();
    gateway.handleFrame("s1", frame("second turn"));
    await flush();

    expect(adapter.sent.map((m) => m.content)).toEqual(["first reply", "second turn"]);
  });
});
