/**
 * SPIKE / RED repro (explore-mode diagnostic, NOT a fix).
 *
 * The cold-start recovery offer must be gated by PROCESS LIVENESS, not by the
 * on-disk `live:true` marker alone. A session is only worth a "Reopen" offer
 * when the process-carrier that held its pi is genuinely gone. There are two
 * liveness channels the current disk-only classifier ignores:
 *
 *   Class 1 — KEEPER / headless sessions: pi liveness IS synchronously
 *     probeable at cold start via the `<sid>.rpc.sock.pid` scan +
 *     isProcessAlive (rpc-keeper-sidecar / headless-spawn specs). The server
 *     reclaims these at start() BEFORE the offer is broadcast. A candidate
 *     whose keeper+pi the scan finds alive was never lost.
 *
 *   Class 2 — NON-KEEPER sessions (tmux / TUI / mDNS-discovery bridges): no
 *     socket to probe. Liveness is revealed only when the bridge re-discovers
 *     the server and REATTACHES — asynchronously, AFTER the offer fires. A
 *     reattaching bridge proves the session is alive.
 *
 * A plain server RESTART (/api/restart → process.exit(0) WITHOUT stop()) leaves
 * every running session `live:true` + non-`ended` on disk — indistinguishable
 * from a crash to the disk-only classifier. So it phantom-offers sessions whose
 * keeper survived (Class 1) or whose bridge reattaches (Class 2). Reopening a
 * still-alive session double-spawns pi for one sessionId → gateway map goes
 * last-write-wins → "can't send messages".
 *
 * This test asserts the CORRECT end state:
 *   - keeper-alive candidate  → NOT offered
 *   - bridge-reattach candidate → NOT offered
 *   - genuinely-dead candidate  → STILL offered (the feature must still work)
 * It is EXPECTED RED against current code (offer includes all three).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { WebSocket } from "ws";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function seedCandidate(sessionsDir: string, id: string, meta: Record<string, unknown>): string {
  const cwdDir = path.join(sessionsDir, id.slice(0, 4)); // distinct cwd per candidate
  mkdirSync(cwdDir, { recursive: true });
  const jsonl = path.join(cwdDir, `2026-06-30T10-00-00-000Z_${id}.jsonl`);
  writeFileSync(jsonl, JSON.stringify({ type: "session", id, cwd: cwdDir }) + "\n");
  writeFileSync(jsonl.replace(/\.jsonl$/, ".meta.json"), JSON.stringify({
    source: "cli", cwd: cwdDir, status: "streaming",
    startedAt: Date.now(), cachedAt: Date.now() + 60_000,
    live: true, ...meta,
  }));
  return jsonl;
}

// ~/.pi/dashboard/{config.json, sessions/, headless-pids.json} live under the
// ephemeral HOME set by `npm test` (setup-home tripwire). Snapshot/restore keeps
// the suite self-cleaning within that HOME.
const DASH_DIR = path.join(os.homedir(), ".pi", "dashboard");
const CONFIG_PATH = path.join(DASH_DIR, "config.json");
const KEEPER_SOCK_DIR = path.join(DASH_DIR, "sessions");
const PID_FILE = path.join(DASH_DIR, "headless-pids.json");
let configSnapshot: string | null = null;

function writeAskConfig(): void {
  mkdirSync(DASH_DIR, { recursive: true });
  configSnapshot = existsSync(CONFIG_PATH) ? readFileSync(CONFIG_PATH, "utf-8") : null;
  writeFileSync(CONFIG_PATH, JSON.stringify({ reopenSessionsAfterShutdown: "ask" }));
}
function restoreConfig(): void {
  if (configSnapshot !== null) writeFileSync(CONFIG_PATH, configSnapshot);
  else if (existsSync(CONFIG_PATH)) rmSync(CONFIG_PATH);
  configSnapshot = null;
  rmSync(KEEPER_SOCK_DIR, { recursive: true, force: true });
  if (existsSync(PID_FILE)) rmSync(PID_FILE);
}

describe("SPIKE: recovery offer must be gated by process liveness (keeper + bridge)", () => {
  let sessionsDir: string;
  let server: any;

  beforeEach(() => { sessionsDir = mkdtempSync(path.join(os.tmpdir(), "pi-spike-")); });
  afterEach(async () => {
    restoreConfig();
    try { await server?.stop(); } catch {}
    vi.unstubAllEnvs();
    vi.resetModules();
    rmSync(sessionsDir, { recursive: true, force: true });
  });

  it("offers ONLY the genuinely-dead session; excludes keeper-alive and reattached", async () => {
    writeAskConfig();
    vi.stubEnv("PI_CODING_AGENT_SESSION_DIR", sessionsDir);
    vi.resetModules();
    const { createServer } = await import("../server.js");

    // Three restart-crash-shaped candidates (live:true + non-ended on disk).
    const KEEPER = "keee1111-2222-3333-4444-555555555555"; // Class 1: keeper survived
    const BRIDGE = "brid1111-2222-3333-4444-555555555555"; // Class 2: bridge reattaches
    const DEAD = "dead1111-2222-3333-4444-555555555555";   // control: truly gone
    seedCandidate(sessionsDir, KEEPER, {});
    const bridgeJsonl = seedCandidate(sessionsDir, BRIDGE, {});
    seedCandidate(sessionsDir, DEAD, {});

    // Class 1 fixture: an alive keeper PID sidecar for KEEPER. The keeper scan
    // (cleanupKeeperOrphans → discoverExistingKeepers) reads `<sid>.rpc.sock.pid`,
    // checks isProcessAlive, and (isPiAlive defaults true) reports it live.
    // process.pid is this test runner — guaranteed alive, never killed because
    // the pi-alive gate short-circuits true.
    mkdirSync(KEEPER_SOCK_DIR, { recursive: true });
    writeFileSync(path.join(KEEPER_SOCK_DIR, `${KEEPER}.rpc.sock.pid`), String(process.pid));

    // Cold start (ask mode). Disk-only classifier flags ALL THREE as candidates
    // today; keeper reclaim runs in start() before the offer broadcast.
    server = await createServer({
      port: 0, piPort: 0, host: "127.0.0.1", dev: true,
      autoShutdown: false, shutdownIdleSeconds: 999, tunnel: false,
    });
    await server.start();
    const piPort = server.piPort();
    const httpPort = server.httpPort();

    // Class 2: BRIDGE's pi survived the restart — its bridge reattaches now.
    const cwdB = path.join(sessionsDir, BRIDGE.slice(0, 4));
    const bridge = new WebSocket(`ws://127.0.0.1:${piPort}`);
    await new Promise<void>((resolve) => {
      bridge.on("open", () => {
        bridge.send(JSON.stringify({ type: "session_register", sessionId: BRIDGE, cwd: cwdB, source: "cli", sessionFile: bridgeJsonl }));
        bridge.send(JSON.stringify({ type: "replay_complete", sessionId: BRIDGE }));
        bridge.send(JSON.stringify({ type: "event_forward", sessionId: BRIDGE, event: { eventType: "message_start", timestamp: Date.now(), data: {} } }));
        setTimeout(resolve, 300);
      });
    });

    // A browser connecting now should be offered to reopen ONLY the dead one.
    const browser = new WebSocket(`ws://127.0.0.1:${httpPort}/ws`);
    const msgs: Record<string, unknown>[] = [];
    await new Promise<void>((resolve) => {
      browser.on("open", () => {
        browser.on("message", (raw) => { try { msgs.push(JSON.parse(raw.toString())); } catch {} });
        setTimeout(resolve, 300);
      });
    });
    bridge.close();
    browser.close();

    const offeredIds = msgs
      .filter((m) => m.type === "recovery_offer")
      .flatMap((o) => (o.candidates as any[]).map((c) => c.sessionId));

    // The feature must still work for a genuine loss.
    expect(offeredIds).toContain(DEAD);
    // ← FAIL TODAY: both are phantom-offered because the classifier is disk-only.
    expect(offeredIds).not.toContain(KEEPER);
    expect(offeredIds).not.toContain(BRIDGE);
  }, 15_000);
});
