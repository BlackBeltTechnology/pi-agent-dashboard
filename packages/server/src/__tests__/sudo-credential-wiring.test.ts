/**
 * Real server wiring of the sudo credential relay: refuse-immediately (S42),
 * feature advertisement (S43), cache metadata replay (S44), pending replay on
 * subscribe (S84), non-persistence of the password (S72) and log hygiene (S74).
 * A stub hub-local bridge talks to a real `createServer`; browsers are real
 * `/ws` sockets (tier-specific cases use the real gateway loop with fake sockets).
 *
 * See change: add-sudo-credential-prompt (tasks 4.7-4.10, 4.15, 4.16).
 */
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { deliver, makeSudoHarness, OTHER, OWNER, request, sudoFramesOf } from "./helpers/sudo-credential-kit.js";
import { bootSudoRig, type SudoRig } from "./helpers/sudo-server-kit.js";

const req = (sessionId: string, callId: string, extra: Record<string, unknown> = {}) => ({
  type: "sudo_credential_request", sessionId, callId, commands: ["sudo apt update", "ls -la"], prompt: "[sudo] password for me: ", ...extra,
});
const UNANSWERABLE = (sessionId: string, callId: string) => ({ type: "sudo_credential_cancel", sessionId, callId, reason: "unanswerable" });

describe("sudo credential wiring (real server)", () => {
  let rig: SudoRig;
  beforeAll(async () => { rig = await bootSudoRig(); });
  afterAll(async () => { await rig.dispose(); });

  // S43 — D9 server advertise
  it("advertises sudo-credential alongside vault-delivery when the bridge registers", async () => {
    const bridge = await rig.bridge("s-adv");
    const identity = bridge.of("dashboard_identity")[0];
    expect(identity.features).toEqual(expect.arrayContaining(["vault-delivery", "sudo-credential"]));
  });

  // S42 — D9 refuse-immediately
  describe("refuse-immediately", () => {
    it("(a) no subscribed browser owns the session: refused in the same turn, no fan-out, nothing replayed later", async () => {
      const bridge = await rig.bridge("s-a");
      const t0 = Date.now();
      bridge.send(req("s-a", "C1"));
      const cancel = await bridge.waitFor((f) => f.type === "sudo_credential_cancel");
      expect(Date.now() - t0).toBeLessThan(1_000); // far below the 2 000 ms ack deadline: no timer was involved
      expect(cancel).toEqual(UNANSWERABLE("s-a", "C1"));

      const late = await rig.browser("s-a");
      expect(late.of("sudo_credential_request")).toEqual([]);
    });

    it("(b) a remote bridge refused by decideVaultTrust: refused at once even with a subscribed browser", async () => {
      const bridge = await rig.bridge("s-b", { unproven: true });
      const browser = await rig.browser("s-b");
      bridge.send(req("s-b", "C1"));
      const cancel = await bridge.waitFor((f) => f.type === "sudo_credential_cancel");
      expect(cancel).toEqual(UNANSWERABLE("s-b", "C1"));
      expect(browser.of("sudo_credential_request")).toEqual([]);
    });

    it("a second request while one is pending is refused (single slot per session)", async () => {
      const bridge = await rig.bridge("s-slot");
      const browser = await rig.browser("s-slot");
      bridge.send(req("s-slot", "C1"));
      await browser.waitFor((f) => f.type === "sudo_credential_request");
      browser.send({ type: "sudo_credential_shown", sessionId: "s-slot", callId: "C1" });
      bridge.send(req("s-slot", "C2"));
      expect(await bridge.waitFor((f) => f.type === "sudo_credential_cancel")).toEqual(UNANSWERABLE("s-slot", "C2"));
      expect(browser.of("sudo_credential_request").map((f) => f.callId)).toEqual(["C1"]);
    });
  });

  // S44 — D9 cache metadata replay
  describe("cache metadata replay", () => {
    it("(a) a new owner subscriber gets {expiresAt:T}; (c) a closed bridge clears it for everyone, late joiners included", async () => {
      const T = Date.now() + 300_000;
      const bridge = await rig.bridge("s-c");
      const live = await rig.browser("s-c");
      bridge.send({ type: "sudo_credential_cache", sessionId: "s-c", expiresAt: T });
      await live.waitFor((f) => f.type === "sudo_credential_cache" && f.expiresAt === T);

      const joiner = await rig.browser("s-c");
      expect(joiner.of("sudo_credential_cache")).toEqual([{ type: "sudo_credential_cache", sessionId: "s-c", expiresAt: T }]);

      // A pending prompt, acked, then the bridge socket closes.
      bridge.send(req("s-c", "C1"));
      await live.waitFor((f) => f.type === "sudo_credential_request");
      live.send({ type: "sudo_credential_shown", sessionId: "s-c", callId: "C1" });
      bridge.ws.close();
      for (const b of [live, joiner]) {
        await b.waitFor((f) => f.type === "sudo_credential_cache" && f.expiresAt === null);
        await b.waitFor((f) => f.type === "sudo_credential_dismiss" && f.callId === "C1");
      }
      const late = await rig.browser("s-c");
      expect(late.of("sudo_credential_cache")).toEqual([{ type: "sudo_credential_cache", sessionId: "s-c", expiresAt: null }]);
      for (const f of [live.frames, joiner.frames, late.frames].flat().filter((x) => x.type.startsWith("sudo_credential_"))) {
        expect(f).not.toHaveProperty("password");
      }
    });
  });

  // S84 — D9/G10 pending replay on subscribe
  describe("pending replay on subscribe", () => {
    it("(a) a joining owner gets the same request (no password field); (d) after resolution a joiner gets none", async () => {
      const bridge = await rig.bridge("s-r");
      const first = await rig.browser("s-r");
      bridge.send(req("s-r", "C1"));
      await first.waitFor((f) => f.type === "sudo_credential_request");
      first.send({ type: "sudo_credential_shown", sessionId: "s-r", callId: "C1" });

      const joiner = await rig.browser("s-r");
      const replayed = joiner.of("sudo_credential_request");
      expect(replayed).toEqual([{ type: "sudo_credential_request", sessionId: "s-r", callId: "C1", commands: ["sudo apt update", "ls -la"], prompt: "[sudo] password for me: " }]);
      expect(replayed[0]).not.toHaveProperty("password");

      bridge.send({ type: "sudo_credential_dismiss", sessionId: "s-r", callId: "C1" });
      await joiner.waitFor((f) => f.type === "sudo_credential_dismiss");
      const after = await rig.browser("s-r");
      expect(after.of("sudo_credential_request")).toEqual([]);
    });
  });
});

describe("sudo credential replay tiers (real gateway loop)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("(a) a replayed request's _shown counts as an ack and adds no second pending slot", async () => {
    const h = makeSudoHarness();
    const stale = await h.connect({ principal: OWNER, tier: "control" }); // never acks
    h.relay.handleRequest("s1", request("s1", "C1", { commands: ["a", "b"] }));
    vi.advanceTimersByTime(1_000);
    const joiner = await h.connect({ principal: OWNER, tier: "control" });
    expect(sudoFramesOf(joiner)).toEqual([{ type: "sudo_credential_request", sessionId: "s1", callId: "C1", commands: ["a", "b"], prompt: "[sudo] password for me: " }]);
    await deliver(joiner, { type: "sudo_credential_shown", sessionId: "s1", callId: "C1" });
    vi.advanceTimersByTime(10_000);
    const sudoToBridge = () => h.bridgeFrames.map((f) => f.msg).filter((m) => m.type.startsWith("sudo_credential_"));
    expect(sudoToBridge()).toEqual([]); // the replay ack kept it open
    h.relay.handleRequest("s1", request("s1", "C2")); // single slot: refused, not queued
    expect(sudoToBridge()).toEqual([UNANSWERABLE("s1", "C2")]);
    expect(sudoFramesOf(stale).filter((f) => f.type === "sudo_credential_request")).toHaveLength(1);
    h.relay.dispose();
  });

  it("(b) an observe-tier subscriber and (c) a non-owner get neither the request nor cache metadata", async () => {
    const h = makeSudoHarness({ active: true });
    const owner = await h.connect({ principal: OWNER, tier: "control" });
    h.relay.handleCache("s1", { type: "sudo_credential_cache", sessionId: "s1", expiresAt: 123 });
    h.relay.handleRequest("s1", request("s1", "C1"));
    expect(sudoFramesOf(owner).map((f) => f.type)).toEqual(["sudo_credential_cache", "sudo_credential_request"]);

    const observe = await h.connect({ principal: OWNER, tier: "observe" });
    const stranger = await h.connect({ principal: OTHER, tier: "control" });
    expect(sudoFramesOf(observe)).toEqual([]);
    expect(sudoFramesOf(stranger)).toEqual([]);
    h.relay.dispose();
  });
});

describe("sudo credential non-persistence and log hygiene", () => {
  const P = "P-canary-7f3a9c1e-never-persist";
  const CMD = "CMD-canary-echo-secret-command";
  const PROMPT = "PROMPT-canary-[sudo] password for canary: ";
  let logs: string[];
  beforeEach(() => {
    logs = [];
    for (const k of ["log", "error", "warn", "info", "debug"] as const) {
      vi.spyOn(console, k).mockImplementation((...a: unknown[]) => { logs.push(a.map((x) => (x instanceof Error ? x.stack : typeof x === "string" ? x : JSON.stringify(x))).join(" ")); });
    }
  });
  afterEach(() => vi.restoreAllMocks());

  /** Every regular file under `dir` that contains `needle`. */
  function filesContaining(dir: string, needle: string): string[] {
    const hits: string[] = [];
    const walk = (d: string) => {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.isFile()) {
          try { if (fs.readFileSync(full).includes(needle)) hits.push(full); } catch { /* unreadable */ }
        }
      }
    };
    walk(dir);
    return hits;
  }

  // S72 — D6 non-persistence
  it("the answered password is absent from the event store, disk, replay frames, logs and the question store", async () => {
    let rig = await bootSudoRig();
    try {
      const bridge = await rig.bridge("s-np");
      const b1 = await rig.browser("s-np");
      const b2 = await rig.browser("s-np");
      bridge.send(req("s-np", "C1", { commands: [CMD], prompt: PROMPT }));
      await b1.waitFor((f) => f.type === "sudo_credential_request");
      await b2.waitFor((f) => f.type === "sudo_credential_request");
      b1.send({ type: "sudo_credential_shown", sessionId: "s-np", callId: "C1" });
      b1.send({ type: "sudo_credential_response", sessionId: "s-np", callId: "C1", password: P });
      const delivered = await bridge.waitFor((f) => f.type === "sudo_credential_response");
      expect(delivered).toMatchObject({ callId: "C1", password: P }); // the ONE road that carries it
      await b2.waitFor((f) => f.type === "sudo_credential_dismiss");
      bridge.send({ type: "sudo_credential_cache", sessionId: "s-np", expiresAt: Date.now() + 1000 });

      const fresh = await rig.browser("s-np");
      fresh.send({ type: "subscribe", sessionId: "s-np", lastSeq: 0 });
      await new Promise((r) => setTimeout(r, 150));
      rig.server.flush();

      const store = JSON.stringify([rig.server.eventStore.getEvents("s-np", 1), rig.server.sessionManager.listAll()]);
      expect(store).not.toContain(P);
      expect(store).not.toContain("sudo_credential"); // request/cache never stored or replayed as event_forward
      expect(JSON.stringify([b1.frames, b2.frames, fresh.frames])).not.toContain(P);
      expect(fresh.of("sudo_credential_request")).toEqual([]); // resolved prompt is not replayed
      const questions = await rig.server.inject({ method: "GET", url: "/api/questions" });
      expect(questions.body).not.toContain(P);
      expect(filesContaining(os.homedir(), P)).toEqual([]);

      await rig.dispose(); // persistence flush on stop
      expect(filesContaining(os.homedir(), P)).toEqual([]);
      rig = await bootSudoRig(); // restart + reload
      const reloaded = await rig.browser("s-np");
      expect(JSON.stringify(reloaded.frames)).not.toContain(P);
    } finally {
      await rig.dispose().catch(() => {});
    }
    expect(logs.join("\n")).not.toContain(P);
    expect(logs.join("\n")).not.toContain(CMD);
  }, 30_000);

  // S74 — observability
  it("every sudo log line carries only the event name and callId; no command, prompt or password", async () => {
    const rig = await bootSudoRig();
    try {
      const bridge = await rig.bridge("s-log");
      const b = await rig.browser("s-log");
      const asked = (callId: string) => bridge.send(req("s-log", callId, { commands: [CMD], prompt: PROMPT }));

      asked("L1"); // request → answer
      await b.waitFor((f) => f.callId === "L1");
      b.send({ type: "sudo_credential_shown", sessionId: "s-log", callId: "L1" });
      b.send({ type: "sudo_credential_response", sessionId: "s-log", callId: "L1", password: P });
      await bridge.waitFor((f) => f.type === "sudo_credential_response");

      asked("L2"); // request → operator cancel
      await b.waitFor((f) => f.callId === "L2");
      b.send({ type: "sudo_credential_shown", sessionId: "s-log", callId: "L2" });
      b.send({ type: "sudo_credential_cancel", sessionId: "s-log", callId: "L2" });
      await bridge.waitFor((f) => f.type === "sudo_credential_cancel" && f.callId === "L2");

      asked("L3"); // request → bridge dismiss
      await b.waitFor((f) => f.callId === "L3");
      bridge.send({ type: "sudo_credential_dismiss", sessionId: "s-log", callId: "L3" });
      await b.waitFor((f) => f.type === "sudo_credential_dismiss" && f.callId === "L3");

      bridge.send({ type: "sudo_credential_cache", sessionId: "s-log", expiresAt: 42 });
      await b.waitFor((f) => f.type === "sudo_credential_cache");
      b.send({ type: "sudo_credential_forget", sessionId: "s-log" });
      await bridge.waitFor((f) => f.type === "sudo_credential_forget");

      // Error paths: malformed request, wrong password type, refusal with no audience.
      bridge.send({ type: "sudo_credential_request", sessionId: "s-log", callId: "bad id!", commands: [CMD], prompt: PROMPT });
      b.send({ type: "sudo_credential_response", sessionId: "s-log", callId: "L1", password: P });
      const lone = await rig.bridge("s-log2");
      lone.send(req("s-log2", "L4", { commands: [CMD], prompt: PROMPT }));
      await lone.waitFor((f) => f.type === "sudo_credential_cancel");
    } finally {
      await rig.dispose();
    }
    const sudoLines = logs.filter((l) => l.includes("[sudo-credential]"));
    expect(sudoLines.length).toBeGreaterThan(5);
    for (const line of sudoLines) {
      expect(line).toMatch(/^\[sudo-credential\] [a-z-]+( cause=[a-z-]+)?( callId=[\w+/=.-]+)?$/);
    }
    const all = logs.join("\n");
    for (const secret of [P, CMD, PROMPT]) expect(all).not.toContain(secret);
  }, 30_000);
});
