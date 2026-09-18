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
import { createSpawnCorrelator } from "../routing.js";
import type { BindingStore } from "../routing.js";
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

    expect(seam.sentPrompts).toEqual([]);
    expect(adapter.sent[0].content).toContain("group_channel_not_opted_in");
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

    adapter.emitInteractiveResponse({ requestId: "p1", value: "b" });
    await flush();

    expect(seam.sentResponses).toEqual([
      { sessionId: "s1", response: { promptId: "p1", answer: "b", cancelled: false, source: "discord" } },
    ]);
  });
});
