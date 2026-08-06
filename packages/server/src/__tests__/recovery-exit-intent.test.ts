/**
 * Cold-start recovery is decided by a POSITIVE record of the previous boot's
 * exit intent, not by the absence of per-session cleanup.
 *
 * The lineage of this bug: `/api/restart` and `/api/shutdown` exit via
 * `process.exit(0)` without clearing any `live` marker, so a restart looked
 * exactly like a crash and phantom-offered sessions that were about to
 * reattach. Meanwhile the only marker-clearing path (`stop()`) fired on the
 * LEAST intentional exit (idle timeout), destroying the signal for a real
 * host restart.
 *
 * Rule under test: offer a session only when it can never reattach and the
 * user did not close it. Exits that leave the sessions running and tell the
 * bridges to stay away LONGER than the reattach grace window (`restart`,
 * `shutdown`) suppress recovery outright; every other exit allows it and lets
 * the liveness gate retract whatever proves alive.
 *
 * See change: fix-recovery-exit-intent (tasks 1.1-1.5).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

const DASH_DIR = path.join(os.homedir(), ".pi", "dashboard");
const BOOT_STATE_PATH = path.join(DASH_DIR, "boot-state.json");

/** A boot id belonging to the (simulated) previous server run. */
const PRIOR_BOOT = 1_700_000_000_000;

function writeConfig(mode: "ask" | "auto" | "off"): void {
  mkdirSync(DASH_DIR, { recursive: true });
  writeFileSync(path.join(DASH_DIR, "config.json"), JSON.stringify({ reopenSessionsAfterShutdown: mode }));
}

/** Seed the boot record left behind by the previous run. */
function writeBootState(exitIntent: string | null): void {
  mkdirSync(DASH_DIR, { recursive: true });
  writeFileSync(BOOT_STATE_PATH, JSON.stringify({
    bootId: PRIOR_BOOT, exitIntent, at: PRIOR_BOOT, ring: [],
  }));
}

/** Seed a restart-crash-shaped sidecar owned by `PRIOR_BOOT`. */
function seedCandidate(sessionsDir: string, id: string): void {
  const cwdDir = path.join(sessionsDir, id.slice(0, 4));
  mkdirSync(cwdDir, { recursive: true });
  const jsonl = path.join(cwdDir, `2026-07-25T10-00-00-000Z_${id}.jsonl`);
  writeFileSync(jsonl, `${JSON.stringify({ type: "session", id, cwd: cwdDir })}\n`);
  writeFileSync(jsonl.replace(/\.jsonl$/, ".meta.json"), JSON.stringify({
    source: "cli", cwd: cwdDir, status: "streaming",
    startedAt: Date.now(), cachedAt: Date.now() + 60_000,
    live: true, liveEpoch: PRIOR_BOOT,
  }));
}

/** Connect a browser client and collect frames for `ms`. */
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

const offersIn = (msgs: Record<string, unknown>[]): string[] =>
  msgs.filter((m) => m.type === "recovery_offer")
    .flatMap((o) => (o.candidates as { sessionId: string }[]).map((c) => c.sessionId));

describe("recovery is gated by the previous boot's exit intent", () => {
  let sessionsDir: string;
  let server: any;

  beforeEach(() => { sessionsDir = mkdtempSync(path.join(os.tmpdir(), "pi-intent-")); });
  afterEach(async () => {
    try { await server?.stop(); } catch {}
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

  // 1.1 — the false positive. A plain `/api/restart` leaves every session
  // `live:true` on disk; those sessions survive and reattach, so they must
  // never be offered.
  it("restart: no candidates and no offer", async () => {
    writeConfig("ask");
    writeBootState("restart");
    const ID = "1111aaaa-2222-3333-4444-555555555555";
    seedCandidate(sessionsDir, ID);
    const port = await boot();

    expect(server.sessionManager.get(ID)?.recoveryCandidate).toBeFalsy();
    expect(server.sessionManager.get(ID)?.status).toBe("ended");
    // Long enough to outlast the reattach grace window (the deferred broadcast).
    const msgs = await collect(port, 8_000);
    expect(msgs.filter((m) => m.type === "recovery_offer")).toHaveLength(0);
    // First test in the file pays the cold vite transform of the whole server
    // tree on top of the 8 s grace wait.
  }, 45_000);

  // 1.2 — the false negative. The idle timer stopping the server KILLS every
  // spawned pi (`killAll`), so those sessions can never reattach: offer them.
  it("idle: sessions stay recoverable", async () => {
    writeConfig("ask");
    writeBootState("idle");
    const ID = "2222aaaa-2222-3333-4444-555555555555";
    seedCandidate(sessionsDir, ID);
    const port = await boot();

    expect(server.sessionManager.get(ID)?.recoveryCandidate).toBe(true);
    expect(offersIn(await collect(port, 9_000))).toContain(ID);
  }, 25_000);

  // An OS-initiated shutdown (SIGTERM) and a crash (no record) both leave the
  // sessions unrecoverable — offer. A user quit is decided by liveness, not by
  // the intent, so it is allowed here too.
  it.each([
    ["signal", "3333aaaa-2222-3333-4444-555555555555"],
    ["user-quit", "4444aaaa-2222-3333-4444-555555555555"],
    [null, "5555aaaa-2222-3333-4444-555555555555"],
  ])("exitIntent %s: recovery allowed", async (intent, id) => {
    writeConfig("ask");
    writeBootState(intent as string | null);
    seedCandidate(sessionsDir, id as string);
    await boot();
    expect(server.sessionManager.get(id)?.recoveryCandidate).toBe(true);
  }, 25_000);

  // Back-compat: the first boot after upgrade has no record at all. Absence
  // must resolve to "no deliberate exit" so we never under-offer.
  it("absent boot record: recovery allowed", async () => {
    writeConfig("ask");
    rmSync(BOOT_STATE_PATH, { force: true });
    const ID = "6666aaaa-2222-3333-4444-555555555555";
    seedCandidate(sessionsDir, ID);
    await boot();
    expect(server.sessionManager.get(ID)?.recoveryCandidate).toBe(true);
  }, 25_000);

  // 4.4 — two consecutive dirty boots must not lose the first one's offer:
  // the owning boot is resolved against the ring, not just the last record.
  it("resolves an older boot through the ring", async () => {
    writeConfig("ask");
    mkdirSync(DASH_DIR, { recursive: true });
    writeFileSync(BOOT_STATE_PATH, JSON.stringify({
      bootId: PRIOR_BOOT + 1000, exitIntent: null, at: PRIOR_BOOT + 1000,
      ring: [{ bootId: PRIOR_BOOT, exitIntent: "restart", at: PRIOR_BOOT }],
    }));
    const ID = "7777aaaa-2222-3333-4444-555555555555";
    seedCandidate(sessionsDir, ID); // owned by PRIOR_BOOT → suppressed via the ring
    await boot();
    expect(server.sessionManager.get(ID)?.recoveryCandidate).toBeFalsy();
  }, 25_000);

  // 4.2 — `auto` must not silently resume a suppressed boot's sessions either.
  it("auto mode: a suppressed boot's marker is left untouched (not resumed)", async () => {
    writeConfig("auto");
    writeBootState("restart");
    const ID = "8888aaaa-2222-3333-4444-555555555555";
    seedCandidate(sessionsDir, ID);
    await boot();
    expect(server.sessionManager.get(ID)?.recoveryCandidate).toBeFalsy();
  }, 25_000);

  // 1.5 — the guard that holds when every upstream assumption breaks: a stale
  // offer must never double-spawn a session whose carrier is alive.
  it("resume continue on a live-keeper session is refused", async () => {
    writeConfig("ask");
    writeBootState("idle");
    const ID = "aaaabbbb-2222-3333-4444-555555555555";
    seedCandidate(sessionsDir, ID);
    // A keeper sidecar whose PID is alive (this test runner). The keeper scan
    // reports it live, so cold start retracts the candidate — and a client
    // acting on a stale offer must still be refused.
    const keeperDir = path.join(DASH_DIR, "sessions");
    mkdirSync(keeperDir, { recursive: true });
    writeFileSync(path.join(keeperDir, `${ID}.rpc.sock.pid`), String(process.pid));
    const port = await boot();

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const msgs: Record<string, unknown>[] = [];
    await new Promise<void>((resolve) => {
      ws.on("open", () => {
        ws.on("message", (raw) => { try { msgs.push(JSON.parse(raw.toString())); } catch {} });
        // Past the grace window, so the refusal cannot be the "verifying" one.
        setTimeout(() => {
          ws.send(JSON.stringify({ type: "resume_session", sessionId: ID, mode: "continue" }));
          setTimeout(resolve, 500);
        }, 8_000);
      });
    });
    ws.close();
    rmSync(path.join(keeperDir, `${ID}.rpc.sock.pid`), { force: true });

    const result = msgs.find((m) => m.type === "resume_result") as { success: boolean; code: string };
    expect(result?.success).toBe(false);
    expect(result?.code).toBe("resume.already_active");
  }, 30_000);

  // 6.2 — the probe must not over-block: a candidate with no carrier reads as
  // dead, so a genuine loss still resumes.
  it("keeper probe: no sidecar means dead, a live sidecar means alive", async () => {
    vi.resetModules();
    const { getKeeperManager } = await import("../spawn-process/process-manager.js");
    const km = getKeeperManager();
    const DEAD = "bbbbcccc-2222-3333-4444-555555555555";
    const ALIVE = "ccccdddd-2222-3333-4444-555555555555";
    expect(km.isKeeperAlive(DEAD)).toBe(false);

    mkdirSync(km.sessionsDir, { recursive: true });
    const pidFile = path.join(km.sessionsDir, `${ALIVE}.rpc.sock.pid`);
    writeFileSync(pidFile, String(process.pid));
    expect(km.isKeeperAlive(ALIVE)).toBe(true);
    rmSync(pidFile, { force: true });
  });

  // 1.4 — the offer must not be rendered before liveness is resolved: nothing
  // is broadcast until the grace window closes.
  it("ask mode: no offer frame before the grace window closes", async () => {
    writeConfig("ask");
    writeBootState("idle");
    const ID = "9999aaaa-2222-3333-4444-555555555555";
    seedCandidate(sessionsDir, ID);
    const port = await boot();

    // Well inside the window (grace = restart quiesce + headroom = 7s).
    const early = await collect(port, 1_500);
    expect(early.filter((m) => m.type === "recovery_offer")).toHaveLength(0);
    // After it closes, exactly one offer carrying the survivor.
    expect(offersIn(await collect(port, 8_000))).toContain(ID);
  }, 30_000);
});
