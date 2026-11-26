/**
 * Guard readiness handshake (harden-agent-tool-guards D6): a guarded chat spawn holds the triggering
 * message back and delivers it through `send_prompt` only once the guard announced readiness with the
 * spawn's own token from the session the spawn resolved to; otherwise the session is ended and the
 * message never reaches it. Rows T.41–T.50, T.97, T.123–T.128, T.132, T.133
 * (test-plan #E41–#E50, #P6, #X15–#X20, #X25, #X26).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordingAdapter } from "../../adapters/__tests__/recording-adapter.js";
import type { Binding } from "../../shared/types.js";
import { resolveConfig } from "../config.js";
import { createChatGateway } from "../gateway.js";
import type { BindingStore } from "../routing.js";
import { createSpawnCorrelator } from "../routing.js";
import { createFakeSeam, type FakeSeam } from "./fake-seam.js";

const T = 30_000;
const ALREADY = "A session is already starting for this channel — one moment.";
const REFUSED = "session refused: its tool guard did not start";

function memoryStore(seed: Binding[] = []): BindingStore & { removed: string[] } {
  const m = new Map<string, Binding>();
  const key = (b: Binding) => `${b.platform}:${b.channelId}:${b.threadId ?? "-"}`;
  for (const b of seed) m.set(key(b), b);
  return {
    removed: [],
    load: () => {},
    get: (k) => m.get(k),
    set: (b) => void m.set(key(b), b),
    remove(k) {
      this.removed.push(k);
      m.delete(k);
    },
    all: () => [...m.values()],
    persist: () => {},
  };
}

const cfg = (over: Record<string, unknown> = {}) =>
  resolveConfig({
    token: "t",
    allowlist: ["u1"],
    admins: ["u1"],
    groupChannels: [],
    allowedRoots: ["/repos"],
    editThrottleMs: 0,
    defaultCwd: "/repos/proj",
    toolPolicy: { allow: ["read"], approval: ["bash"], defaultAction: "deny" },
    guardExtension: "chat-gateway-guard",
    ...over,
  });

function setup(over: { config?: Record<string, unknown>; seam?: FakeSeam; store?: ReturnType<typeof memoryStore>; ms?: number; team?: unknown } = {}) {
  const seam = over.seam ?? createFakeSeam();
  const adapter = new RecordingAdapter();
  const store = over.store ?? memoryStore();
  const mk = () =>
    createChatGateway({
      platform: "discord",
      seam,
      adapter,
      config: cfg(over.config),
      store,
      correlator: createSpawnCorrelator(),
      now: () => 1_000,
      ...(over.team ? { team: over.team as never } : {}),
      ...(over.ms ? { guardReadyTimeoutMs: over.ms } : {}),
    });
  const gateway = mk();
  const say = (text: string, channelId = "c1") =>
    gateway.handleInbound({ platform: "discord", channelId, userId: "u1", text, isDM: true, startedAt: 0 } as never);
  /** The latest spawn's correlation (also the readiness) token and ref. */
  const lastSpawn = () => {
    const sp = seam.spawns[seam.spawns.length - 1];
    return { sp, token: sp.pluginRef?.chatSpawnToken as string, ref: sp.pluginRef as Record<string, unknown> };
  };
  const resolve = (sessionId: string, live = true) => {
    const { ref } = lastSpawn();
    if (live) seam.sessions = [...seam.sessions.filter((s) => s.id !== sessionId), { id: sessionId, cwd: "/repos/proj" }];
    seam.resolveSpawn(sessionId, ref);
  };
  const settle = () => vi.advanceTimersByTimeAsync(0);
  const prompts = () => seam.sentPrompts.map((p) => p.text);
  const said = () => adapter.sent.map((m) => m.content);
  return { seam, adapter, store, gateway, mk, say, lastSpawn, resolve, settle, prompts, said };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("T.47 spawn configuration", () => {
  it("no toolPolicy → today's behaviour: initialPrompt, no extensions, no readiness wait", async () => {
    const h = setup({ config: { toolPolicy: undefined, guardExtension: undefined } });
    await h.gateway.start();
    await h.say("hi");
    expect(h.seam.spawns[0]).toMatchObject({ initialPrompt: "hi" });
    expect(h.seam.spawns[0].extensions).toBeUndefined();
    expect(h.seam.spawns[0].extensionConfig).toBeUndefined();
    h.resolve("S");
    expect(h.store.get("discord:c1:-")?.sessionId).toBe("S"); // bound at resolution, as before
    expect(vi.getTimerCount()).toBe(0);
  });

  it("policy without a guard → spawn refused", async () => {
    const h = setup({ config: { guardExtension: undefined } });
    await h.say("hi");
    expect(h.seam.spawns).toHaveLength(0);
  });

  it("policy + guard → initialPrompt held back, guard extension + policy + token delivered", async () => {
    const h = setup();
    await h.gateway.start();
    await h.say("hi");
    const sp = h.seam.spawns[0];
    expect(sp.initialPrompt).toBeUndefined();
    expect(sp.extensions).toEqual(["chat-gateway-guard"]);
    const ec = sp.extensionConfig?.["chat-gateway-guard"];
    expect(JSON.parse(String(ec?.policy))).toMatchObject({ defaultAction: "deny" });
    expect(ec?.token).toBe(sp.pluginRef?.chatSpawnToken);
  });
});

describe("T.41 readiness window boundary", () => {
  it("ready at T-1 delivers the stripped text once; at T refused; at T+1 refused and ignored", async () => {
    for (const [at, delivered] of [[T - 1, true], [T, false], [T + 1, false]] as const) {
      const h = setup();
      await h.gateway.start();
      await h.say("hello world");
      const { token } = h.lastSpawn();
      h.resolve("S");
      await vi.advanceTimersByTimeAsync(at);
      h.seam.emitGuardReady("S", token);
      await h.settle();
      await vi.advanceTimersByTimeAsync(T * 2);
      expect(h.prompts(), `at ${at}`).toEqual(delivered ? ["hello world"] : []);
      expect(h.seam.shutdowns, `at ${at}`).toEqual(delivered ? [] : ["S"]);
      if (!delivered) expect(h.said()).toContain(REFUSED);
      await h.gateway.stop();
    }
  });
});

describe("T.42 / T.43 one pending spawn per channel", () => {
  it("a second message while awaiting readiness is refused, not queued", async () => {
    const h = setup();
    await h.gateway.start();
    await h.say("one");
    await h.say("two");
    expect(h.said()).toContain(ALREADY);
    expect(h.seam.spawns).toHaveLength(1);
    expect(h.store.get("discord:c1:-")).toBeUndefined(); // nothing persisted before release
    h.resolve("S");
    expect(h.store.get("discord:c1:-")).toBeUndefined(); // resolved but not ready: still unbound
    h.seam.emitGuardReady("S", h.lastSpawn().token);
    await h.settle();
    expect(h.prompts()).toEqual(["one"]);
  });

  it("a message after ready but before #1 is delivered is refused; a later one is a normal follow-up", async () => {
    const h = setup();
    await h.gateway.start();
    let release: (v: boolean) => void = () => {};
    const real = h.seam.sendPrompt.bind(h.seam);
    h.seam.sendPrompt = ((id: string, text: string, d: "followUp" | "steer") =>
      text === "one" ? new Promise<boolean>((r) => (release = (v) => r(v && real(id, text, d)))) : real(id, text, d)) as never;
    await h.say("one");
    h.resolve("S");
    h.seam.emitGuardReady("S", h.lastSpawn().token);
    await h.settle();
    await h.say("two"); // #1's send_prompt has not settled
    expect(h.said()).toContain(ALREADY);
    release(true);
    await h.settle();
    expect(h.prompts()).toEqual(["one"]);
    await h.say("three");
    await h.settle();
    expect(h.prompts()).toEqual(["one", "three"]);
    expect(h.seam.spawns).toHaveLength(1);
  });
});

describe("T.44 who may release: token × sender × order × message shape", () => {
  const go = async () => {
    const h = setup();
    await h.gateway.start();
    await h.say("hi");
    return h;
  };
  it("a) resolved S, then own token from S → released", async () => {
    const h = await go();
    h.resolve("S");
    h.seam.emitGuardReady("S", h.lastSpawn().token);
    await h.settle();
    expect(h.prompts()).toEqual(["hi"]);
  });
  it("b) own token from S BEFORE the resolution → released at resolution", async () => {
    const h = await go();
    h.seam.sessions = [{ id: "S", cwd: "/repos/proj" }];
    h.seam.emitGuardReady("S", h.lastSpawn().token);
    await h.settle();
    expect(h.prompts()).toEqual([]);
    h.resolve("S");
    await h.settle();
    expect(h.prompts()).toEqual(["hi"]);
  });
  it("d/e) own token from ANOTHER session T → nothing, before or after resolution", async () => {
    const h = await go();
    h.seam.sessions = [{ id: "S", cwd: "/repos/proj" }, { id: "T", cwd: "/repos/proj" }];
    h.seam.emitGuardReady("T", h.lastSpawn().token);
    h.resolve("S");
    h.seam.emitGuardReady("T", h.lastSpawn().token);
    await h.settle();
    expect(h.prompts()).toEqual([]);
    expect(h.said()).not.toContain(REFUSED); // still Waiting
    expect(h.store.get("discord:c1:-")).toBeUndefined();
  });
  it("f) another spawn's token from S → nothing for this spawn", async () => {
    const h = await go();
    const own = h.lastSpawn();
    await h.say("other", "c2"); // second spawn with its own token
    const otherToken = h.lastSpawn().token;
    expect(otherToken).not.toBe(own.token);
    h.seam.sessions = [{ id: "S", cwd: "/repos/proj" }];
    h.seam.resolveSpawn("S", own.ref);
    h.seam.emitGuardReady("S", otherToken);
    await h.settle();
    expect(h.prompts()).toEqual([]);
  });
  it("g) absent / empty token, wrong messageType or pluginId → nothing", async () => {
    const h = await go();
    h.resolve("S");
    const { token } = h.lastSpawn();
    h.seam.emitGuardReady("S", undefined);
    h.seam.emitGuardReady("S", "");
    h.seam.emitGuardReady("S", 42);
    h.seam.emitGuardReady("S", token, { messageType: "something_else" });
    h.seam.emitGuardReady("S", token, { pluginId: "team" });
    await h.settle();
    expect(h.prompts()).toEqual([]);
  });
});

describe("T.45 / T.46 / T.128 idempotence and late announcements", () => {
  it("ready delivered twice (and again after a repeat resolution) sends once", async () => {
    const h = setup();
    await h.gateway.start();
    await h.say("hi");
    const { token, ref } = h.lastSpawn();
    h.resolve("S");
    h.seam.emitGuardReady("S", token);
    h.seam.emitGuardReady("S", token);
    h.seam.resolveSpawn("S", ref);
    h.seam.emitGuardReady("S", token);
    await h.settle();
    expect(h.prompts()).toEqual(["hi"]);
  });

  it("T.46/T.128 after the timeout a late ready is ignored: one shutdown, no prompt, no binding", async () => {
    const h = setup();
    await h.gateway.start();
    await h.say("hi");
    const { token } = h.lastSpawn();
    h.resolve("S");
    await vi.advanceTimersByTimeAsync(T);
    expect(h.seam.shutdowns).toEqual(["S"]);
    h.seam.emitGuardReady("S", token);
    await vi.advanceTimersByTimeAsync(T);
    expect(h.seam.shutdowns).toEqual(["S"]);
    expect(h.prompts()).toEqual([]);
    expect(h.store.get("discord:c1:-")).toBeUndefined();
    await h.say("again"); // the channel is free: a new spawn starts
    expect(h.seam.spawns).toHaveLength(2);
  });
});

describe("T.48 host capability", () => {
  it("guard configured but the host cannot deliver plugin messages → refused, nothing spawned, one error log", async () => {
    const seam = createFakeSeam();
    seam.guardReadySupported = false;
    const log = vi.fn();
    seam.log = log;
    const h = setup({ seam });
    await h.say("hi");
    expect(seam.spawns).toHaveLength(0);
    expect(h.said().join("\n")).toMatch(/cannot verify the tool guard/);
    expect(log.mock.calls.filter((c) => c[0] === "error")).toHaveLength(1);
  });
  it("no guard configured on the same host spawns as today", async () => {
    const seam = createFakeSeam();
    seam.guardReadySupported = false;
    const h = setup({ seam, config: { toolPolicy: undefined, guardExtension: undefined } });
    await h.say("hi");
    expect(seam.spawns).toHaveLength(1);
  });
  it("T.126 a registration that throws is an unsupported host: refused", async () => {
    const seam = createFakeSeam();
    seam.guardReadyThrows = true;
    const h = setup({ seam });
    await h.say("hi");
    expect(seam.spawns).toHaveLength(0);
  });
});

describe("T.49 / T.50 attach and follow-ups", () => {
  it("an attached session is never gated: no readiness wait, no guard extension", async () => {
    const h = setup({ config: { defaultCwd: undefined } });
    h.seam.sessions = [{ id: "S1", cwd: "/repos/proj" }];
    await h.gateway.start();
    await h.say("hello attach");
    expect(h.seam.spawns).toHaveLength(0);
    expect(h.prompts()).toEqual(["hello attach"]);
  });
  it("a spawned session: follow-up goes through send_prompt, never a second spawn", async () => {
    const h = setup();
    await h.gateway.start();
    await h.say("first");
    h.resolve("S");
    h.seam.emitGuardReady("S", h.lastSpawn().token);
    await h.settle();
    await h.say("second");
    await h.settle();
    expect(h.prompts()).toEqual(["first", "second"]);
    expect(h.seam.spawns).toHaveLength(1);
  });
});

describe("T.123 / T.124 timeout paths", () => {
  it("ready at T-1: nothing is shut down later and the timer is gone", async () => {
    const h = setup();
    await h.gateway.start();
    await h.say("hi");
    h.resolve("S");
    await vi.advanceTimersByTimeAsync(T - 1);
    h.seam.emitGuardReady("S", h.lastSpawn().token);
    await vi.advanceTimersByTimeAsync(T * 5);
    expect(h.seam.shutdowns).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("never announces and shutdownSession throws: user told, nothing bound, error logged, no prompt", async () => {
    const h = setup();
    const log = vi.fn();
    h.seam.log = log;
    h.seam.shutdownSession = async () => {
      throw new Error("boom");
    };
    await h.gateway.start();
    await h.say("hi");
    h.resolve("S");
    await vi.advanceTimersByTimeAsync(T);
    expect(h.said()).toContain(REFUSED);
    expect(h.store.get("discord:c1:-")).toBeUndefined();
    expect(h.prompts()).toEqual([]);
    expect(log.mock.calls.filter((c) => c[0] === "error").length).toBeGreaterThanOrEqual(1);
  });
  it("a spawn that resolves only AFTER the refusal is shut down at resolution, never bound", async () => {
    const h = setup();
    await h.gateway.start();
    await h.say("hi");
    await vi.advanceTimersByTimeAsync(T); // never resolved, never announced
    expect(h.said()).toContain(REFUSED);
    h.resolve("S");
    await h.settle();
    expect(h.seam.shutdowns).toEqual(["S"]);
    expect(h.store.get("discord:c1:-")).toBeUndefined();
  });
});

describe("T.125 sendPrompt failure after readiness", () => {
  it("replies 'message not delivered', keeps the binding and the session, frees the channel", async () => {
    const h = setup();
    await h.gateway.start();
    await h.say("hi");
    h.resolve("S");
    h.seam.sendPromptThrows = true;
    h.seam.emitGuardReady("S", h.lastSpawn().token);
    await h.settle();
    expect(h.said()).toContain("message not delivered");
    expect(h.store.get("discord:c1:-")?.sessionId).toBe("S");
    expect(h.seam.shutdowns).toEqual([]);
    expect(h.seam.spawns).toHaveLength(1);
    h.seam.sendPromptThrows = false;
    await h.say("retry");
    await h.settle();
    expect(h.prompts()).toEqual(["retry"]);
  });
});

describe("T.126 failed spawn leaves nothing behind", () => {
  it("spawn {success:false}: no binding, no pending, no timer", async () => {
    const h = setup();
    h.seam.spawnResult = { success: false, message: "nope" };
    await h.gateway.start();
    await h.say("hi");
    expect(h.store.get("discord:c1:-")).toBeUndefined();
    expect(h.gateway.status().pendingSpawns).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("T.127 gateway restart while awaiting readiness", () => {
  it("the new gateway has no pending entry, ignores the orphan, and the next message spawns anew", async () => {
    const h = setup();
    await h.gateway.start();
    await h.say("hi");
    const { token } = h.lastSpawn();
    h.resolve("S");
    await h.gateway.stop();
    const g2 = h.mk();
    await g2.start();
    expect(g2.status().pendingSpawns).toBe(0);
    h.seam.emitGuardReady("S", token);
    await h.settle();
    expect(h.prompts()).toEqual([]);
    expect(h.store.get("discord:c1:-")).toBeUndefined();
    await g2.handleInbound({ platform: "discord", channelId: "c1", userId: "u1", text: "next", isDM: true, startedAt: 0 } as never);
    expect(h.seam.spawns).toHaveLength(2);
  });
});

describe("T.132 / T.133 resume follows the same rule", () => {
  const seed = (): Binding => ({
    platform: "discord",
    channelId: "c1",
    sessionId: "old",
    cwd: "/repos/proj",
    boundBy: "u1",
    source: "spawn",
    isDM: true,
    createdAt: 1,
  });
  it("initialPrompt absent, gated by readiness; an announcement from the ENDED session's id is ignored", async () => {
    const store = memoryStore([seed()]);
    const h = setup({ store });
    h.seam.endedSessions = [{ id: "old", status: "ended", sessionFile: "/s/f.jsonl", cwd: "/repos/proj" }];
    await h.gateway.start();
    await h.say("continue please");
    const { sp, token } = h.lastSpawn();
    expect(sp.resume).toEqual({ sessionFile: "/s/f.jsonl" });
    expect(sp.initialPrompt).toBeUndefined();
    h.seam.sessions = [{ id: "old", cwd: "/repos/proj" }];
    h.seam.emitGuardReady("old", token); // the ended session's id, even with the token
    h.resolve("S2");
    await h.settle();
    expect(h.prompts()).toEqual([]);
    h.seam.emitGuardReady("S2", token);
    await h.settle();
    expect(h.prompts()).toEqual(["continue please"]);
  });
  it("a second message while the resume awaits readiness is refused (the old binding does not route it)", async () => {
    const h = setup({ store: memoryStore([seed()]) });
    h.seam.endedSessions = [{ id: "old", status: "ended", sessionFile: "/s/f.jsonl", cwd: "/repos/proj" }];
    await h.gateway.start();
    await h.say("one");
    await h.say("two");
    expect(h.said()).toContain(ALREADY);
    expect(h.seam.spawns).toHaveLength(1);
  });
});

describe("T.97 soak: ready spawns leave no timers or entries", () => {
  it("1000 guarded spawns that all become ready, clock advanced 10×T", async () => {
    const h = setup();
    await h.gateway.start();
    for (let i = 0; i < 1000; i++) {
      await h.say(`m${i}`, `c${i}`);
      const { token, ref } = h.lastSpawn();
      h.seam.sessions.push({ id: `S${i}`, cwd: "/repos/proj" });
      h.seam.resolveSpawn(`S${i}`, ref);
      h.seam.emitGuardReady(`S${i}`, token);
    }
    await vi.advanceTimersByTimeAsync(10 * T);
    expect(h.seam.shutdowns).toEqual([]);
    expect(h.seam.sentPrompts).toHaveLength(1000);
    expect(vi.getTimerCount()).toBe(0);
    expect(h.gateway.status().pendingSpawns).toBe(0);
  }, 60_000);
});

describe("review: release re-authorizes, and a stopped gateway releases nothing", () => {
  it("a `!disarm` while the spawn waits: the held message is not delivered, the session ends, the user is told", async () => {
    let disarmed = false;
    const team = {
      authorizeRequest: () => (disarmed ? { kind: "refusal", reason: "disarmed" } : { kind: "grant" }),
      isDisarmed: () => disarmed,
      bindingFor: () => undefined,
      boundChannelIds: () => [],
      mirrorLevel: () => "off",
      noteMirror: () => {},
      attempts: () => [],
    };
    const h = setup({ team });
    await h.gateway.start();
    await h.say("hello");
    const { token } = h.lastSpawn();
    h.resolve("S");
    disarmed = true; // the operator disarms inside the readiness window
    h.seam.emitGuardReady("S", token);
    await h.settle();
    expect(h.prompts()).toEqual([]);
    expect(h.seam.shutdowns).toEqual(["S"]);
    expect(h.said()).toContain("Refused: disarmed.");
    expect(h.store.get("discord:c1:-")).toBeUndefined();
  });

  it("the release re-check carries the spawn cwd: a workspace change during the wait refuses the release", async () => {
    let scope = "/repos";
    const seen: Array<string | undefined> = [];
    const team = {
      authorizeRequest: (i: { targetCwd?: string }) => {
        seen.push(i.targetCwd);
        return i.targetCwd !== undefined && !i.targetCwd.startsWith(scope) ? { kind: "refusal", reason: "path_outside_scope" } : { kind: "grant" };
      },
      isDisarmed: () => false,
      bindingFor: () => undefined,
      boundChannelIds: () => [],
      mirrorLevel: () => "off",
      noteMirror: () => {},
      attempts: () => [],
    };
    const h = setup({ team });
    await h.gateway.start();
    await h.say("hello");
    h.resolve("S");
    scope = "/elsewhere"; // the binding's workspace moved while the guard was starting
    h.seam.emitGuardReady("S", h.lastSpawn().token);
    await h.settle();
    expect(seen.at(-1)).toBe("/repos/proj");
    expect(h.prompts()).toEqual([]);
    expect(h.seam.shutdowns).toEqual(["S"]);
  });

  it("still armed at release: delivers once (the re-check is a no-op)", async () => {
    const team = {
      authorizeRequest: () => ({ kind: "grant" }),
      isDisarmed: () => false,
      bindingFor: () => undefined,
      boundChannelIds: () => [],
      mirrorLevel: () => "off",
      noteMirror: () => {},
      attempts: () => [],
    };
    const h = setup({ team });
    await h.gateway.start();
    await h.say("hello");
    h.resolve("S");
    h.seam.emitGuardReady("S", h.lastSpawn().token);
    await h.settle();
    expect(h.prompts()).toEqual(["hello"]);
  });

  it("stop() while the spawn call is pending: no timer is armed and nothing is delivered afterwards", async () => {
    const h = setup();
    await h.gateway.start();
    let finish: (v: { success: true }) => void = () => {};
    h.seam.spawn = (() => new Promise((r) => (finish = r as never))) as never;
    const saying = h.say("hello");
    await h.settle();
    await h.gateway.stop();
    finish({ success: true });
    await saying;
    await h.settle();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(T * 2);
    expect(h.seam.shutdowns).toEqual([]);
    expect(h.said()).not.toContain(REFUSED);
  });
});
