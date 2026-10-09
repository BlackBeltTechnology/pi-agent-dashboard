/**
 * Register-seam + ended-routing wiring for the on-end archive of sessions
 * declared disposable (`archiveOnEnd`).
 *
 * - test-plan #E4: a declaration-only spawn (empty ref) reaches memory AND the
 *   sidecar at register, before any routine save.
 * - task 3.19: the single `sessionManager.onEnded` owner schedules the archive.
 * - test-plan #X1: a plugin end-handler reading the ended session 20 s after
 *   `→ ended` (unregister path) still finds it resident; the archive lands at
 *   the 30 s grace.
 *
 * Harness: `principal-owner-persist.test.ts` (real wireEvents + memory
 * session manager + browser gateway).
 * See change: archive-service-sessions-on-end.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wireEvents } from "../event-wiring.js";
import { createBrowserGateway } from "../pairing/browser-gateway.js";
import { createPendingForkRegistry } from "../pending/pending-fork-registry.js";
import { createPendingPluginRefRegistry } from "../pending/pending-plugin-ref-registry.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import { createArchiveSweeper, SERVICE_ARCHIVE_GRACE_MS } from "../session/archive-sweeper.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import type { SessionArchive } from "../session/session-archive.js";
import { makeFakeDirectoryService } from "./helpers/load-fixtures.js";

describe("archiveOnEnd register seam + ended routing", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "archive-on-end-"));
  });
  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function setup(opts: { onSessionEnded?: (id: string) => void } = {}) {
    const sessionManager = createMemorySessionManager();
    const piGateway = {
      start: vi.fn(), stop: vi.fn(), sendToSession: vi.fn(), clearHostPressure: vi.fn(),
      getConnectedSessionIds: vi.fn(() => []), hasSession: vi.fn(() => true), onEvent: undefined,
    } as any;
    const browserGateway = createBrowserGateway(sessionManager, createMemoryEventStore(() => false), piGateway);
    const refs = createPendingPluginRefRegistry();
    const archived: string[] = [];
    const sessionArchive = {
      archiveSession(id: string) {
        if (!sessionManager.get(id)) return { ok: false, error: "session not found" };
        sessionManager.remove(id);
        archived.push(id);
        return { ok: true };
      },
    } as unknown as SessionArchive;
    const archiveSweeper = createArchiveSweeper({
      sessionManager,
      sessionArchive,
      isViewed: () => false,
      getConfig: () => ({
        sessionList: { archiveAfterDays: 30, archiveSweepIntervalMinutes: 60, archiveServiceSessionsOnEnd: true },
      }),
    });
    const scheduleSpy = vi.spyOn(archiveSweeper, "scheduleServiceArchive");
    wireEvents({
      sessionManager,
      eventStore: createMemoryEventStore(() => false),
      piGateway,
      browserGateway,
      sessionOrderManager: {
        insert: vi.fn(), remove: vi.fn(), getOrder: vi.fn(() => []), reorder: vi.fn(),
        getAllOrders: vi.fn(() => ({})), moveToFront: vi.fn(), rekey: vi.fn(),
      } as any,
      preferencesStore: {
        getPinnedDirectories: () => [], setPinnedDirectories: () => {},
        getSessionOrder: () => ({}), setSessionOrder: () => {},
        getAutoNameSessions: () => false,
      } as any,
      pendingForkRegistry: createPendingForkRegistry(),
      directoryService: makeFakeDirectoryService().service,
      knownSessionIds: new Set<string>(),
      pendingDashboardSpawns: new Map<string, number>(),
      pendingPluginRefRegistry: refs,
      dispatchPluginSessionEnded: opts.onSessionEnded,
      archiveSweeper,
    } as any);
    return { sessionManager, piGateway, refs, archived, scheduleSpy, archiveSweeper };
  }

  function sessionFile(id: string): string {
    const file = path.join(tmpDir, `2026-09-24T00-00-00-000Z_${id}.jsonl`);
    fs.writeFileSync(file, `${JSON.stringify({ type: "session", id, cwd: "/repo" })}\n`);
    return file;
  }

  it("#E4 a declaration-only filing persists archiveOnEnd at register", () => {
    const { sessionManager, piGateway, refs } = setup();
    const file = sessionFile("s1");
    expect(refs.file("tok-1", {}, "automation", { archiveOnEnd: true })).toBe(true);
    sessionManager.register({ id: "s1", cwd: "/repo", source: "dashboard", startedAt: 1 } as any);

    piGateway.onEvent("s1", { type: "session_register", sessionId: "s1", cwd: "/repo", source: "dashboard", spawnToken: "tok-1", sessionFile: file });

    expect(sessionManager.get("s1")?.archiveOnEnd).toBe(true);
    expect(readSessionMeta(file)?.archiveOnEnd).toBe(true);
  });

  it("an undeclared register writes no archiveOnEnd", () => {
    const { sessionManager, piGateway } = setup();
    const file = sessionFile("s2");
    sessionManager.register({ id: "s2", cwd: "/repo", source: "tui", startedAt: 1 } as any);
    piGateway.onEvent("s2", { type: "session_register", sessionId: "s2", cwd: "/repo", source: "tui", sessionFile: file });
    expect(sessionManager.get("s2")?.archiveOnEnd).toBeUndefined();
    expect(readSessionMeta(file)?.archiveOnEnd).toBeUndefined();
  });

  it("the onEnded owner schedules the service archive on the ended transition", () => {
    const { sessionManager, scheduleSpy } = setup();
    sessionManager.register({ id: "s3", cwd: "/repo", source: "dashboard", startedAt: 1 } as any);
    sessionManager.update("s3", { archiveOnEnd: true });
    sessionManager.unregister("s3");
    expect(scheduleSpy).toHaveBeenCalledWith("s3");
  });

  it("#X1 an end-handler reading the session at +20 s finds it resident; archived at +30 s", () => {
    vi.useFakeTimers();
    const captured: Array<{ at: number; resident: boolean }> = [];
    let sm: ReturnType<typeof createMemorySessionManager> | undefined;
    const startedAt = Date.now();
    const { sessionManager, archived } = setup({
      onSessionEnded: (id) => {
        setTimeout(() => {
          captured.push({ at: Date.now() - startedAt, resident: sm?.get(id) !== undefined });
        }, 20_000);
      },
    });
    sm = sessionManager;
    sessionManager.register({ id: "run", cwd: "/repo", source: "dashboard", startedAt: 1 } as any);
    sessionManager.update("run", { archiveOnEnd: true });
    sessionManager.unregister("run");

    vi.advanceTimersByTime(20_000);
    expect(captured).toEqual([{ at: 20_000, resident: true }]);
    expect(archived).toEqual([]);

    vi.advanceTimersByTime(SERVICE_ARCHIVE_GRACE_MS - 20_000);
    expect(archived).toEqual(["run"]);
    expect(sessionManager.get("run")).toBeUndefined();
  });
});
