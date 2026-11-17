/**
 * Pin-folder discovery (`pinDirectorySideEffects`) must never resurrect an
 * archived session nor overwrite a discovered session's sidecar; without an
 * archive index it seeds nothing.
 *
 * test-plan #E2, #E6, #X3.
 * Harness: `move-folder-handler.test.ts` (handler ctx stub).
 * See change: fix-discovery-resurrects-archived.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { metaPath, writeSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pinDirectorySideEffects } from "../browser-handlers/directory-handler.js";
import { createMetaPersistence } from "../persistence/meta-persistence.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { createSessionArchive } from "../session/session-archive.js";
import type { DiscoveredSession } from "../session/session-discovery.js";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("pinDirectorySideEffects discovery does not resurrect archived sessions", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pin-no-resurrect-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function transcript(id: string, cwd: string, sidecar?: string): DiscoveredSession {
    const sessionFile = path.join(tmpDir, `2026-01-01T00-00-00-000Z_${id}.jsonl`);
    fs.writeFileSync(sessionFile, `${JSON.stringify({ type: "session", id, cwd })}\n`);
    if (sidecar !== undefined) fs.writeFileSync(metaPath(sessionFile), sidecar);
    return { id, cwd, startedAt: 1000, modifiedAt: 1000, sessionFile, sessionDir: tmpDir };
  }

  function rig(discovered: DiscoveredSession[], withArchive = true) {
    const sessionManager = createMemorySessionManager();
    const sessionArchive = createSessionArchive({
      sessionManager, metaPersistence: createMetaPersistence(), getPinnedDirs: () => [],
    });
    const broadcasts: any[] = [];
    const ctx = {
      locallyTrusted: true,
      preferencesStore: { getPinnedDirectories: vi.fn(() => []) },
      directoryService: { onDirectoryAdded: vi.fn(async () => ({ sessions: discovered, openspecData: {} })) },
      sessionManager,
      sessionArchive: withArchive ? sessionArchive : undefined,
      broadcast: vi.fn((m: any) => broadcasts.push(m)),
    } as any;
    return { ctx, sessionManager, sessionArchive, broadcasts };
  }

  const added = (broadcasts: any[]) => broadcasts.filter((m) => m.type === "session_added").map((m) => m.session.id);
  const openspec = (broadcasts: any[], cwd: string) =>
    broadcasts.filter((m) => m.type === "openspec_update" && m.cwd === cwd);

  it("#E2 pinning a folder leaves its archived sessions archived", async () => {
    const list = ["a1", "a2", "a3"].map((id) => transcript(id, "/w/a"));
    for (const d of list) {
      writeSessionMeta(d.sessionFile, { cwd: "/w/a", status: "ended", startedAt: 1000, archived: true, archivedAt: 3 } as any);
    }
    const before = list.map((d) => fs.readFileSync(metaPath(d.sessionFile), "utf-8"));
    const { ctx, sessionManager, sessionArchive, broadcasts } = rig(list);
    sessionArchive.seed(list.map((d) => ({
      id: d.id, cwd: "/w/a", groupPath: "/w/a", endedAt: 2, archivedAt: 3, sessionFile: d.sessionFile,
    })));

    pinDirectorySideEffects("/w/a", ctx);
    await flush();

    for (const d of list) expect(sessionManager.get(d.id)).toBeUndefined();
    expect(added(broadcasts)).toEqual([]);
    expect(list.map((d) => fs.readFileSync(metaPath(d.sessionFile), "utf-8"))).toEqual(before);
    expect(openspec(broadcasts, "/w/a")).toHaveLength(1);
  });

  it("#E6 without an archive index nothing is seeded, openspec still broadcast", async () => {
    const archived = transcript("d1", "/w/d", JSON.stringify({ cwd: "/w/d", archived: true }));
    const plain = transcript("d2", "/w/d");
    const { ctx, sessionManager, broadcasts } = rig([archived, plain], false);

    pinDirectorySideEffects("/w/d", ctx);
    await flush();

    expect(sessionManager.get("d1")).toBeUndefined();
    expect(sessionManager.get("d2")).toBeUndefined();
    expect(added(broadcasts)).toEqual([]);
    expect(openspec(broadcasts, "/w/d")).toHaveLength(1);
  });

  it("#X3 a corrupt sidecar is neither seeded over nor rewritten", async () => {
    const k1 = transcript("k1", "/w/k", "{not json");
    const { ctx, sessionManager, broadcasts } = rig([k1]);

    pinDirectorySideEffects("/w/k", ctx);
    await flush();

    expect(sessionManager.get("k1")).toBeUndefined();
    expect(added(broadcasts)).toEqual([]);
    expect(fs.readFileSync(metaPath(k1.sessionFile), "utf-8")).toBe("{not json");
  });
});
