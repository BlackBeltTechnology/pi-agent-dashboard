/**
 * Cold-start restore normalizes recovery candidates to `ended` in ALL modes
 * (no exemption) while still flagging them `recoveryCandidate:true` so the
 * offer/auto-resume can re-hydrate them; non-candidates are likewise rewritten
 * to `ended`.
 * See change: fix-recovery-offer-dismiss-and-phantom-reopen (task 4.1).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Seed {
  id: string;
  live?: boolean;
  closedReason?: string;
  status?: string;
}

function seedSession(sessionsDir: string, cwdName: string, s: Seed): void {
  const cwdDir = path.join(sessionsDir, cwdName);
  mkdirSync(cwdDir, { recursive: true });
  const stamp = "2026-06-30T10-00-00-000Z";
  const jsonl = path.join(cwdDir, `${stamp}_${s.id}.jsonl`);
  writeFileSync(jsonl, JSON.stringify({ type: "session", id: s.id, cwd: cwdDir }) + "\n");
  const meta: Record<string, unknown> = {
    source: "cli",
    cwd: cwdDir,
    status: s.status ?? "streaming", // non-ended default, so we can observe normalization
    startedAt: Date.now(),
    cachedAt: Date.now() + 60_000, // future → scanner trusts cache, no re-extract
  };
  if (s.live !== undefined) meta.live = s.live;
  if (s.closedReason !== undefined) meta.closedReason = s.closedReason;
  writeFileSync(jsonl.replace(/\.jsonl$/, ".meta.json"), JSON.stringify(meta, null, 2));
}

describe("cold-start recovery-candidate normalization", () => {
  let sessionsDir: string;
  let server: { stop: () => Promise<void>; sessionManager: { get: (id: string) => any } };

  beforeEach(() => {
    sessionsDir = mkdtempSync(path.join(os.tmpdir(), "pi-coldstart-"));
  });

  afterEach(async () => {
    try { await server?.stop(); } catch { /* ignore */ }
    vi.unstubAllEnvs();
    vi.resetModules();
    rmSync(sessionsDir, { recursive: true, force: true });
  });

  it("normalizes candidate to ended (still flagged); forces non-candidate to ended", async () => {
    // crash: live:true + non-ended status → candidate
    seedSession(sessionsDir, "proj", { id: "cand-1111-2222-3333-444444444444", live: true });
    // idle/app-quit clean stop(): live:false, status non-ended → NOT candidate
    seedSession(sessionsDir, "proj", { id: "clean-1111-2222-3333-444444444444", live: false });
    // dashboard ✕: live:true but closedReason:manual (+ status ended) → NOT candidate
    seedSession(sessionsDir, "proj", { id: "manual-111-2222-3333-444444444444", live: true, closedReason: "manual" });
    // pi TUI quit: clean unregister persisted status:ended, live:true left set → NOT candidate
    seedSession(sessionsDir, "proj", { id: "tuiqt-11-2222-3333-444444444444", live: true, status: "ended" });

    vi.stubEnv("PI_CODING_AGENT_SESSION_DIR", sessionsDir);
    vi.resetModules();
    const { createServer } = await import("../server.js");
    server = await createServer({
      port: 0, piPort: 0, host: "127.0.0.1", dev: true,
      autoShutdown: false, shutdownIdleSeconds: 999, tunnel: false,
    }) as any;
    await (server as any).start();
    await wait(50);

    // ask-mode candidate: normalized to `ended` (no exemption) yet still
    // flagged so it appears in the offer for explicit reopen.
    const cand = server.sessionManager.get("cand-1111-2222-3333-444444444444");
    expect(cand?.status).toBe("ended");
    expect(cand?.recoveryCandidate).toBe(true);

    const clean = server.sessionManager.get("clean-1111-2222-3333-444444444444");
    expect(clean?.status).toBe("ended");
    expect(clean?.recoveryCandidate).toBeFalsy();

    const manual = server.sessionManager.get("manual-111-2222-3333-444444444444");
    expect(manual?.status).toBe("ended");
    expect(manual?.recoveryCandidate).toBeFalsy();

    // TUI quit: persisted status:ended → excluded by the status half, stays ended.
    const tui = server.sessionManager.get("tuiqt-11-2222-3333-444444444444");
    expect(tui?.status).toBe("ended");
    expect(tui?.recoveryCandidate).toBeFalsy();
  });
});
