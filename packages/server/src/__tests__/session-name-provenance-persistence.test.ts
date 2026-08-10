/**
 * Persistence contract for session-name provenance (`nameSource`): the
 * debounced full-overwrite save (`sessionToMeta` — the SAME enumeration
 * server.ts wires into `sessionManager.onChange`) must ENUMERATE `nameSource`,
 * and `scanAllSessions` must restore it on cold start. Without both, the
 * auto-naming lockout would silently reset across an unrelated save or a
 * server restart.
 *
 * Mirrors session-tags-persistence.test.ts. See change: add-auto-session-naming.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemorySessionManager, type SessionManager } from "../session/memory-session-manager.js";
import { createMetaPersistence, type MetaPersistence } from "../persistence/meta-persistence.js";
import { scanAllSessions } from "../session/session-scanner.js";
import { sessionToMeta } from "../session/session-to-meta.js";

describe("session name provenance persistence", () => {
  let tmpDir: string;
  let mgr: SessionManager;
  let metaPersistence: MetaPersistence;
  let sessionFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "namesrc-persist-"));
    const dir = path.join(tmpDir, "--test-cwd--");
    fs.mkdirSync(dir, { recursive: true });
    sessionFile = path.join(dir, "2026-03-30T21-39-43-034Z_name-id.jsonl");
    fs.writeFileSync(
      sessionFile,
      `${JSON.stringify({ type: "session", id: "name-id", cwd: "/test/cwd", timestamp: "2026-03-30T21:39:43.034Z" })}\n`,
    );

    mgr = createMemorySessionManager();
    metaPersistence = createMetaPersistence();
    mgr.onChange = (id) => {
      const s = mgr.get(id);
      if (!s?.sessionFile) return;
      metaPersistence.save(s.sessionFile, sessionToMeta(s));
    };

    mgr.register({ id: "name-id", cwd: "/test/cwd", source: "tui", startedAt: 1000 });
    mgr.update("name-id", { sessionFile, status: "ended" });
  });

  afterEach(() => {
    metaPersistence.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does NOT wipe nameSource on a subsequent unrelated meta save", () => {
    mgr.update("name-id", { name: "Auth Refactor", nameSource: "auto" });
    mgr.update("name-id", { processDrawerCollapsed: true });
    metaPersistence.flushAll();

    const onDisk = readSessionMeta(sessionFile);
    expect(onDisk?.nameSource).toBe("auto");
    expect(onDisk?.name).toBe("Auth Refactor");
  });

  it("round-trips nameSource and restores it on cold-start scan", () => {
    mgr.update("name-id", { name: "Hand Typed", nameSource: "user" });
    metaPersistence.flushAll();

    expect(readSessionMeta(sessionFile)?.nameSource).toBe("user");

    const result = scanAllSessions(tmpDir);
    const restored = result.sessions.find((s) => s.id === "name-id");
    expect(restored?.nameSource).toBe("user");
  });
});
