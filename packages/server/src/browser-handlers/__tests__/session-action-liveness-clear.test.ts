/**
 * Manual close (handleShutdown) and force-kill (handleForceKill) durably
 * stamp `{ live:false, closedReason:"manual" }` so cold start does not treat
 * an intentional close as an interrupted-session recovery candidate.
 * See change: reopen-sessions-after-shutdown.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { readSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import { createMetaPersistence } from "../../persistence/meta-persistence.js";
import { handleShutdown, handleForceKill } from "../session-action-handler.js";
import type { BrowserHandlerContext } from "../handler-context.js";

describe("session-action liveness clearing", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "pi-liveclear-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeSessionFile(id: string): string {
    const sf = path.join(tmpDir, `${id}.jsonl`);
    writeFileSync(sf, "");
    return sf;
  }

  it("handleShutdown stamps live:false + closedReason:manual", async () => {
    const metaPersistence = createMetaPersistence();
    const sf = makeSessionFile("s-shutdown");
    metaPersistence.setLiveness(sf, { live: true, liveEpoch: 1 });

    const ctx = {
      sessionManager: { get: () => ({ id: "s1", sessionFile: sf }), unregister: () => {} },
      piGateway: { sendToSession: () => {} },
      headlessPidRegistry: { killBySessionId: async () => false },
      broadcast: () => {},
      metaPersistence,
    } as unknown as BrowserHandlerContext;

    await handleShutdown({ type: "shutdown", sessionId: "s1" } as any, ctx);

    const meta = readSessionMeta(sf);
    expect(meta?.live).toBe(false);
    expect(meta?.closedReason).toBe("manual");
    metaPersistence.dispose();
  });

  it("handleForceKill stamps live:false + closedReason:manual", async () => {
    const metaPersistence = createMetaPersistence();
    const sf = makeSessionFile("s-kill");
    metaPersistence.setLiveness(sf, { live: true, liveEpoch: 1 });

    const ctx = {
      ws: {},
      sessionManager: { get: () => ({ id: "s2", sessionFile: sf, pid: undefined, status: "streaming" }), update: () => {} },
      piGateway: { closeSession: () => true, sendToSession: () => true },
      headlessPidRegistry: { killBySessionId: async () => false },
      broadcast: () => {},
      sendTo: () => {},
      metaPersistence,
    } as unknown as BrowserHandlerContext;

    await handleForceKill({ type: "force_kill", sessionId: "s2" } as any, ctx);

    const meta = readSessionMeta(sf);
    expect(meta?.live).toBe(false);
    expect(meta?.closedReason).toBe("manual");
    metaPersistence.dispose();
  });
});
