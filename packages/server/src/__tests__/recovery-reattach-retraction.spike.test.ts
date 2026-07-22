/**
 * SPIKE / RED repro (explore-mode diagnostic, NOT a fix).
 *
 * Reproduces the "phantom reopen on server restart" defect + its downstream
 * "reopened sessions can't receive messages" symptom.
 *
 * Scenario modelled: a plain server RESTART (/api/restart → process.exit(0)
 * WITHOUT server.stop()), so a still-running session keeps `live:true` +
 * non-`ended` status on disk. The pi process SURVIVES the restart and its
 * bridge REATTACHES to the new server.
 *
 * Correct behaviour: a bridge that reattaches PROVES the session is alive, so
 * it must be RETRACTED from the cold-start recovery offer (you only offer to
 * reopen sessions with no live bridge). Reopening an alive session double-
 * spawns pi for one sessionId → the gateway's session→connection map goes
 * last-write-wins → sends route to a zombie → "can't send messages".
 *
 * This test asserts the CORRECT behaviour, so it is EXPECTED TO FAIL against
 * current code (the offer is never retracted on reattach). See explore-mode
 * findings for the full root-cause trace.
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

describe("SPIKE: recovery offer must retract a candidate whose bridge reattaches", () => {
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

  it("reattached (still-alive) session is NOT offered for reopen", async () => {
    writeAskConfig();
    vi.stubEnv("PI_CODING_AGENT_SESSION_DIR", sessionsDir);
    vi.resetModules();
    const { createServer } = await import("../server.js");

    // Disk state left by a RESTART (no clean stop): live:true + non-ended.
    const SID = "spike111-2222-3333-4444-555555555555";
    seedSidecar(sessionsDir, SID, { live: true, status: "streaming" });
    const sessionFile = path.join(sessionsDir, "proj", `2026-06-30T10-00-00-000Z_${SID}.jsonl`);
    const cwd = path.join(sessionsDir, "proj");

    // Cold start the replacement server (ask mode). Classifier flags SID a
    // candidate purely from disk and holds a pending recovery offer.
    server = await createServer({
      port: 0, piPort: 0, host: "127.0.0.1", dev: true,
      autoShutdown: false, shutdownIdleSeconds: 999, tunnel: false,
    });
    await server.start();
    const piPort = server.piPort();
    const httpPort = server.httpPort();

    expect(server.sessionManager.get(SID)?.recoveryCandidate).toBe(true);

    // The pi process SURVIVED the restart — its bridge reattaches now.
    const bridge = new WebSocket(`ws://127.0.0.1:${piPort}`);
    await new Promise<void>((resolve) => {
      bridge.on("open", () => {
        bridge.send(JSON.stringify({ type: "session_register", sessionId: SID, cwd, source: "cli", sessionFile }));
        bridge.send(JSON.stringify({ type: "replay_complete", sessionId: SID }));
        bridge.send(JSON.stringify({ type: "event_forward", sessionId: SID, event: { eventType: "message_start", timestamp: Date.now(), data: {} } }));
        setTimeout(resolve, 250);
      });
    });

    // The reattach proves the session is alive again.
    expect(server.sessionManager.get(SID)?.status).not.toBe("ended");
    expect(readSessionMeta(sessionFile)?.live).toBe(true);

    // A browser connecting now must NOT be offered to reopen a session whose
    // bridge is alive. ← FAILS TODAY: the pending offer still lists SID.
    const browser = new WebSocket(`ws://127.0.0.1:${httpPort}/ws`);
    const msgs: Record<string, unknown>[] = [];
    await new Promise<void>((resolve) => {
      browser.on("open", () => {
        browser.on("message", (raw) => { try { msgs.push(JSON.parse(raw.toString())); } catch {} });
        setTimeout(resolve, 250);
      });
    });
    bridge.close();
    browser.close();

    const offers = msgs.filter((m) => m.type === "recovery_offer");
    const offeredIds = offers.flatMap((o) => (o.candidates as any[]).map((c) => c.sessionId));
    expect(offeredIds).not.toContain(SID);
  }, 15_000);
});
