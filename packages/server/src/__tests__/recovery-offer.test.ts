/**
 * Cold-start recovery offer, gated by `reopenSessionsAfterShutdown`:
 *   ask  → broadcast/replay one recovery_offer to connected clients
 *   off  → no offer
 *   auto → no prompt (resumes server-side)
 * Plus the zero-candidate no-offer case.
 * See change: reopen-sessions-after-shutdown (task 5.1).
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { RECOVERY_REATTACH_GRACE_MS } from "@blackbelt-technology/pi-dashboard-shared/recovery-timing.js";

/**
 * The `ask` offer is broadcast only AFTER the reattach grace window closes, so
 * a candidate that will be retracted is never rendered. Every collect window
 * here must therefore outlast it — including the negative cases, where waiting
 * is what makes "no offer" meaningful.
 * See change: fix-recovery-exit-intent (D6).
 */
const OFFER_WAIT_MS = RECOVERY_REATTACH_GRACE_MS + 800;

function seedCandidate(sessionsDir: string, id: string, live: boolean): void {
  const cwdDir = path.join(sessionsDir, "proj");
  mkdirSync(cwdDir, { recursive: true });
  const jsonl = path.join(cwdDir, `2026-06-30T10-00-00-000Z_${id}.jsonl`);
  writeFileSync(jsonl, `${JSON.stringify({ type: "session", id, cwd: cwdDir })}\n`);
  writeFileSync(jsonl.replace(/\.jsonl$/, ".meta.json"), JSON.stringify({
    source: "cli", cwd: cwdDir, status: "streaming",
    startedAt: Date.now(), cachedAt: Date.now() + 60_000, live,
  }));
}

function writeConfig(mode: string): void {
  const dir = path.join(os.homedir(), ".pi", "dashboard");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "config.json"), JSON.stringify({ reopenSessionsAfterShutdown: mode }));
}

async function connectAndCollect(port: number, ms: number = OFFER_WAIT_MS): Promise<Record<string, unknown>[]> {
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

/**
 * Connect, collect any offer, then send `recovery_dismiss` for the given ids
 * and hold the socket open long enough for the server to consume the markers
 * and flush. Returns the messages seen before the dismiss.
 * See change: fix-recovery-offer-dismiss-and-phantom-reopen.
 */
async function connectAndDismiss(port: number, sessionIds: string[]): Promise<Record<string, unknown>[]> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const msgs: Record<string, unknown>[] = [];
  await new Promise<void>((resolve) => {
    ws.on("open", () => {
      ws.on("message", (raw) => { try { msgs.push(JSON.parse(raw.toString())); } catch {} });
      setTimeout(() => {
        ws.send(JSON.stringify({ type: "recovery_dismiss", sessionIds }));
        setTimeout(resolve, 150);
      }, OFFER_WAIT_MS);
    });
  });
  ws.close();
  return msgs;
}

describe("cold-start recovery offer", () => {
  let sessionsDir: string;
  let server: { stop: () => Promise<void>; httpPort: () => number | null; sessionManager: { get: (id: string) => any } };

  beforeEach(() => {
    sessionsDir = mkdtempSync(path.join(os.tmpdir(), "pi-offer-"));
  });
  afterEach(async () => {
    try { await server?.stop(); } catch {}
    vi.unstubAllEnvs();
    vi.resetModules();
    rmSync(sessionsDir, { recursive: true, force: true });
  });

  async function boot(): Promise<number> {
    vi.stubEnv("PI_CODING_AGENT_SESSION_DIR", sessionsDir);
    vi.resetModules();
    const { createServer } = await import("../server.js");
    server = await createServer({
      port: 0, piPort: 0, host: "127.0.0.1", dev: true,
      autoShutdown: false, shutdownIdleSeconds: 999, tunnel: false,
    }) as any;
    await (server as any).start();
    return server.httpPort()!;
  }

  it("ask mode: replays one recovery_offer with the candidate to a connecting client", async () => {
    writeConfig("ask");
    seedCandidate(sessionsDir, "aaaa1111-2222-3333-4444-555555555555", true);
    const port = await boot();
    const msgs = await connectAndCollect(port);
    const offers = msgs.filter((m) => m.type === "recovery_offer");
    expect(offers).toHaveLength(1);
    expect((offers[0].candidates as any[]).map((c) => c.sessionId)).toContain("aaaa1111-2222-3333-4444-555555555555");
  }, 45_000); // cold transform + the deferred-broadcast wait

  it("off mode: no recovery_offer", async () => {
    writeConfig("off");
    seedCandidate(sessionsDir, "bbbb1111-2222-3333-4444-555555555555", true);
    const port = await boot();
    const msgs = await connectAndCollect(port);
    expect(msgs.filter((m) => m.type === "recovery_offer")).toHaveLength(0);
  }, 20_000);

  it("off mode: interrupted session is normalized to ended (no zombie)", async () => {
    // Regression (CodeRabbit PR #210): in `off` mode an interrupted session
    // must NOT be exempted from normalization, or it stays non-`ended` forever.
    writeConfig("off");
    const id = "dddd1111-2222-3333-4444-555555555555";
    seedCandidate(sessionsDir, id, true);
    await boot();
    const s = server.sessionManager.get(id);
    expect(s?.status).toBe("ended");
    expect(s?.recoveryCandidate).toBeFalsy();
  });

  it("auto mode: no recovery_offer (resumes without prompting)", async () => {
    writeConfig("auto");
    seedCandidate(sessionsDir, "cccc1111-2222-3333-4444-555555555555", true);
    const port = await boot();
    const msgs = await connectAndCollect(port);
    expect(msgs.filter((m) => m.type === "recovery_offer")).toHaveLength(0);
  }, 20_000);

  it("ask mode: offer shown once per dirty boot even WITHOUT dismiss", async () => {
    // The offer's liveness sentinel is consumed when the offer is broadcast,
    // so a session the user merely ignored (or hid, or reopened) is NOT
    // re-offered on the next cold boot with no new unclean shutdown. This is
    // the phantom-reopen fix: without it, restore()'s in-memory-only
    // normalization leaves live:true on disk and every cold boot re-offers.
    // See change: fix-recovery-offer-dismiss-and-phantom-reopen.
    writeConfig("ask");
    const id = "ffff1111-2222-3333-4444-555555555555";
    seedCandidate(sessionsDir, id, true);
    const port = await boot();

    // First boot offers the candidate.
    const first = await connectAndCollect(port);
    expect(first.filter((m) => m.type === "recovery_offer")).toHaveLength(1);
    // Marker consumed at broadcast time — no dismiss, no reopen.
    const metaFile = path.join(sessionsDir, "proj", `2026-06-30T10-00-00-000Z_${id}.meta.json`);
    expect(JSON.parse(readFileSync(metaFile, "utf-8")).live).toBe(false);

    // Full restart with no new unclean shutdown → no candidate, no offer.
    await server.stop();
    const port2 = await boot();
    const second = await connectAndCollect(port2);
    expect(second.filter((m) => m.type === "recovery_offer")).toHaveLength(0);
    expect(server.sessionManager.get(id)?.recoveryCandidate).toBeFalsy();
  }, 45_000); // two full server boots, each waiting out the grace window.

  it("ask mode: recovery_dismiss consumes the marker and stops replay", async () => {
    // Durable dismiss (Chrome sentinel model): the server consumes the on-disk
    // liveness marker so a full restart never re-offers, and nulls its held
    // pending offer so a later-connecting client gets no replay.
    writeConfig("ask");
    const id = "eeee1111-2222-3333-4444-555555555555";
    seedCandidate(sessionsDir, id, true);
    const port = await boot();

    // First client sees the offer, then dismisses it.
    const first = await connectAndDismiss(port, [id]);
    expect(first.filter((m) => m.type === "recovery_offer")).toHaveLength(1);

    // A client connecting afterward gets NO replayed offer (pending offer nulled).
    const second = await connectAndCollect(port);
    expect(second.filter((m) => m.type === "recovery_offer")).toHaveLength(0);

    // Full restart with no new unclean shutdown → marker consumed → no candidate.
    await server.stop();
    const port2 = await boot();
    const third = await connectAndCollect(port2);
    expect(third.filter((m) => m.type === "recovery_offer")).toHaveLength(0);
    expect(server.sessionManager.get(id)?.recoveryCandidate).toBeFalsy();
  }, 45_000); // two full server boots, each waiting out the grace window.

  it("zero candidates: no offer even in ask mode", async () => {
    writeConfig("ask");
    seedCandidate(sessionsDir, "dddd1111-2222-3333-4444-555555555555", false); // live:false → not a candidate
    const port = await boot();
    const msgs = await connectAndCollect(port);
    expect(msgs.filter((m) => m.type === "recovery_offer")).toHaveLength(0);
  }, 20_000);

  // A reopen attempted while a candidate's liveness is still unresolved (grace
  // window open) is REFUSED (no double-spawn) AND must NOT cost the user the
  // offer — it is still broadcast once the window closes.
  // See changes: fix-recovery-offer-bridge-liveness-gate, fix-recovery-exit-intent.
  it("ask mode: resume during the grace window is refused and does NOT drop the offer", async () => {
    writeConfig("ask");
    const id = "a11ce111-2222-3333-4444-555555555555";
    seedCandidate(sessionsDir, id, true);
    const port = await boot();

    // First client: reopen immediately — inside the window, before any offer
    // has even been broadcast.
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const msgs: Record<string, unknown>[] = [];
    await new Promise<void>((resolve) => {
      ws.on("open", () => {
        ws.on("message", (raw) => { try { msgs.push(JSON.parse(raw.toString())); } catch {} });
        setTimeout(() => {
          ws.send(JSON.stringify({ type: "resume_session", sessionId: id, mode: "continue" }));
          setTimeout(resolve, 150);
        }, 100);
      });
    });
    ws.close();

    // Nothing was rendered while liveness was unresolved …
    expect(msgs.filter((m) => m.type === "recovery_offer")).toHaveLength(0);
    // … and the reopen was refused (no pi spawned).
    const result = msgs.find((m) => m.type === "resume_result") as any;
    expect(result?.success).toBe(false);
    // The offer survived the refused reopen → a later client sees it, with the
    // grace deadline still on the wire for a mid-window connect.
    const second = await connectAndCollect(port);
    const offers = second.filter((m) => m.type === "recovery_offer");
    expect(offers).toHaveLength(1);
    expect(typeof (offers[0] as any).graceUntil).toBe("number");
  }, 45_000);
});
