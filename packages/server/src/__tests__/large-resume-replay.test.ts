/**
 * Regression + behaviour suite for `fix-large-session-resume-replay`
 * (issues #928 / #929). Real server, real sockets; the replay idle/cap/keepalive
 * durations are shortened through the `replayTimings` createServer seam where a
 * scenario is marked *(seam)* in test-plan.md.
 *
 * Seeded from `openspec/changes/fix-large-session-resume-replay/spike/`.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { createServer, type DashboardServer } from "../server.js";
import { proofWebSocket } from "../test-support/local-credential-stamp.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function openBridge(piPort: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${piPort}`);
    ws.on("error", reject);
    ws.on("open", () => resolve(ws));
  });
}

interface BrowserHandle { ws: WebSocket; msgs: any[] }

function openBrowser(port: number): Promise<BrowserHandle> {
  return new Promise((resolve) => {
    const ws = proofWebSocket(`ws://127.0.0.1:${port}/ws`);
    const msgs: any[] = [];
    ws.on("message", (raw) => {
      try { msgs.push(JSON.parse(raw.toString())); } catch { /* ignore */ }
    });
    ws.on("open", () => setTimeout(() => resolve({ ws, msgs }), 30));
  });
}

const send = (ws: WebSocket, m: unknown) => ws.send(JSON.stringify(m));

const writeEv = (sid: string, change: string, replay?: true) => ({
  type: "event_forward",
  sessionId: sid,
  ...(replay ? { replay } : {}),
  event: {
    eventType: "tool_execution_start",
    timestamp: Date.now(),
    data: { toolName: "Write", toolCallId: `c-${change}`, args: { path: `openspec/changes/${change}/proposal.md` } },
  },
});

const filler = (sid: string, i: number, replay?: true) => ({
  type: "event_forward",
  sessionId: sid,
  ...(replay ? { replay } : {}),
  event: {
    eventType: "message_end",
    timestamp: Date.now(),
    data: { message: { role: "user", content: [{ type: "text", text: `msg ${i}` }] } },
  },
});

/** Unique-text event the replay compactor cannot fold away. */
const unique = (sid: string, i: number, replay?: true) => filler(sid, i, replay);

const agentEnd = (sid: string, replay?: true) => ({
  type: "event_forward",
  sessionId: sid,
  ...(replay ? { replay } : {}),
  event: { eventType: "agent_end", timestamp: Date.now(), data: {} },
});

const replayCount = (msgs: any[]) => msgs.filter((m) => m.type === "event_replay");

describe("fix-large-session-resume-replay — regression seed", () => {
  let server: DashboardServer;
  let piPort: number;
  let port: number;
  const open: WebSocket[] = [];

  beforeEach(async () => {
    server = await createServer({
      port: 0, piPort: 0, host: "127.0.0.1", dev: true, autoShutdown: false,
      shutdownIdleSeconds: 999, tunnel: false,
    });
    await server.start();
    port = server.httpPort()!;
    piPort = server.piPort()!;
  });

  afterEach(async () => {
    for (const w of open) w.close();
    open.length = 0;
    await server.stop();
  });

  // test-plan #E2 (spike S1b)
  it("E2: an unmarked replay streaming for >5 s never raises pendingReplaceProposal", async () => {
    const b = await openBridge(piPort); open.push(b);
    send(b, { type: "session_register", sessionId: "e2", cwd: "/tmp", source: "cli", eventCount: 2 });
    await wait(50);
    server.sessionManager.update("e2", { name: "custom", attachedProposal: "change-a" } as any);
    const { ws: br, msgs } = await openBrowser(port); open.push(br);
    for (let i = 0; i < 13; i++) { send(b, filler("e2", i)); await wait(450); }
    send(b, writeEv("e2", "change-b"));
    await wait(150);
    send(b, { type: "replay_complete", sessionId: "e2" });
    await wait(150);
    const s = server.sessionManager.get("e2") as any;
    expect(s?.pendingReplaceProposal ?? null).toBeNull();
    expect(msgs.some((m) => m.type === "session_updated" && m.updates?.pendingReplaceProposal === "change-b")).toBe(false);
  }, 20_000);

  // test-plan #E7 (spike S2)
  it("E7: a stale timer from an earlier register does not end a later replay", async () => {
    const b = await openBridge(piPort); open.push(b);
    send(b, { type: "session_register", sessionId: "e7", cwd: "/tmp", source: "cli" });
    await wait(50);
    send(b, { type: "replay_complete", sessionId: "e7" });
    server.sessionManager.update("e7", { name: "custom", attachedProposal: "change-a" } as any);
    await wait(4_000);
    send(b, { type: "session_register", sessionId: "e7", cwd: "/tmp", source: "cli" });
    await wait(1_300);
    send(b, writeEv("e7", "change-b"));
    await wait(150);
    const s = server.sessionManager.get("e7") as any;
    expect(s?.pendingReplaceProposal ?? null).toBeNull();
  }, 20_000);

  // test-plan #E21 (spike S3)
  it("E21: the replay-exit flush is windowed (one reset, one history_window, frames <= window)", async () => {
    await server.stop();
    server = await createServer({
      port: 0, piPort: 0, host: "127.0.0.1", dev: true, autoShutdown: false,
      shutdownIdleSeconds: 999, tunnel: false, maxReplayEvents: 2000,
    });
    await server.start();
    port = server.httpPort()!; piPort = server.piPort()!;
    const N = 3_000;
    const b = await openBridge(piPort); open.push(b);
    const { ws: br, msgs } = await openBrowser(port); open.push(br);
    send(b, { type: "session_register", sessionId: "e21", cwd: "/tmp", source: "cli", eventCount: N });
    await wait(50);
    send(br, { type: "subscribe", sessionId: "e21" });
    await wait(100);
    msgs.length = 0;
    for (let i = 0; i < N; i++) send(b, unique("e21", i));
    send(b, { type: "replay_complete", sessionId: "e21" });
    await wait(2_000);
    const replays = replayCount(msgs);
    expect(msgs.filter((m) => m.type === "session_state_reset").length).toBe(1);
    expect(msgs.filter((m) => m.type === "history_window").length).toBe(1);
    expect(Math.max(...replays.map((m) => m.events.length))).toBeLessThanOrEqual(2000);
    expect(replays[replays.length - 1].isLast).toBe(true);
  }, 20_000);

  // test-plan #X1 (spike S5)
  it("X1: a register supersedes an in-flight cold hydration", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "resume-race-"));
    const file = path.join(dir, "x1.jsonl");
    const E = 20_000;
    const out: string[] = [JSON.stringify({ type: "session", id: "x1", cwd: dir, version: 3, timestamp: new Date().toISOString() })];
    let parent: string | null = null;
    for (let i = 0; i < E; i++) {
      const id = `e${i}`;
      out.push(JSON.stringify({ type: "message", id, parentId: parent, timestamp: new Date().toISOString(), message: { role: "user", content: [{ type: "text", text: `t${i} `.repeat(20) }] } }));
      parent = id;
    }
    writeFileSync(file, `${out.join("\n")}\n`);
    server.sessionManager.register({ id: "x1", cwd: dir, sessionFile: file, source: "terminal" } as any);
    server.sessionManager.update("x1", { status: "ended" } as any);
    const { ws: br } = await openBrowser(port); open.push(br);
    send(br, { type: "subscribe", sessionId: "x1" });
    await wait(20);
    const b = await openBridge(piPort); open.push(b);
    send(b, { type: "session_register", sessionId: "x1", cwd: dir, source: "cli", sessionFile: file, eventCount: E });
    for (let i = 0; i < 50; i++) send(b, filler("x1", i, true));
    send(b, { type: "replay_complete", sessionId: "x1" });
    await wait(4_000);
    expect(server.eventStore.getEvents("x1", 1).length).toBe(50);
  }, 30_000);
});


// ── Shared fixtures for the replay-mode / flush scenarios ────────────────────

/** Replay timing seam: idle 250 ms, cap 1.5 s, waiting-subscriber keepalive 50 ms. */
const SEAM = { idleMs: 250, capMs: 1500, keepaliveMs: 50 };

interface Ctx {
  server: DashboardServer;
  piPort: number;
  port: number;
  open: WebSocket[];
}

async function boot(extra: Record<string, unknown> = {}): Promise<Ctx> {
  const server = await createServer({
    port: 0, piPort: 0, host: "127.0.0.1", dev: true, autoShutdown: false,
    shutdownIdleSeconds: 999, tunnel: false, replayTimings: SEAM, ...extra,
  });
  await server.start();
  return { server, piPort: server.piPort()!, port: server.httpPort()!, open: [] };
}

async function shutdown(c: Ctx | undefined): Promise<void> {
  if (!c) return;
  for (const w of c.open) w.close();
  await c.server.stop();
}

const register = (b: WebSocket, sid: string, extra: Record<string, unknown> = {}) =>
  send(b, { type: "session_register", sessionId: sid, cwd: "/tmp", source: "cli", ...extra });
const replayComplete = (b: WebSocket, sid: string) => send(b, { type: "replay_complete", sessionId: sid });
const agentStart = (sid: string, replay?: true) => ({
  type: "event_forward", sessionId: sid, ...(replay ? { replay } : {}),
  event: { eventType: "agent_start", timestamp: Date.now(), data: {} },
});
const storeCount = (c: Ctx, sid: string) => c.server.eventStore.getEvents(sid, 1).length;
const resets = (msgs: any[]) => msgs.filter((m) => m.type === "session_state_reset").length;
const liveEvents = (msgs: any[]) => msgs.filter((m) => m.type === "event");
const eventsIn = (msgs: any[]) => replayCount(msgs).reduce((n, m) => n + m.events.length, 0);

/** Poll until `pred` holds (or fail after `ms`). */
async function until(pred: () => boolean, ms = 5_000): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error("until: condition not met");
    await wait(15);
  }
}

/** Write a linear transcript of `n` entries; the last id is `leafId` (default `e<n-1>`). `noIds` ⇒ no entry has an id. */
function writeTranscript(
  dir: string,
  sid: string,
  n: number,
  opts: { leafId?: string; noIds?: boolean } = {},
): { file: string; leaf: string | undefined } {
  const file = path.join(dir, `${sid}.jsonl`);
  const lines: unknown[] = [{ type: "session", id: sid, cwd: dir, version: 3, timestamp: new Date().toISOString() }];
  let parent: string | null = null;
  let leaf: string | undefined;
  for (let i = 0; i < n; i++) {
    const entry: Record<string, unknown> = {
      type: "message",
      timestamp: new Date().toISOString(),
      message: {
        role: i % 2 ? "assistant" : "user",
        content: [{ type: "text", text: `t${i}` }],
        ...(i % 2 ? { usage: {}, model: "m", provider: "p", stopReason: "stop" } : {}),
      },
    };
    if (!opts.noIds) {
      const id = i === n - 1 && opts.leafId ? opts.leafId : `e${i}`;
      entry.id = id;
      entry.parentId = parent;
      parent = id;
      leaf = id;
    }
    lines.push(entry);
  }
  writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
  return { file, leaf };
}

describe("fix-large-session-resume-replay — replay mode, exits and flush", () => {
  let c: Ctx;
  afterEach(async () => {
    vi.restoreAllMocks();
    await shutdown(c);
  });

  const bridge = async () => { const b = await openBridge(c.piPort); c.open.push(b); return b; };
  const browser = async () => { const h = await openBrowser(c.port); c.open.push(h.ws); return h; };

  // test-plan #E1 — marked events after the replay exited are still replayed.
  // The push `fanout` spy of the plan is covered by the unread assertion: both
  // sit behind `stampUnreadIfTriggered`, which E4 proves is reachable for live events.
  it("E1: marked events after an exit are never live (no suggestion, unread, activity stamp or live frame)", async () => {
    c = await boot();
    const b = await bridge();
    const { msgs } = await browser();
    register(b, "e1");
    await wait(50);
    c.server.sessionManager.update("e1", { name: "custom", attachedProposal: "change-a", unread: false } as any);
    await wait(700); // idle exit (seam) ran, no replay_complete
    const before = (c.server.sessionManager.get("e1") as any).lastActivityAt;
    send(b, writeEv("e1", "change-b", true));
    send(b, agentStart("e1", true));
    send(b, agentEnd("e1", true));
    await wait(150);
    const s = c.server.sessionManager.get("e1") as any;
    expect(s.pendingReplaceProposal ?? null).toBeNull();
    expect(s.unread).toBeFalsy();
    expect(s.lastActivityAt).toBe(before);
    expect(liveEvents(msgs)).toHaveLength(0);
  });

  // test-plan #E4 — control for E1: an unmarked event after replay_complete is live.
  it("E4: unmarked events after replay_complete are live (unread stamped)", async () => {
    c = await boot();
    const b = await bridge();
    register(b, "e4");
    replayComplete(b, "e4");
    await wait(80);
    expect((c.server.sessionManager.get("e4") as any).unread).toBeFalsy();
    send(b, agentStart("e4"));
    await wait(60);
    send(b, agentEnd("e4"));
    await wait(120);
    expect((c.server.sessionManager.get("e4") as any).unread).toBe(true);
  });

  // test-plan #E3
  it("E3: marked events in a skipped replay are never inserted", async () => {
    c = await boot();
    const b = await bridge();
    register(b, "e3", { eventCount: 3, leafEntryId: "L3" });
    for (let i = 0; i < 3; i++) send(b, filler("e3", i, true));
    replayComplete(b, "e3");
    await wait(150);
    const n = storeCount(c, "e3");
    expect(n).toBe(3);
    register(b, "e3", { eventCount: 3, leafEntryId: "L3" }); // same branch ⇒ skips the wipe
    await wait(700); // idle exit (seam)
    expect(storeCount(c, "e3")).toBe(n);
    for (let i = 0; i < 20; i++) send(b, filler("e3", 100 + i, true));
    await wait(200);
    expect(storeCount(c, "e3")).toBe(n);
  });

  // test-plan #E8
  it("E8: a late replay_complete after an idle exit sends no second flush or status broadcast", async () => {
    c = await boot();
    const b = await bridge();
    register(b, "e8");
    await wait(30);
    // subscribe AFTER the register so the browser waits on the replay
    const h = await browser();
    send(h.ws, { type: "subscribe", sessionId: "e8" });
    await wait(700); // idle exit flushed the (empty) store
    const flushes = replayCount(h.msgs).length;
    const updates = h.msgs.filter((m) => m.type === "session_updated" && m.sessionId === "e8").length;
    expect(flushes).toBeGreaterThan(0);
    replayComplete(b, "e8");
    await wait(200);
    expect(replayCount(h.msgs)).toHaveLength(flushes);
    expect(h.msgs.filter((m) => m.type === "session_updated" && m.sessionId === "e8")).toHaveLength(updates);
  });

  // test-plan #E9
  it("E9: a marked event after an exit reopens replay; the next exit flushes everything, none as live", async () => {
    c = await boot();
    const b = await bridge();
    register(b, "e9");
    await wait(30);
    const h = await browser();
    send(h.ws, { type: "subscribe", sessionId: "e9" });
    for (let i = 0; i < 10; i++) send(b, unique("e9", i, true));
    await wait(700); // idle exit (seam) before the last events arrive
    h.msgs.length = 0;
    for (let i = 10; i < 40; i++) send(b, unique("e9", i, true));
    await wait(40);
    replayComplete(b, "e9");
    await wait(500);
    expect(storeCount(c, "e9")).toBe(40);
    const lastReset = h.msgs.map((m) => m.type).lastIndexOf("session_state_reset");
    const afterReset = h.msgs.slice(lastReset);
    expect(eventsIn(afterReset)).toBe(40);
    expect(replayCount(afterReset).at(-1).isLast).toBe(true);
    expect(liveEvents(h.msgs)).toHaveLength(0);
  });

  // test-plan #E17
  it("E17: an idle exit without replay_complete clears the OpenSpec activity state, in one broadcast", async () => {
    c = await boot();
    const b = await bridge();
    const h = await browser();
    register(b, "e17");
    await wait(50);
    c.server.sessionManager.update("e17", { openspecPhase: "apply", openspecChange: "x" } as any);
    h.msgs.length = 0;
    await wait(700);
    const s = c.server.sessionManager.get("e17") as any;
    expect(s.openspecPhase ?? null).toBeNull();
    expect(s.openspecChange ?? null).toBeNull();
    const carrying = h.msgs.filter(
      (m) => m.type === "session_updated" && m.sessionId === "e17" && m.updates?.openspecPhase === null && m.updates?.openspecChange === null,
    );
    expect(carrying).toHaveLength(1);
  });

  // test-plan #E20
  it("E20: every exit logs its cause (idle/cap at warn level)", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    c = await boot();
    // One bridge socket per session: a second session id on a socket is a session switch.
    const [bComplete, bIdle, bUnreg, bCap] = [await bridge(), await bridge(), await bridge(), await bridge()];
    register(bComplete, "x-complete");
    replayComplete(bComplete, "x-complete");
    register(bIdle, "x-idle");
    register(bUnreg, "x-unreg");
    await wait(50);
    send(bUnreg, { type: "session_unregister", sessionId: "x-unreg" });
    // cap: unmarked events keep touching the replay past the 1.5 s cap
    register(bCap, "x-cap");
    for (let t = 0; t < 1_800; t += 100) { send(bCap, filler("x-cap", t)); await wait(100); }
    await wait(300);
    const line = (spy: { mock: { calls: unknown[][] } }, id: string) =>
      spy.mock.calls.map((a) => String(a[0])).filter((l) => l.startsWith(`[replay] exit ${id} `));
    expect(line(log, "x-complete")).toEqual(["[replay] exit x-complete cause=complete"]);
    expect(line(log, "x-unreg")).toEqual(["[replay] exit x-unreg cause=unregister"]);
    expect(line(warn, "x-idle")).toEqual(["[replay] exit x-idle cause=idle"]);
    expect(line(warn, "x-cap")).toEqual(["[replay] exit x-cap cause=cap"]);
    for (const id of ["x-idle", "x-cap"]) expect(line(log, id)).toEqual([]);
  }, 20_000);

  // test-plan #X4
  it("X4: unregister ends the replay: no later exit, keepalive stops, waiter gets a terminal batch", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    c = await boot();
    const b = await bridge();
    register(b, "x4");
    await wait(30);
    const h = await browser();
    send(h.ws, { type: "subscribe", sessionId: "x4" });
    await until(() => replayCount(h.msgs).length >= 3); // priming + keepalives
    send(b, { type: "session_unregister", sessionId: "x4" });
    await until(() => replayCount(h.msgs).some((m) => m.isLast));
    const terminalAt = h.msgs.findIndex((m) => m.type === "event_replay" && m.isLast);
    const n = h.msgs.length;
    await wait(600); // past idle + cap windows and several keepalive periods
    expect(h.msgs.slice(terminalAt + 1).filter((m) => m.type === "event_replay")).toEqual([]);
    expect(h.msgs.length).toBeGreaterThanOrEqual(n);
    const causes = [...log.mock.calls, ...warn.mock.calls]
      .map((a) => String(a[0]))
      .filter((l) => l.startsWith("[replay] exit x4 "));
    expect(causes).toEqual(["[replay] exit x4 cause=unregister"]);
  });

  // test-plan #X5
  it("X5: a blocked event loop does not cause an idle exit when queued bridge input follows", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    c = await boot();
    const b = await bridge();
    register(b, "x5");
    await wait(80); // the register is processed; the idle period is running
    // The bridge keeps sending, but the server cannot read it while blocked.
    for (let i = 0; i < 3; i++) send(b, filler("x5", i));
    const until_ = Date.now() + 600; // > idle (250 ms)
    while (Date.now() < until_) { /* sync busy-wait: blocks the whole in-process server */ }
    await wait(120);
    expect(warn.mock.calls.map((a) => String(a[0])).filter((l) => l.includes("x5 cause=idle"))).toEqual([]);
    replayComplete(b, "x5");
    await wait(100);
  });

  // test-plan #X6
  it("X6: a bridge that dies mid-replay without unregister is flushed by the idle exit", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    c = await boot();
    const b = await bridge();
    register(b, "x6");
    await wait(30);
    const h = await browser();
    send(h.ws, { type: "subscribe", sessionId: "x6" });
    await wait(60);
    for (let i = 0; i < 100; i++) send(b, unique("x6", i));
    await until(() => replayCount(h.msgs).some((m) => m.isLast), 4_000); // socket stays open
    const lastReset = h.msgs.map((m) => m.type).lastIndexOf("session_state_reset");
    expect(eventsIn(h.msgs.slice(lastReset))).toBe(100);
  });

  // test-plan #F5
  it("F5: an empty store still ends the wait with a terminal empty batch", async () => {
    c = await boot();
    const b = await bridge();
    register(b, "f5");
    await wait(30);
    const h = await browser();
    send(h.ws, { type: "subscribe", sessionId: "f5" });
    await wait(80);
    replayComplete(b, "f5");
    await until(() => replayCount(h.msgs).some((m) => m.isLast && m.events.length === 0));
  });

  // test-plan #F6
  it("F6: waiting subscribers get keepalives until the flush; none after isLast and none to a closed socket", async () => {
    c = await boot({ replayTimings: { idleMs: 5_000, capMs: 20_000, keepaliveMs: 50 } });
    const b = await bridge();
    register(b, "f6");
    await wait(30);
    const h = await browser();
    send(h.ws, { type: "subscribe", sessionId: "f6" });
    // a second waiter that disappears
    const gone = await browser();
    send(gone.ws, { type: "subscribe", sessionId: "f6" });
    await wait(60);
    gone.ws.close();
    await wait(200);
    const markers = () => replayCount(h.msgs).filter((m) => m.events.length === 0 && !m.isLast).length;
    expect(markers()).toBeGreaterThanOrEqual(3); // priming + >= 2 keepalives
    const sendSpy = vi.spyOn(WebSocket.prototype, "send");
    for (let i = 0; i < 5; i++) send(b, unique("f6", i));
    replayComplete(b, "f6");
    await until(() => replayCount(h.msgs).some((m) => m.isLast));
    const terminalAt = h.msgs.findIndex((m) => m.type === "event_replay" && m.isLast);
    await wait(250);
    expect(h.msgs.slice(terminalAt + 1).filter((m) => m.type === "event_replay")).toEqual([]);
    // nothing sent to the closed socket
    const toClosed = sendSpy.mock.calls.filter((_, i) => (sendSpy.mock.contexts[i] as WebSocket).readyState !== WebSocket.OPEN);
    expect(toClosed.filter((a) => String(a[0]).includes('"isLast":false'))).toEqual([]);
  });

  // ── Skip-wipe decision table (test-plan #E11, #E12) ──────────────────────────

  /** Cold-hydrate an ended session from a transcript; resolves once the store holds its events. */
  async function hydrate(
    sid: string,
    n: number,
    fx: { leafId?: string; noIds?: boolean } = {},
  ): Promise<{ file: string; dir: string; leaf: string | undefined; h: BrowserHandle; stored: number }> {
    const dir = mkdtempSync(path.join(os.tmpdir(), "resume-hyd-"));
    const { file, leaf } = writeTranscript(dir, sid, n, fx);
    c.server.sessionManager.register({ id: sid, cwd: dir, sessionFile: file, source: "terminal" } as any);
    c.server.sessionManager.update(sid, { status: "ended" } as any);
    const h = await browser();
    send(h.ws, { type: "subscribe", sessionId: sid });
    await until(() => c.server.eventStore.hasEvents(sid), 5_000);
    await wait(100); // fan-out + fingerprint settle
    return { file, dir, leaf, h, stored: storeCount(c, sid) };
  }

  /** Register a bridge for a hydrated session; report whether the wipe was skipped. */
  async function registerAfterHydration(
    sid: string,
    hyd: { file: string; dir: string; h: BrowserHandle; stored: number },
    fields: Record<string, unknown>,
  ): Promise<boolean> {
    const b = await bridge();
    const resetsBefore = resets(hyd.h.msgs);
    register(b, sid, { cwd: hyd.dir, sessionFile: hyd.file, ...fields });
    await wait(200);
    const skipped = storeCount(c, sid) === hyd.stored;
    expect(resets(hyd.h.msgs) - resetsBefore).toBe(skipped ? 0 : 1);
    if (!skipped) expect(storeCount(c, sid)).toBe(0);
    return skipped;
  }

  // test-plan #E11 rows (a)–(i)
  it("E11 (a): bridge-learned count + leaf match skips the wipe (no reset, store kept)", async () => {
    c = await boot();
    const b = await bridge();
    register(b, "e11a", { eventCount: 3, leafEntryId: "L3" });
    for (let i = 0; i < 3; i++) send(b, filler("e11a", i, true));
    replayComplete(b, "e11a");
    await wait(150);
    const h = await browser();
    send(h.ws, { type: "subscribe", sessionId: "e11a" });
    await wait(150);
    const before = resets(h.msgs);
    register(b, "e11a", { eventCount: 3, leafEntryId: "L3" });
    await wait(150);
    expect(storeCount(c, "e11a")).toBe(3);
    expect(resets(h.msgs)).toBe(before);
  });

  it("E11 (b): an old bridge (no leafEntryId) with a matching count wipes", async () => {
    c = await boot();
    const b = await bridge();
    register(b, "e11b", { eventCount: 3 });
    for (let i = 0; i < 3; i++) send(b, filler("e11b", i));
    replayComplete(b, "e11b");
    await wait(150);
    const h = await browser();
    send(h.ws, { type: "subscribe", sessionId: "e11b" });
    await wait(150);
    const before = resets(h.msgs);
    register(b, "e11b", { eventCount: 3 });
    await wait(150);
    expect(storeCount(c, "e11b")).toBe(0);
    expect(resets(h.msgs)).toBe(before + 1);
  });

  it("E11 (c): hydration-learned fingerprint (count + leaf + liveTailOpen:false, store untouched) skips the wipe", async () => {
    c = await boot();
    const hyd = await hydrate("e11c", 6);
    expect(hyd.stored).toBeGreaterThan(0);
    expect(await registerAfterHydration("e11c", hyd, { eventCount: 6, leafEntryId: hyd.leaf, liveTailOpen: false })).toBe(true);
  });

  it("E11 (d): a different leaf wipes", async () => {
    c = await boot();
    const hyd = await hydrate("e11d", 6);
    expect(await registerAfterHydration("e11d", hyd, { eventCount: 6, leafEntryId: "other", liveTailOpen: false })).toBe(false);
  });

  it("E11 (e): liveTailOpen:true wipes (the live replay keeps open calls open)", async () => {
    c = await boot();
    const hyd = await hydrate("e11e", 6);
    expect(await registerAfterHydration("e11e", hyd, { eventCount: 6, leafEntryId: hyd.leaf, liveTailOpen: true })).toBe(false);
  });

  it("E11 (f): liveTailOpen absent wipes", async () => {
    c = await boot();
    const hyd = await hydrate("e11f", 6);
    expect(await registerAfterHydration("e11f", hyd, { eventCount: 6, leafEntryId: hyd.leaf })).toBe(false);
  });

  it("E11 (g): an event inserted after the hydration (e.g. a heal event) wipes", async () => {
    c = await boot();
    const hyd = await hydrate("e11g", 6);
    c.server.eventStore.insertEvent("e11g", { eventType: "tool_execution_end", timestamp: Date.now(), data: { toolCallId: "z" } } as any);
    hyd.stored = storeCount(c, "e11g");
    expect(await registerAfterHydration("e11g", hyd, { eventCount: 6, leafEntryId: hyd.leaf, liveTailOpen: false })).toBe(false);
  });

  it("E11 (h): a transcript without a resolvable leaf records no fingerprint ⇒ wipes", async () => {
    c = await boot();
    const hyd = await hydrate("noid-e11h", 6, { noIds: true });
    expect(await registerAfterHydration("noid-e11h", hyd, { eventCount: 6, leafEntryId: "e5", liveTailOpen: false })).toBe(false);
  });

  it("E11 (i): eventCount absent wipes", async () => {
    c = await boot();
    const hyd = await hydrate("e11i", 6);
    expect(await registerAfterHydration("e11i", hyd, { leafEntryId: hyd.leaf, liveTailOpen: false })).toBe(false);
  });

  // test-plan #E12
  it.each([
    ["length 1", "x", "x", true],
    ["length 128", "y".repeat(128), "y".repeat(128), true],
    ["empty string", "x", "", false],
    ["length 129", "z".repeat(129), "z".repeat(129), false],
    ["a number", "x", 42, false],
  ] as const)("E12: leafEntryId validation — %s", async (_name, fileLeaf, sent, eligible) => {
    c = await boot();
    const sid = `e12-${String(_name).replace(/\W/g, "")}`;
    const hyd = await hydrate(sid, 4, { leafId: fileLeaf });
    expect(hyd.leaf).toBe(fileLeaf);
    expect(await registerAfterHydration(sid, hyd, { eventCount: 4, leafEntryId: sent, liveTailOpen: false })).toBe(eligible);
  });

  // ── Windowed, abortable exit flush ───────────────────────────────────────────

  // test-plan #E22
  it("E22: windowing disabled on a head-trimmed store: exactly one reset, no history_window, every stored event", async () => {
    c = await boot({ maxReplayEvents: 0, maxEventsPerSession: 500 });
    const b = await bridge();
    register(b, "e22");
    await wait(30);
    const h = await browser();
    send(h.ws, { type: "subscribe", sessionId: "e22" });
    await wait(80);
    h.msgs.length = 0;
    for (let i = 0; i < 1_000; i++) send(b, unique("e22", i, true));
    replayComplete(b, "e22");
    await until(() => replayCount(h.msgs).some((m) => m.isLast), 8_000);
    const stored = c.server.eventStore.getEvents("e22", 1);
    expect(stored[0].seq).toBeGreaterThan(1); // head-trimmed
    expect(resets(h.msgs)).toBe(1);
    expect(h.msgs.some((m) => m.type === "history_window")).toBe(false);
    expect(eventsIn(h.msgs)).toBe(stored.length);
    const firstBatch = h.msgs.findIndex((m) => m.type === "event_replay" && m.events.length > 0);
    expect(h.msgs.findIndex((m) => m.type === "session_state_reset")).toBeLessThan(firstBatch);
  });

  // test-plan #E23
  it("E23: an in-process subscriber gets the full stream while a WebSocket browser is windowed", async () => {
    c = await boot({ maxReplayEvents: 2000 });
    const b = await bridge();
    register(b, "e23");
    await wait(30);
    const h = await browser();
    send(h.ws, { type: "subscribe", sessionId: "e23" });
    const inProc: any[] = [];
    c.server.browserGateway.addInProcessSubscriber("e23", (m) => inProc.push(m));
    await wait(80);
    h.msgs.length = 0;
    inProc.length = 0;
    for (let i = 0; i < 3_000; i++) send(b, unique("e23", i, true));
    replayComplete(b, "e23");
    await until(() => replayCount(h.msgs).some((m) => m.isLast), 8_000);
    expect(replayCount(inProc).reduce((n, m) => n + m.events.length, 0)).toBe(3_000);
    expect(Math.max(...replayCount(h.msgs).map((m) => m.events.length))).toBeLessThanOrEqual(2000);
    expect(h.msgs.some((m) => m.type === "history_window")).toBe(true);
  });

  // test-plan #F3
  it("F3: a flush superseded by a re-register stops before its next batch and unmutes the socket", async () => {
    c = await boot({ maxReplayEvents: 0, replayTimings: { idleMs: 5_000, capMs: 20_000, keepaliveMs: 50 } });
    const b = await bridge();
    register(b, "f3");
    await wait(30);
    const h = await browser();
    send(h.ws, { type: "subscribe", sessionId: "f3" });
    await wait(60);
    for (let i = 0; i < 6_000; i++) send(b, unique("f3", i, true));
    // Back to back (as F4): re-register (wipes) while the flush is still draining.
    // Waiting for its first batch raced the drain, and a fully drained flush made
    // this test pass vacuously.
    replayComplete(b, "f3");
    register(b, "f3");
    await until(() => resets(h.msgs) >= 2, 4_000);
    // The premise: the superseded flush never reached its last batch.
    expect(replayCount(h.msgs).some((m) => m.isLast)).toBe(false);
    const secondReset = h.msgs.map((m) => m.type).lastIndexOf("session_state_reset");
    const countAtReset = h.msgs.length;
    await wait(300);
    // no batch of the old flush after the new reset
    expect(h.msgs.slice(secondReset + 1).filter((m) => m.type === "event_replay" && m.events.length > 0)).toEqual([]);
    expect(h.msgs.length).toBeGreaterThanOrEqual(countAtReset);
    // the new replay + flush completes, then a live event reaches the browser
    for (let i = 0; i < 3; i++) send(b, unique("f3", 10_000 + i, true));
    replayComplete(b, "f3");
    await until(() => replayCount(h.msgs.slice(secondReset + 1)).some((m) => m.isLast), 4_000);
    h.msgs.length = 0;
    send(b, filler("f3", 99_999));
    await until(() => liveEvents(h.msgs).length > 0, 3_000);
  }, 30_000);

  // test-plan #F4
  it("F4: an aborted flush followed by a register that skips the wipe still ends with a full flush", async () => {
    c = await boot({ maxReplayEvents: 0, replayTimings: { idleMs: 5_000, capMs: 20_000, keepaliveMs: 50 } });
    const b = await bridge();
    const fields = { eventCount: 6_000, leafEntryId: "L" };
    register(b, "f4", fields);
    await wait(30);
    const h = await browser();
    send(h.ws, { type: "subscribe", sessionId: "f4" });
    await wait(60);
    for (let i = 0; i < 6_000; i++) send(b, unique("f4", i, true));
    // Back to back: the server handles the re-register while the exit flush is
    // still yielding between batches, so the abort is deterministic. Waiting for
    // the first batch first raced the drain: on a fast host all 33 batches landed
    // within one 15 ms poll, nothing was aborted, and the skip-wipe register left
    // no flush to complete (isLast never came; ~2/3 local runs failed).
    replayComplete(b, "f4");
    register(b, "f4", fields); // same branch ⇒ skips the wipe, aborting the draining flush
    await wait(300);
    // The premise of F4: the first flush really was aborted before its last batch.
    expect(replayCount(h.msgs).some((m) => m.isLast)).toBe(false);
    expect(storeCount(c, "f4")).toBe(6_000);
    h.msgs.length = 0;
    replayComplete(b, "f4");
    await until(() => replayCount(h.msgs).some((m) => m.isLast), 8_000);
    expect(resets(h.msgs)).toBe(1);
    expect(eventsIn(h.msgs)).toBe(6_000);
    h.msgs.length = 0;
    send(b, filler("f4", 99_999));
    await until(() => liveEvents(h.msgs).length > 0, 3_000);
  }, 30_000);

  // test-plan #X7
  it("X7: a failing subscriber during the exit flush is logged once; the others still receive it", async () => {
    const errs = vi.spyOn(console, "error").mockImplementation(() => {});
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    try {
      c = await boot();
      const b = await bridge();
      register(b, "x7");
      await wait(30);
      const good = await browser();
      const bad = await browser();
      send(good.ws, { type: "subscribe", sessionId: "x7" });
      send(bad.ws, { type: "subscribe", sessionId: "x7" });
      await wait(100);
      const badPort = (bad.ws as any)._socket.localPort as number;
      const realSend = WebSocket.prototype.send;
      vi.spyOn(WebSocket.prototype, "send").mockImplementation(function (this: any, ...args: any[]) {
        if (this._socket?.remotePort === badPort && String(args[0]).includes('"isLast":true')) throw new Error("boom");
        return (realSend as any).apply(this, args);
      });
      for (let i = 0; i < 5; i++) send(b, unique("x7", i, true));
      replayComplete(b, "x7");
      await until(() => replayCount(good.msgs).some((m) => m.isLast), 4_000);
      await wait(150);
      expect(errs.mock.calls.filter((a) => String(a[0]).includes("[replay] exit flush failed for x7"))).toHaveLength(1);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  // ── No cold hydration during a bridge replay (test-plan #F1, #F2) ────────────

  // test-plan #F1
  it("F1: a subscribe during a bridge replay starts no cold load; it waits with keepalives and is served by the flush", async () => {
    c = await boot({ replayTimings: { idleMs: 5_000, capMs: 20_000, keepaliveMs: 50 } });
    const dir = mkdtempSync(path.join(os.tmpdir(), "resume-f1-"));
    const { file } = writeTranscript(dir, "f1", 4);
    c.server.sessionManager.register({ id: "f1", cwd: dir, sessionFile: file, source: "terminal" } as any);
    c.server.sessionManager.update("f1", { status: "ended" } as any);
    const load = vi.spyOn(c.server.directoryService, "loadSessionEvents");
    const b = await bridge();
    register(b, "f1", { cwd: dir, sessionFile: file });
    await wait(40);
    const h = await browser();
    send(h.ws, { type: "subscribe", sessionId: "f1" });
    await until(() => replayCount(h.msgs).length >= 3); // priming + >= 2 keepalives
    expect(replayCount(h.msgs)[0]).toMatchObject({ events: [], isLast: false });
    for (let i = 0; i < 4; i++) send(b, unique("f1", i, true));
    replayComplete(b, "f1");
    await until(() => replayCount(h.msgs).some((m) => m.isLast));
    const terminalAt = h.msgs.findIndex((m) => m.type === "event_replay" && m.isLast);
    await wait(200);
    expect(load).not.toHaveBeenCalled();
    expect(h.msgs.slice(terminalAt + 1).filter((m) => m.type === "event_replay")).toEqual([]);
    expect(eventsIn(h.msgs)).toBe(4);
  });

  // test-plan #F2
  it("F2: no sessionFile and an empty store during a bridge replay is not reported as unavailable", async () => {
    c = await boot({ replayTimings: { idleMs: 5_000, capMs: 20_000, keepaliveMs: 50 } });
    const b = await bridge();
    register(b, "f2"); // no sessionFile
    await wait(40);
    const h = await browser();
    send(h.ws, { type: "subscribe", sessionId: "f2" });
    await wait(100);
    for (let i = 0; i < 3; i++) send(b, unique("f2", i, true));
    replayComplete(b, "f2");
    await until(() => replayCount(h.msgs).some((m) => m.isLast));
    expect(h.msgs.some((m) => m.type === "session_updated" && m.updates?.dataUnavailable === true)).toBe(false);
    expect(eventsIn(h.msgs)).toBe(3);
  });
});
