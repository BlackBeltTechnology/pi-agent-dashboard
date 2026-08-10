/**
 * Parity + fallback + cancellation tests for the session-load worker.
 *
 * The worker offloads JSONL parse (`loadSessionEntries`) + replay
 * (`replayEntriesAsEvents`) off the main event loop. Output `events` MUST
 * equal the in-process projection for both tree-branch and linear-fallback
 * session files. The pool falls back in-process when the worker is
 * unavailable, and supports `cancel(jobId)` so the subscription handler can
 * drop wasted loads.
 *
 * See change: offload-session-events-load-to-worker.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadSessionEntries } from "../session/session-file-reader.js";
import { replayEntriesAsEvents } from "@blackbelt-technology/pi-dashboard-shared/state-replay.js";
import { loadAndReplay } from "../session/session-load-worker.js";
import { createSessionLoadWorkerPool } from "../session/session-load-worker-pool.js";

let tmpDir: string;

function writeSession(name: string, entries: any[]): string {
  const path = join(tmpDir, name);
  writeFileSync(path, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return path;
}

/** Tree-branch fixture: entries carry `id`/`parentId`, walked leaf→root. */
function treeFixture(): string {
  return writeSession("tree.jsonl", [
    { type: "session", id: "sess-tree", timestamp: "2025-01-01T00:00:00Z", cwd: "/tmp" },
    { type: "model_change", id: "m0", parentId: null, provider: "anthropic", modelId: "claude-3-5-sonnet", timestamp: "2025-01-01T00:00:01Z" },
    { type: "message", id: "e1", parentId: "m0", timestamp: "2025-01-01T00:00:02Z", message: { role: "user", content: "Hello" } },
    {
      type: "message", id: "e2", parentId: "e1", timestamp: "2025-01-01T00:00:03Z",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Calling a tool" },
          { type: "toolCall", id: "tc1", name: "read", arguments: { path: "/x" } },
        ],
        usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 1500, cost: { total: 0.01 } },
      },
    },
    {
      type: "message", id: "e3", parentId: "e2", timestamp: "2025-01-01T00:00:04Z",
      message: { role: "toolResult", toolCallId: "tc1", toolName: "read", content: [{ type: "text", text: "file body" }], isError: false },
    },
    {
      type: "message", id: "e4", parentId: "e3", timestamp: "2025-01-01T00:00:05Z",
      message: { role: "assistant", content: [{ type: "text", text: "Done" }] },
    },
  ]);
}

/** Linear-fallback fixture: entries have NO `id`, so the reader returns
 *  linear order (header excluded). */
function linearFixture(): string {
  return writeSession("linear.jsonl", [
    { type: "session", id: "sess-linear", timestamp: "2025-01-01T00:00:00Z", cwd: "/tmp" },
    { type: "message", timestamp: "2025-01-01T00:00:01Z", message: { role: "user", content: "Hi there" } },
    {
      type: "message", timestamp: "2025-01-01T00:00:02Z",
      message: { role: "assistant", content: [{ type: "text", text: "Reply" }] },
    },
  ]);
}

function inProcessEvents(sessionId: string, file: string, kcw?: number) {
  return replayEntriesAsEvents(sessionId, loadSessionEntries(file), kcw).map((m) => m.event);
}

describe("session-load-worker — parity with in-process replay", () => {
  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "session-load-worker-")); });
  afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("loadAndReplay matches in-process projection (tree branch)", () => {
    const file = treeFixture();
    const out = loadAndReplay({ jobId: 1, sessionId: "sess-tree", sessionFile: file, knownContextWindow: 200_000 });
    expect(out.success).toBe(true);
    expect(out.events).toEqual(inProcessEvents("sess-tree", file, 200_000));
  });

  it("loadAndReplay matches in-process projection (linear fallback)", () => {
    const file = linearFixture();
    const out = loadAndReplay({ jobId: 2, sessionId: "sess-linear", sessionFile: file });
    expect(out.success).toBe(true);
    expect(out.events).toEqual(inProcessEvents("sess-linear", file));
  });
});

describe("session-load-worker-pool — fallback + parity", () => {
  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "session-load-pool-")); });
  afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("useWorker=false runs in-process and matches parity", async () => {
    const pool = createSessionLoadWorkerPool({ useWorker: false });
    try {
      const file = treeFixture();
      const { result } = pool.load({ sessionId: "sess-tree", sessionFile: file, knownContextWindow: 200_000 });
      const out = await result;
      expect(out.success).toBe(true);
      expect(out.events).toEqual(inProcessEvents("sess-tree", file, 200_000));
    } finally {
      await pool.dispose();
    }
  });

  it("useWorker=true yields parity output (worker path or in-process fallback)", async () => {
    // Under vitest `process.execArgv` may not carry the jiti `--import` hook,
    // so a real Worker pointed at a .ts entry may fail and fall back. The
    // pool's contract is correctness regardless of path.
    const pool = createSessionLoadWorkerPool({ useWorker: true, size: 1, timeoutMs: 15_000 });
    try {
      const file = linearFixture();
      const { result } = pool.load({ sessionId: "sess-linear", sessionFile: file });
      const out = await result;
      expect(out.success).toBe(true);
      expect(out.events).toEqual(inProcessEvents("sess-linear", file));
    } finally {
      await pool.dispose();
    }
  });

  it("falls back in-process when the worker spawn URL is unresolvable", async () => {
    const pool = createSessionLoadWorkerPool({
      useWorker: true,
      workerUrlOverride: "file:///definitely/does/not/exist/session-load-worker.mjs",
      timeoutMs: 250,
    });
    try {
      const file = treeFixture();
      const { result } = pool.load({ sessionId: "sess-tree", sessionFile: file, knownContextWindow: 200_000 });
      const out = await result;
      expect(out.success).toBe(true);
      expect(out.events).toEqual(inProcessEvents("sess-tree", file, 200_000));
    } finally {
      await pool.dispose();
    }
  });
});

describe("session-load-worker-pool — cancellation", () => {
  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "session-load-cancel-")); });
  afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("cancelled job resolves 'cancelled' and never delivers real events", async () => {
    // useWorker=false defers the in-process settle to a microtask, so a
    // synchronous cancel() right after load() drops the job before the
    // events are ever computed.
    const pool = createSessionLoadWorkerPool({ useWorker: false });
    try {
      const file = treeFixture();
      const { jobId, result } = pool.load({ sessionId: "sess-tree", sessionFile: file, knownContextWindow: 200_000 });
      pool.cancel(jobId);
      const out = await result;
      expect(out.success).toBe(false);
      expect(out.error).toBe("cancelled");
      expect(out.events).toEqual([]);
    } finally {
      await pool.dispose();
    }
  });

  it("cancelling an unknown jobId is a no-op", async () => {
    const pool = createSessionLoadWorkerPool({ useWorker: false });
    try {
      expect(() => pool.cancel(99_999)).not.toThrow();
    } finally {
      await pool.dispose();
    }
  });
});
