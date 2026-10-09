/**
 * Cold-start shutdown-window recovery: on a host shutdown pi exits gracefully
 * and its bridge unregisters ~23 s BEFORE the server records
 * `exitIntent:"signal"`, so the session is `live:false` on disk and the old
 * `live:true` path offers nothing. The window path recognises it from the
 * end evidence (`liveEpoch` = ending boot, `endedAt`) and the boot record.
 * See change: fix-recovery-pi-signal-unregister.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

const spawnPiSession = vi.fn(async (_cwd: string, _opts: Record<string, unknown>) => ({ success: false, message: "spawn disabled in test" }));
vi.mock("../spawn-process/process-manager.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, spawnPiSession: (cwd: string, opts: Record<string, unknown>) => spawnPiSession(cwd, opts) };
});

const DASH_DIR = path.join(os.homedir(), ".pi", "dashboard");
const BOOT_STATE_PATH = path.join(DASH_DIR, "boot-state.json");

const B = 1_791_450_739_978; // the boot that went down with the host
const T = 1_791_528_209_000; // when pi unregistered
const GRACE_WAIT_MS = 8_000; // > RECOVERY_REATTACH_GRACE_MS (7 s)

function writeConfig(mode: "ask" | "auto" | "off"): void {
  mkdirSync(DASH_DIR, { recursive: true });
  writeFileSync(path.join(DASH_DIR, "config.json"), JSON.stringify({ reopenSessionsAfterShutdown: mode }));
}

type Rec = { bootId: number; exitIntent: string | null; at: number };
function writeBootState(current: Rec, ring: Rec[] = []): void {
  mkdirSync(DASH_DIR, { recursive: true });
  writeFileSync(BOOT_STATE_PATH, JSON.stringify({ ...current, ring }));
}

function metaFileFor(sessionsDir: string, id: string): string {
  return path.join(sessionsDir, "proj", `2026-10-09T08-00-00-000Z_${id}.meta.json`);
}

/** Seed a session transcript + sidecar shaped like the end write left it. */
function seedEnded(sessionsDir: string, id: string, meta: Record<string, unknown>): string {
  const cwdDir = path.join(sessionsDir, "proj");
  mkdirSync(cwdDir, { recursive: true });
  const jsonl = path.join(cwdDir, `2026-10-09T08-00-00-000Z_${id}.jsonl`);
  writeFileSync(jsonl, `${JSON.stringify({ type: "session", id, cwd: cwdDir })}\n`);
  writeFileSync(jsonl.replace(/\.jsonl$/, ".meta.json"), JSON.stringify({
    source: "cli", cwd: cwdDir, startedAt: T - 3_600_000, cachedAt: Date.now() + 60_000, ...meta,
  }));
  return jsonl;
}

/** The exact evidence a bridge unregister in boot B writes. */
const EVIDENCE = { live: false, status: "ended", closedReason: "unknown", liveEpoch: B, endedAt: T };

async function collect(port: number, ms: number): Promise<Record<string, unknown>[]> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const msgs: Record<string, unknown>[] = [];
  await new Promise<void>((resolve) => {
    ws.on("open", () => {
      ws.on("message", (raw) => { try { msgs.push(JSON.parse(raw.toString())); } catch {} });
      setTimeout(resolve, ms);
    });
  });
  ws.close();
  return msgs;
}

const offeredIds = (msgs: Record<string, unknown>[]): string[] =>
  msgs.filter((m) => m.type === "recovery_offer")
    .flatMap((o) => (o.candidates as { sessionId: string }[]).map((c) => c.sessionId));

const uuid = (n: number) => `${String(n).padStart(8, "0")}-2222-3333-4444-555555555555`;

describe("shutdown-window cold-start recovery", () => {
  let sessionsDir: string;
  let server: any;
  let infoLines: string[];

  beforeEach(() => {
    sessionsDir = mkdtempSync(path.join(os.tmpdir(), "pi-shutdown-window-"));
    infoLines = [];
    vi.spyOn(console, "info").mockImplementation((...a: unknown[]) => { infoLines.push(a.map(String).join(" ")); });
    spawnPiSession.mockClear();
  });
  afterEach(async () => {
    try { await server?.stop(); } catch {}
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
    rmSync(sessionsDir, { recursive: true, force: true });
    rmSync(BOOT_STATE_PATH, { force: true });
  });

  async function boot(): Promise<number> {
    vi.stubEnv("PI_CODING_AGENT_SESSION_DIR", sessionsDir);
    vi.resetModules();
    const { createServer } = await import("../server.js");
    server = await createServer({
      port: 0, piPort: 0, host: "127.0.0.1", dev: true,
      autoShutdown: false, shutdownIdleSeconds: 999, tunnel: false,
    });
    await server.start();
    return server.httpPort()! as number;
  }

  const windowLines = () => infoLines.filter((l) => l.includes("shutdown-window"));

  // test-plan #E6 — field replay of 2026-10-09 (task 1.1, the red test).
  it("pi unregistered, then the boot recorded signal 23 s later → all sessions offered", async () => {
    writeConfig("ask");
    rmSync(BOOT_STATE_PATH, { force: true });
    await boot(); // boot B'
    const ids = Array.from({ length: 20 }, (_, i) => uuid(i + 1));
    const cwdDir = path.join(sessionsDir, "proj");
    mkdirSync(cwdDir, { recursive: true });
    const sockets = await Promise.all(ids.map((id) => new Promise<WebSocket>((resolve) => {
      const sf = path.join(cwdDir, `2026-10-09T08-00-00-000Z_${id}.jsonl`);
      writeFileSync(sf, `${JSON.stringify({ type: "session", id, cwd: cwdDir })}\n`);
      const ws = new WebSocket(`ws://127.0.0.1:${server.piPort()}`);
      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "session_register", sessionId: id, cwd: cwdDir, source: "cli", sessionFile: sf }));
        ws.send(JSON.stringify({ type: "replay_complete", sessionId: id }));
        ws.send(JSON.stringify({ type: "event_forward", sessionId: id, event: { eventType: "message_start", timestamp: Date.now(), data: {} } }));
        setTimeout(() => resolve(ws), 150);
      });
    })));
    // OS shutdown: every pi exits gracefully → bridge unregister.
    for (const [i, ws] of sockets.entries()) ws.send(JSON.stringify({ type: "session_unregister", sessionId: ids[i] }));
    await new Promise((r) => setTimeout(r, 300));
    // ...then the server itself is signalled ~23 s later.
    const bs = await import("../persistence/boot-state.js");
    bs.recordExitIntent("signal");
    for (const ws of sockets) ws.close();
    await server.stop();
    const state = JSON.parse(readFileSync(BOOT_STATE_PATH, "utf-8"));
    expect(state.exitIntent).toBe("signal");
    state.at += 23_000;
    writeFileSync(BOOT_STATE_PATH, JSON.stringify(state));

    const port = await boot(); // next boot after the reboot
    const offered = offeredIds(await collect(port, GRACE_WAIT_MS));
    expect(offered.sort()).toEqual([...ids].sort());
    expect(windowLines()).toHaveLength(20);
  }, 60_000);

  // test-plan #E7 — the debounced status:"ended" write was lost.
  it("status not consulted: live:false + status:active evidence is a candidate and normalized", async () => {
    writeConfig("ask");
    writeBootState({ bootId: B, exitIntent: "signal", at: T + 23_000 });
    const id = uuid(70);
    seedEnded(sessionsDir, id, { ...EVIDENCE, status: "active" });
    await boot();
    const s = server.sessionManager.get(id);
    expect(s?.recoveryCandidate).toBe(true);
    expect(s?.status).toBe("ended");
  }, 30_000);

  // test-plan #E8 — pre-upgrade sidecars carry no liveEpoch on live:false.
  it("pre-upgrade ended sidecar (no liveEpoch) is not retroactively offered", async () => {
    writeConfig("ask");
    writeBootState({ bootId: B, exitIntent: "signal", at: T + 5_000 });
    const id = uuid(80);
    seedEnded(sessionsDir, id, { live: false, status: "ended", closedReason: "unknown" });
    await boot();
    expect(server.sessionManager.get(id)?.recoveryCandidate).toBeFalsy();
    expect(windowLines()).toHaveLength(0);
  }, 30_000);

  // test-plan #E9 — a replacement boot that died during startup pushes B to ring[1].
  it("a failed replacement boot does not hide the shutdown", async () => {
    writeConfig("ask");
    const C = B + 600_000;
    writeBootState({ bootId: C, exitIntent: null, at: C }, [{ bootId: B, exitIntent: "signal", at: T + 23_000 }]);
    const id = uuid(90);
    seedEnded(sessionsDir, id, EVIDENCE);
    await boot();
    expect(server.sessionManager.get(id)?.recoveryCandidate).toBe(true);
  }, 30_000);

  // test-plan #E10 / #E11 — one-shot in every mode; off consumes without collecting.
  it.each(["ask", "auto", "off"] as const)("%s: classified once, evidence consumed, never again", async (mode) => {
    writeConfig(mode);
    writeBootState({ bootId: B, exitIntent: "signal", at: T + 23_000 });
    const id = uuid(100);
    seedEnded(sessionsDir, id, EVIDENCE);
    const port = await boot(); // C
    expect(Boolean(server.sessionManager.get(id)?.recoveryCandidate)).toBe(mode !== "off");
    expect(JSON.parse(readFileSync(metaFileFor(sessionsDir, id), "utf-8")).liveEpoch).toBeUndefined();
    if (mode === "off") {
      const msgs = await collect(port, GRACE_WAIT_MS);
      expect(offeredIds(msgs)).toHaveLength(0);
      expect(spawnPiSession).not.toHaveBeenCalled();
    }
    await server.stop();
    await boot(); // D
    expect(server.sessionManager.get(id)?.recoveryCandidate).toBeFalsy();
  }, 45_000);

  // test-plan #X1 — restart: pi keeps running, nothing is offered.
  it("restart exit: neither live:true nor evidence-shaped sessions are offered", async () => {
    writeConfig("ask");
    writeBootState({ bootId: B, exitIntent: "restart", at: T + 5_000 });
    seedEnded(sessionsDir, uuid(110), { source: "cli", status: "streaming", live: true, liveEpoch: B });
    seedEnded(sessionsDir, uuid(111), EVIDENCE);
    const port = await boot();
    expect(offeredIds(await collect(port, GRACE_WAIT_MS))).toHaveLength(0);
    expect(windowLines()).toHaveLength(0);
  }, 30_000);

  // test-plan #X2 — Electron quit with pi surviving: the sessions are live:true
  // (never unregistered) and reattach inside the grace window.
  it("user-quit with surviving sessions: no window candidates, reattach retracts", async () => {
    writeConfig("ask");
    writeBootState({ bootId: B, exitIntent: "user-quit", at: T });
    const ids = [uuid(120), uuid(121)];
    const files = ids.map((id) => seedEnded(sessionsDir, id, { status: "streaming", live: true, liveEpoch: B }));
    const port = await boot();
    expect(windowLines()).toHaveLength(0);
    const sockets = ids.map((id, i) => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.piPort()}`);
      ws.on("open", () => ws.send(JSON.stringify({ type: "session_register", sessionId: id, cwd: path.dirname(files[i]), source: "cli", sessionFile: files[i] })));
      return ws;
    });
    const offered = offeredIds(await collect(port, GRACE_WAIT_MS));
    expect(offered).toHaveLength(0);
    for (const ws of sockets) ws.close();
  }, 30_000);

  // test-plan #X4 — documented limitation: the server died unrecorded.
  it("server SIGKILLed after pi unregistered (intent null) → not offered", async () => {
    writeConfig("ask");
    writeBootState({ bootId: B, exitIntent: null, at: B });
    const id = uuid(130);
    seedEnded(sessionsDir, id, { ...EVIDENCE, endedAt: B + 5_000 });
    await boot();
    expect(server.sessionManager.get(id)?.recoveryCandidate).toBeFalsy();
    expect(windowLines()).toHaveLength(0);
  }, 30_000);

  // test-plan #X5 — auto resumes a window candidate once; a failed spawn is not retried.
  it("auto: one continue spawn, evidence consumed, no retry on the next boot", async () => {
    writeConfig("auto");
    writeBootState({ bootId: B, exitIntent: "signal", at: T + 23_000 });
    const id = uuid(140);
    seedEnded(sessionsDir, id, EVIDENCE);
    await boot(); // C
    await new Promise((r) => setTimeout(r, GRACE_WAIT_MS));
    expect(spawnPiSession).toHaveBeenCalledTimes(1);
    expect(spawnPiSession.mock.calls[0]?.[1]).toMatchObject({ mode: "continue" });
    expect(JSON.parse(readFileSync(metaFileFor(sessionsDir, id), "utf-8")).liveEpoch).toBeUndefined();
    await server.stop();
    spawnPiSession.mockClear();
    await boot(); // D
    await new Promise((r) => setTimeout(r, GRACE_WAIT_MS));
    expect(spawnPiSession).not.toHaveBeenCalled();
  }, 60_000);
});
