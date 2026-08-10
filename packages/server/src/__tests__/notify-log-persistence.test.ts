/**
 * Persistence contract for the notify log (test-plan #F7).
 *
 * The rest of a transcript survives `/api/restart` via the event store, but a
 * notify is not a `DashboardEvent` — it survives only because the bounded log
 * is enumerated by the debounced full-overwrite save (`sessionToMeta`, the SAME
 * enumeration server.ts wires into `sessionManager.onChange`) and restored by
 * the cold-start scan.
 *
 * See change: split-notify-from-prompt-request.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import type { NotifyLogEntry } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMetaPersistence, type MetaPersistence } from "../persistence/meta-persistence.js";
import { createMemorySessionManager, type SessionManager } from "../session/memory-session-manager.js";
import { scanAllSessions } from "../session/session-scanner.js";
import { sessionToMeta } from "../session/session-to-meta.js";

const LOG: NotifyLogEntry[] = [
  { notifyId: "n1", message: "first", level: "info" },
  { notifyId: "n2", message: "second", level: "success" },
];

describe("notify log persistence", () => {
  let tmpDir: string;
  let mgr: SessionManager;
  let metaPersistence: MetaPersistence;
  let sessionFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "notify-persist-"));
    const dir = path.join(tmpDir, "--test-cwd--");
    fs.mkdirSync(dir, { recursive: true });
    sessionFile = path.join(dir, "2026-03-30T21-39-43-034Z_notify-id.jsonl");
    fs.writeFileSync(
      sessionFile,
      `${JSON.stringify({ type: "session", id: "notify-id", cwd: "/test/cwd", timestamp: "2026-03-30T21:39:43.034Z" })}\n`,
    );

    mgr = createMemorySessionManager();
    metaPersistence = createMetaPersistence();
    mgr.onChange = (id) => {
      const s = mgr.get(id);
      if (!s?.sessionFile) return;
      metaPersistence.save(s.sessionFile, sessionToMeta(s));
    };

    mgr.register({ id: "notify-id", cwd: "/test/cwd", source: "tui", startedAt: 1000 });
    mgr.update("notify-id", { sessionFile, status: "ended" });
  });

  afterEach(() => {
    metaPersistence.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("#F7 round-trips the notify log and restores it on a cold-start scan", () => {
    mgr.update("notify-id", { notifyLog: LOG });
    metaPersistence.flushAll();

    expect(readSessionMeta(sessionFile)?.notifyLog).toEqual(LOG);

    // Simulated restart: fresh scan reads the sidecar back via sessionFromMeta.
    const restored = scanAllSessions(tmpDir).sessions.find((s) => s.id === "notify-id");
    expect(restored?.notifyLog).toEqual(LOG);
  });

  it("does NOT wipe the log on a subsequent unrelated meta save", () => {
    mgr.update("notify-id", { notifyLog: LOG });
    mgr.update("notify-id", { processDrawerCollapsed: true });
    metaPersistence.flushAll();

    expect(readSessionMeta(sessionFile)?.notifyLog).toEqual(LOG);
  });

  it("preserves the log across a bridge reattach", () => {
    mgr.update("notify-id", { notifyLog: LOG });
    metaPersistence.flushAll();

    mgr.register({
      id: "notify-id",
      cwd: "/test/cwd",
      source: "tui",
      startedAt: 1000,
      sessionFile,
      registerReason: "reattach",
    });

    expect(mgr.get("notify-id")?.notifyLog).toEqual(LOG);
    metaPersistence.flushAll();
    expect(readSessionMeta(sessionFile)?.notifyLog).toEqual(LOG);
  });
});
