/**
 * `seedDiscoveredHistory` guard decision table (test-plan #E3): an id is
 * seeded only when it is not resident, not in the archive index, and has no
 * `.meta.json` sidecar. Seeding never writes a sidecar.
 *
 * See change: fix-discovery-resurrects-archived.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { metaPath } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { seedDiscoveredHistory } from "../session/seed-discovered-history.js";
import type { DiscoveredSession } from "../session/session-discovery.js";

describe("seedDiscoveredHistory — guard decision table (E3)", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "seed-history-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function transcript(id: string, sidecar?: object): DiscoveredSession {
    const sessionFile = path.join(dir, `2026-01-01T00-00-00-000Z_${id}.jsonl`);
    fs.writeFileSync(sessionFile, `${JSON.stringify({ type: "session", id, cwd: "/w/b" })}\n`);
    if (sidecar) fs.writeFileSync(metaPath(sessionFile), JSON.stringify(sidecar));
    return { id, cwd: "/w/b", startedAt: 1000, modifiedAt: 2000, sessionFile, sessionDir: dir };
  }

  it("seeds only the sidecar-less, non-resident, non-archived transcript", () => {
    const a = transcript("a");
    const b = transcript("b", { id: "b", archived: true, archivedAt: 5 });
    const c = transcript("c", { id: "c", archived: true, archivedAt: 6 });
    const d = transcript("d");
    const sidecarBytes = {
      b: fs.readFileSync(metaPath(b.sessionFile)),
      c: fs.readFileSync(metaPath(c.sessionFile)),
    };

    const sessionManager = createMemorySessionManager();
    const residentA = sessionManager.register({ id: "a", cwd: "/w/b", source: "tui" });

    const seeded = seedDiscoveredHistory([a, b, c, d], {
      sessionManager,
      sessionArchive: { has: (id: string) => id === "b" },
    });

    expect(seeded.map((s) => s.id)).toEqual(["d"]);
    expect(sessionManager.get("a")).toBe(residentA);
    expect(sessionManager.get("b")).toBeUndefined();
    expect(sessionManager.get("c")).toBeUndefined();
    expect(fs.readFileSync(metaPath(b.sessionFile))).toEqual(sidecarBytes.b);
    expect(fs.readFileSync(metaPath(c.sessionFile))).toEqual(sidecarBytes.c);
    expect(fs.existsSync(metaPath(d.sessionFile))).toBe(false);
  });

  it("seeds the boot shape: ended, visible, dataUnavailable, evidence endedAt", () => {
    const d = transcript("d");
    const mtime = new Date("2026-01-02T00:00:00Z");
    fs.utimesSync(d.sessionFile, mtime, mtime);
    const sessionManager = createMemorySessionManager();

    const [s] = seedDiscoveredHistory([d], { sessionManager, sessionArchive: { has: () => false } });

    expect(s).toBe(sessionManager.get("d"));
    expect(s).toMatchObject({ status: "ended", hidden: false, dataUnavailable: true, source: "tui" });
    expect(s.endedAt).toBe(mtime.getTime());
  });

  it("fails closed without an archive index", () => {
    const d = transcript("d");
    const sessionManager = createMemorySessionManager();

    expect(seedDiscoveredHistory([d], { sessionManager, sessionArchive: undefined })).toEqual([]);
    expect(sessionManager.get("d")).toBeUndefined();
  });
});
