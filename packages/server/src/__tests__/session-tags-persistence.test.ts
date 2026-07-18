/**
 * Persistence contract for session tags: the debounced full-overwrite save
 * (`sessionToMeta` \u2014 the SAME enumeration server.ts wires into
 * `sessionManager.onChange`) must ENUMERATE `tags`, and `scanAllSessions`
 * must restore them on cold start.
 *
 *   - wipe-regression: set tags, then an UNRELATED meta change (drawer
 *     collapse), then flush \u2014 tags survive (they are re-enumerated on every
 *     full-overwrite save, not merged).
 *   - round-trip: the flushed `.meta.json` carries `tags` AND a fresh
 *     `scanAllSessions` (simulated restart) restores them.
 *
 * Using the real `sessionToMeta` guarantees no divergence from server.ts: if
 * the enumeration ever drops `tags`, this test fails alongside production.
 * See change: add-session-tags.
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

describe("session tags persistence", () => {
  let tmpDir: string;
  let mgr: SessionManager;
  let metaPersistence: MetaPersistence;
  let sessionFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tags-persist-"));
    const dir = path.join(tmpDir, "--test-cwd--");
    fs.mkdirSync(dir, { recursive: true });
    sessionFile = path.join(dir, "2026-03-30T21-39-43-034Z_tag-id.jsonl");
    // Minimal .jsonl so scanAllSessions treats the sidecar as non-orphaned.
    fs.writeFileSync(
      sessionFile,
      `${JSON.stringify({ type: "session", id: "tag-id", cwd: "/test/cwd", timestamp: "2026-03-30T21:39:43.034Z" })}\n`,
    );

    mgr = createMemorySessionManager();
    metaPersistence = createMetaPersistence();
    // Mirror server.ts exactly: full-overwrite save from the shared enumeration.
    mgr.onChange = (id) => {
      const s = mgr.get(id);
      if (!s?.sessionFile) return;
      metaPersistence.save(s.sessionFile, sessionToMeta(s));
    };

    mgr.register({ id: "tag-id", cwd: "/test/cwd", source: "tui", startedAt: 1000 });
    mgr.update("tag-id", { sessionFile, status: "ended" });
  });

  afterEach(() => {
    metaPersistence.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does NOT wipe tags on a subsequent unrelated meta save", () => {
    mgr.update("tag-id", { tags: ["feature", "backend"] });
    // Unrelated field change triggers another full-overwrite save.
    mgr.update("tag-id", { processDrawerCollapsed: true });
    metaPersistence.flushAll();

    const onDisk = readSessionMeta(sessionFile);
    expect(onDisk?.tags).toEqual(["feature", "backend"]);
    expect(onDisk?.processDrawerCollapsed).toBe(true);
  });

  it("round-trips tags through the sidecar and restores them on cold-start scan", () => {
    mgr.update("tag-id", { tags: ["docs"] });
    metaPersistence.flushAll();

    expect(readSessionMeta(sessionFile)?.tags).toEqual(["docs"]);

    // Simulated restart: fresh scan reads the sidecar back via sessionFromMeta.
    const result = scanAllSessions(tmpDir);
    const restored = result.sessions.find((s) => s.id === "tag-id");
    expect(restored?.tags).toEqual(["docs"]);
  });
});
