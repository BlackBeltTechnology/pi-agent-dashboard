/**
 * End-to-end: spawn → stamp live (real event wiring) → simulate unclean exit
 * (server abandoned, NO clean stop) → cold start a fresh server → the
 * interrupted session is the only recovery candidate offered. Manual-close
 * and clean-stop end-states (seeded as their code paths produce them) are NOT
 * offered. See change: reopen-sessions-after-shutdown (task 7.1).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { WebSocket } from "ws";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { readSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function seedSidecar(sessionsDir: string, id: string, meta: Record<string, unknown>): void {
  const cwdDir = path.join(sessionsDir, "proj");
  mkdirSync(cwdDir, { recursive: true });
  const jsonl = path.join(cwdDir, `2026-06-30T10-00-00-000Z_${id}.jsonl`);
  writeFileSync(jsonl, JSON.stringify({ type: "session", id, cwd: cwdDir }) + "\n");
  writeFileSync(jsonl.replace(/\.jsonl$/, ".meta.json"), JSON.stringify({
    source: "cli", cwd: cwdDir, status: "ended",
    startedAt: Date.now(), cachedAt: Date.now() + 60_000, ...meta,
  }));
}

// NOTE: HOME is an ephemeral tmp dir under `npm test` (root-script override +
// setup-home tripwire), so this never touches a real ~/.pi. The snapshot/
// restore below additionally makes the suite self-cleaning within that HOME
// so sibling tests see the config they expect.
const CONFIG_PATH = path.join(os.homedir(), ".pi", "dashboard", "config.json");
let configSnapshot: string | null = null;

function writeAskConfig(): void {
  mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  configSnapshot = existsSync(CONFIG_PATH) ? readFileSync(CONFIG_PATH, "utf-8") : null;
  writeFileSync(CONFIG_PATH, JSON.stringify({ reopenSessionsAfterShutdown: "ask" }));
}

function restoreConfig(): void {
  if (configSnapshot !== null) writeFileSync(CONFIG_PATH, configSnapshot);
  else if (existsSync(CONFIG_PATH)) rmSync(CONFIG_PATH);
  configSnapshot = null;
}

describe("recovery end-to-end", () => {
  let sessionsDir: string;
  let serverA: any;
  let serverB: any;

  beforeEach(() => {
    sessionsDir = mkdtempSync(path.join(os.tmpdir(), "pi-e2e-"));
  });
  afterEach(async () => {
    restoreConfig();
    try { await serverA?.stop(); } catch {}
    try { await serverB?.stop(); } catch {}
    vi.unstubAllEnvs();
    vi.resetModules();
    rmSync(sessionsDir, { recursive: true, force: true });
  });

  it("only the interrupted (crashed) session is offered on cold start", async () => {
    writeAskConfig();
    vi.stubEnv("PI_CODING_AGENT_SESSION_DIR", sessionsDir);
    vi.resetModules();
    const { createServer } = await import("../server.js");

    // ── Server A: stamp live via real wiring, then "crash" (never stop). ──
    serverA = await createServer({
      port: 0, piPort: 0, host: "127.0.0.1", dev: true,
      autoShutdown: false, shutdownIdleSeconds: 999, tunnel: false,
    });
    await serverA.start();
    const piPortA = serverA.piPort();

    const SID = "crash111-2222-3333-4444-555555555555";
    const sessionFile = path.join(sessionsDir, "proj", `2026-06-30T10-00-00-000Z_${SID}.jsonl`);
    mkdirSync(path.dirname(sessionFile), { recursive: true });
    writeFileSync(sessionFile, JSON.stringify({ type: "session", id: SID, cwd: path.join(sessionsDir, "proj") }) + "\n");

    const ws = new WebSocket(`ws://127.0.0.1:${piPortA}`);
    await new Promise<void>((resolve) => {
      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "session_register", sessionId: SID, cwd: path.join(sessionsDir, "proj"), source: "cli", sessionFile }));
        ws.send(JSON.stringify({ type: "replay_complete", sessionId: SID }));
        ws.send(JSON.stringify({ type: "event_forward", sessionId: SID, event: { eventType: "message_start", timestamp: Date.now(), data: {} } }));
        setTimeout(resolve, 150);
      });
    });
    ws.close();
    // Sidecar now durably marks the session live (survives the "crash").
    expect(readSessionMeta(sessionFile)?.live).toBe(true);
    // Simulate unclean exit: abandon serverA WITHOUT calling stop().

    // Contrast end-states, exactly as their code paths leave them:
    seedSidecar(sessionsDir, "manual11-2222-3333-4444-555555555555", { live: false, closedReason: "manual" });
    seedSidecar(sessionsDir, "clean111-2222-3333-4444-555555555555", { live: false });

    // ── Server B: cold start on the same sessions dir (different ports). ──
    serverB = await createServer({
      port: 0, piPort: 0, host: "127.0.0.1", dev: true,
      autoShutdown: false, shutdownIdleSeconds: 999, tunnel: false,
    });
    await serverB.start();
    const browserPortB = serverB.httpPort();

    // The crashed candidate is normalized to `ended` (no exemption) yet still
    // flagged so it appears in the offer for explicit reopen.
    // See change: fix-recovery-offer-dismiss-and-phantom-reopen.
    const restored = serverB.sessionManager.get(SID);
    expect(restored?.recoveryCandidate).toBe(true);
    expect(restored?.status).toBe("ended");

    // Connect a browser to B and capture the recovery offer.
    const browser = new WebSocket(`ws://127.0.0.1:${browserPortB}/ws`);
    const msgs: Record<string, unknown>[] = [];
    await new Promise<void>((resolve) => {
      browser.on("open", () => {
        browser.on("message", (raw) => { try { msgs.push(JSON.parse(raw.toString())); } catch {} });
        setTimeout(resolve, 200);
      });
    });
    browser.close();

    const offers = msgs.filter((m) => m.type === "recovery_offer");
    expect(offers).toHaveLength(1);
    const ids = (offers[0].candidates as any[]).map((c) => c.sessionId);
    expect(ids).toContain(SID);
    expect(ids).not.toContain("manual11-2222-3333-4444-555555555555");
    expect(ids).not.toContain("clean111-2222-3333-4444-555555555555");
  }, 15_000); // heavy e2e: two full server boots + WS round-trips; 5s default is too tight under CI parallel load.

  it("shown once per dirty boot: dismiss + full restart yields no offer", async () => {
    writeAskConfig();
    vi.stubEnv("PI_CODING_AGENT_SESSION_DIR", sessionsDir);
    vi.resetModules();
    const { createServer } = await import("../server.js");

    // Seed a crashed candidate directly (live:true + non-ended status).
    const SID = "dirty111-2222-3333-4444-555555555555";
    seedSidecar(sessionsDir, SID, { live: true, status: "streaming" });

    // ── Server B: cold start, offer the candidate, then dismiss over WS. ──
    serverB = await createServer({
      port: 0, piPort: 0, host: "127.0.0.1", dev: true,
      autoShutdown: false, shutdownIdleSeconds: 999, tunnel: false,
    });
    await serverB.start();
    const portB = serverB.httpPort();

    const browser = new WebSocket(`ws://127.0.0.1:${portB}/ws`);
    const msgsB: Record<string, unknown>[] = [];
    await new Promise<void>((resolve) => {
      browser.on("open", () => {
        browser.on("message", (raw) => { try { msgsB.push(JSON.parse(raw.toString())); } catch {} });
        setTimeout(() => {
          // Durable dismiss: consumes the on-disk liveness marker.
          browser.send(JSON.stringify({ type: "recovery_dismiss", sessionIds: [SID] }));
          setTimeout(resolve, 200);
        }, 200);
      });
    });
    browser.close();
    expect(msgsB.filter((m) => m.type === "recovery_offer")).toHaveLength(1);
    // Marker consumed on disk.
    expect(readSessionMeta(path.join(sessionsDir, "proj", `2026-06-30T10-00-00-000Z_${SID}.jsonl`))?.live).toBe(false);

    // ── Full restart (no new unclean shutdown) → no candidate, no offer. ──
    await serverB.stop();
    serverA = await createServer({
      port: 0, piPort: 0, host: "127.0.0.1", dev: true,
      autoShutdown: false, shutdownIdleSeconds: 999, tunnel: false,
    });
    await serverA.start();
    const portC = serverA.httpPort();
    expect(serverA.sessionManager.get(SID)?.recoveryCandidate).toBeFalsy();

    const browser2 = new WebSocket(`ws://127.0.0.1:${portC}/ws`);
    const msgsC: Record<string, unknown>[] = [];
    await new Promise<void>((resolve) => {
      browser2.on("open", () => {
        browser2.on("message", (raw) => { try { msgsC.push(JSON.parse(raw.toString())); } catch {} });
        setTimeout(resolve, 200);
      });
    });
    browser2.close();
    expect(msgsC.filter((m) => m.type === "recovery_offer")).toHaveLength(0);
  }, 15_000); // heavy e2e: two full server boots + WS round-trips; 5s default is too tight under CI parallel load.
});
