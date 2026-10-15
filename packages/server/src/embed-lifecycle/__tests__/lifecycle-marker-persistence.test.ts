/**
 * Persistence contract for the `lifecyclePolicy` marker (test-plan #E3, #E4):
 * the debounced full-overwrite save (`sessionToMeta`) MUST enumerate
 * `lifecyclePolicy`, and `scanAllSessions` MUST restore it on cold start — else
 * a server restart reclassifies an `ephemeral` session as `durable`
 * (absent ⇒ durable) and it escapes reaping forever, re-creating the reported
 * cross-restart accumulation.
 *
 * Mirrors session-name-provenance-persistence.test.ts.
 * See change: add-embed-session-lifecycle.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMetaPersistence, type MetaPersistence } from "../../persistence/meta-persistence.js";
import { createMemorySessionManager, type SessionManager } from "../../session/memory-session-manager.js";
import { scanAllSessions } from "../../session/session-scanner.js";
import { sessionToMeta } from "../../session/session-to-meta.js";
import { DEFAULT_EMBED_LIFECYCLE } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { createIdleReaper } from "../idle-reaper.js";
import { createSessionCloserRegistry } from "../plugin-session-close.js";
import { isEphemeral } from "../session-lifecycle-policy.js";

describe("lifecyclePolicy marker persistence", () => {
  let tmpDir: string;
  let mgr: SessionManager;
  let metaPersistence: MetaPersistence;
  let sessionFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lifecycle-persist-"));
    const dir = path.join(tmpDir, "--test-cwd--");
    fs.mkdirSync(dir, { recursive: true });
    sessionFile = path.join(dir, "2026-07-21T10-00-00-000Z_embed-id.jsonl");
    fs.writeFileSync(
      sessionFile,
      `${JSON.stringify({ type: "session", id: "embed-id", cwd: "/test/cwd", timestamp: "2026-07-21T10:00:00.000Z" })}\n`,
    );

    mgr = createMemorySessionManager();
    metaPersistence = createMetaPersistence();
    mgr.onChange = (id) => {
      const s = mgr.get(id);
      if (!s?.sessionFile) return;
      metaPersistence.save(s.sessionFile, sessionToMeta(s));
    };

    mgr.register({ id: "embed-id", cwd: "/test/cwd", source: "embed", startedAt: 1000 });
    mgr.update("embed-id", { sessionFile, status: "ended" });
  });

  afterEach(() => {
    metaPersistence.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // E4 — the full-overwrite save enumerates lifecyclePolicy (no wipe on a
  // subsequent unrelated save).
  it("does NOT wipe lifecyclePolicy on a later unrelated meta save", () => {
    mgr.update("embed-id", { lifecyclePolicy: "ephemeral" });
    mgr.update("embed-id", { processDrawerCollapsed: true });
    metaPersistence.flushAll();

    const onDisk = readSessionMeta(sessionFile);
    expect(onDisk?.lifecyclePolicy).toBe("ephemeral");
  });

  // E3 — ephemeral marker survives a restart: persisted to .meta.json and
  // restored (not reclassified to durable) by the cold-start scan.
  it("round-trips an ephemeral marker and restores it on cold-start scan", () => {
    mgr.update("embed-id", { lifecyclePolicy: "ephemeral" });
    metaPersistence.flushAll();

    expect(readSessionMeta(sessionFile)?.lifecyclePolicy).toBe("ephemeral");

    const result = scanAllSessions(tmpDir);
    const restored = result.sessions.find((s) => s.id === "embed-id");
    expect(restored?.lifecyclePolicy).toBe("ephemeral");
    // The restored session remains reap-eligible (ephemeral, not durable).
    expect(isEphemeral(restored ?? {})).toBe(true);
  });

  // E14 — cold-start settle seed: a rehydrated session with no captured
  // lastSettledAt is seeded from the session-file mtime so the quiescence gate
  // is immediately evaluable (not stalled waiting for a fresh run to settle).
  it("seeds lastSettledAt from the session-file mtime on cold-start scan", () => {
    mgr.update("embed-id", { lifecyclePolicy: "ephemeral" });
    metaPersistence.flushAll();

    const result = scanAllSessions(tmpDir);
    const restored = result.sessions.find((s) => s.id === "embed-id");
    expect(restored?.lastSettledAt).toBeTypeOf("number");
    // Seeded from the same mtime source as lastActivityAt.
    expect(restored?.lastSettledAt).toBe(restored?.lastActivityAt);
  });

  // E3 (negative) — a durable / unmarked session restores durable and is never
  // reap-eligible after restart.
  it("restores an unmarked session as durable after a cold-start scan", () => {
    mgr.update("embed-id", { lifecyclePolicy: undefined });
    metaPersistence.flushAll();

    const result = scanAllSessions(tmpDir);
    const restored = result.sessions.find((s) => s.id === "embed-id");
    expect(isEphemeral(restored ?? {})).toBe(false);
  });

  // add-session-close-plugin-hook E4 — closePolicy survives the full-overwrite
  // save and the cold-start scan (test-plan #E4).
  it("E4: round-trips a plugin closePolicy across save + cold-start scan (test-plan #E4)", () => {
    const policy = { owner: "team", idleAfterMs: 1_800_000, mode: "sleep" as const };
    mgr.update("embed-id", { closePolicy: policy });
    mgr.update("embed-id", { processDrawerCollapsed: true });
    metaPersistence.flushAll();
    expect(readSessionMeta(sessionFile)?.closePolicy).toEqual(policy);
    const restored = scanAllSessions(tmpDir).sessions.find((s) => s.id === "embed-id");
    expect(restored?.closePolicy).toEqual(policy);
  });

  // add-session-close-plugin-hook X5 — an idle close request is in-memory and
  // does not survive a restart (test-plan #X5).
  it("X5: an idle close request is gone after a restart (test-plan #X5)", async () => {
    const before = createSessionCloserRegistry();
    before.requestIdleClose("embed-id");
    expect(before.isCloseRequested("embed-id")).toBe(true);
    mgr.update("embed-id", { closePolicy: { owner: "team", idleAfterMs: 1_800_000, mode: "sleep" } });
    metaPersistence.flushAll();
    const restored = scanAllSessions(tmpDir).sessions.find((s) => s.id === "embed-id");
    const after = createSessionCloserRegistry(); // fresh process
    expect(after.isCloseRequested("embed-id")).toBe(false);
    // Restored, recently active, below the governed threshold ⇒ not reaped.
    const kills: string[] = [];
    const now = Date.now();
    const s = { ...restored, status: "idle", lastActivityAt: now - 60_000, startedAt: now - 3_600_000 } as DashboardSession;
    await createIdleReaper({
      config: () => ({ ...DEFAULT_EMBED_LIFECYCLE, enabled: false }),
      listSessions: () => [s],
      probe: async () => ({ ok: true, childCount: 0, cpuPercent: 0 }),
      hasSubscriber: () => false,
      hasTerminalInCwd: () => false,
      hasPendingAsk: () => false,
      queueCounts: () => ({ followUp: 0, steering: 0 }),
      terminate: async (id) => {
        kills.push(id);
        return { outcome: "confirmed-dead" as const, terminated: true };
      },
      sendStopAfterTurn: () => true,
      isCloseRequested: (id) => after.isCloseRequested(id),
    }).sweepOnce();
    expect(kills).toEqual([]);
  });
});
