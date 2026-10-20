/**
 * Skip-wipe fingerprint source: `LoadResult.entryCount` / `leafEntryId` from a
 * cold hydration, checked against what pi-core and the bridge actually see.
 *
 * Lives beside `directory-service.test.ts` (rather than inside it) because that
 * suite mocks the session-file reader and the replay module; these tests need the
 * real ones.
 *
 * See change: fix-large-session-resume-replay (D5), test-plan #E13, #E24.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { replayEntriesAsEvents } from "@blackbelt-technology/pi-dashboard-shared/state-replay.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDirectoryService, type DirectoryService } from "../directory-service.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";

type Line = Record<string, unknown>;

const header = (sid: string, dir: string): Line => ({ type: "session", id: sid, cwd: dir, version: 3, timestamp: "2026-10-13T10:00:00.000Z" });
const user = (id: string, parentId: string | null, text: string): Line => ({
  type: "message", id, parentId, timestamp: "2026-10-13T10:00:01.000Z",
  message: { role: "user", content: [{ type: "text", text }] },
});
const assistant = (id: string, parentId: string | null, text: string): Line => ({
  type: "message", id, parentId, timestamp: "2026-10-13T10:00:02.000Z",
  message: { role: "assistant", content: [{ type: "text", text }], usage: {}, model: "m", provider: "p", stopReason: "stop" },
});

describe("cold-hydration fingerprint (entryCount + leafEntryId)", () => {
  let dir: string;
  let service: DirectoryService;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "fp-"));
    const stateStore = { getPinnedDirectories: () => [], getRecentCwds: () => [] } as any;
    service = createDirectoryService(stateStore, createMemorySessionManager());
  });
  afterEach(() => {
    service.stopPolling();
  });

  function write(sid: string, lines: Line[]): string {
    const file = path.join(dir, `${sid}.jsonl`);
    writeFileSync(file, `${[header(sid, dir), ...lines].map((l) => JSON.stringify(l)).join("\n")}\n`);
    return file;
  }
  /** pi-core's own branch for a transcript (the bridge's `getBranch()`). */
  const piBranch = async (file: string): Promise<Array<{ id?: string }>> => {
    const { SessionManager } = (await import("@earendil-works/pi-coding-agent")) as unknown as {
      SessionManager: { open(file: string): { getBranch(): Array<{ id?: string }> } };
    };
    return SessionManager.open(file).getBranch();
  };
  const lastId = (b: Array<{ id?: string }>) => b[b.length - 1]?.id;

  // test-plan #E13
  it("E13: a linear transcript matches pi-core's branch length and leaf", async () => {
    const file = write("lin", [user("a", null, "q1"), assistant("b", "a", "r1"), user("c", "b", "q2"), assistant("d", "c", "r2")]);
    const out = await service.loadSessionEvents("lin", file);
    const pi = await piBranch(file);
    expect(out.success).toBe(true);
    expect(out.entryCount).toBe(pi.length);
    expect(out.leafEntryId).toBe(lastId(pi));
  });

  it("E13: a branched transcript (branch_summary, a second child of an earlier entry) matches pi-core", async () => {
    const file = write("br", [
      user("a", null, "q1"),
      assistant("b", "a", "r1"),
      user("c", "b", "q2"),
      assistant("d", "c", "r2"),
      // the user navigated back to `b` and continued on another branch
      { type: "branch_summary", id: "s", parentId: "b", timestamp: "2026-10-13T10:00:03.000Z", fromId: "d", summary: "abandoned branch" },
      user("e", "s", "q3"),
    ]);
    const out = await service.loadSessionEvents("br", file);
    const pi = await piBranch(file);
    expect(pi.map((e) => e.id)).toEqual(["a", "b", "s", "e"]);
    expect(out.entryCount).toBe(pi.length);
    expect(out.leafEntryId).toBe(lastId(pi));
  });

  it("E13: a `leaf` pointer entry makes the server reader's leaf differ from pi-core's (the register then wipes)", async () => {
    const file = write("ptr", [
      user("a", null, "q1"),
      assistant("b", "a", "r1"),
      user("c", "b", "q2"),
      { type: "leaf", entryId: "b" },
    ]);
    const out = await service.loadSessionEvents("ptr", file);
    const pi = await piBranch(file);
    expect(out.leafEntryId).toBe("b");
    // pi-core ignores the pointer, so the leaf the bridge would report differs.
    expect(out.leafEntryId).not.toBe(lastId(pi));
  });

  it("E13: cyclic parentage falls back to the linear order (pi-core would not terminate on it, so it is not consulted)", async () => {
    const file = write("cyc", [user("a", "b", "q1"), assistant("b", "a", "r1")]);
    const out = await service.loadSessionEvents("cyc", file);
    expect(out.success).toBe(true);
    expect(out.entryCount).toBe(2);
    expect(out.leafEntryId).toBe("b");
  });

  it("E13: no resolvable leaf ⇒ leafEntryId undefined (no fingerprint is recorded)", async () => {
    const noId = { type: "message", timestamp: "2026-10-13T10:00:01.000Z", message: { role: "user", content: [{ type: "text", text: "q" }] } };
    const file = write("noid", [noId, { ...noId }]);
    const out = await service.loadSessionEvents("noid", file);
    expect(out.success).toBe(true);
    expect(out.leafEntryId).toBeUndefined();
  });

  // test-plan #E24 — the kept store equals what the bridge replay would store,
  // apart from timestamps and context-window metadata.
  it("E24: hydration equals the bridge replay of the same branch after normalising timestamps and context-window fields", async () => {
    const lines: Line[] = [];
    let parent: string | null = null;
    for (let i = 0; i < 6; i++) {
      const id = `m${i}`;
      lines.push(i % 2 === 0 ? user(id, parent, `question ${i}`) : assistant(id, parent, `answer ${i}`));
      parent = id;
    }
    // a tool round-trip with a CLOSED tail
    lines.push({
      type: "message", id: "t1", parentId: parent, timestamp: "2026-10-13T10:00:04.000Z",
      message: { role: "assistant", content: [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "/tmp/x" } }], usage: {}, model: "m", provider: "p", stopReason: "toolUse" },
    });
    lines.push({
      type: "message", id: "t2", parentId: "t1", timestamp: "2026-10-13T10:00:05.000Z",
      message: { role: "toolResult", toolCallId: "call-1", toolName: "read", content: [{ type: "text", text: "file body" }], isError: false },
    });
    lines.push(assistant("t3", "t2", "done"));
    const file = write("par", lines);

    const hydrated = (await service.loadSessionEvents("par", file)).events;
    const bridge = replayEntriesAsEvents("par", (await piBranch(file)) as never, undefined, { liveTailOpen: false }).map((m) => m.event);
    expect(hydrated.length).toBeGreaterThan(0);

    const CONTEXT_KEYS = new Set(["timestamp", "contextWindow", "contextTokens", "contextUsage", "contextPercent"]);
    const normalise = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(normalise)
        : v && typeof v === "object"
          ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !CONTEXT_KEYS.has(k)).map(([k, x]) => [k, normalise(x)]))
          : v;
    expect(normalise(hydrated)).toEqual(normalise(bridge));
  });
});
