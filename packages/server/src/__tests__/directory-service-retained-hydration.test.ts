/**
 * `DirectoryService.loadRetainedEvents` — the retained path's share of the
 * governance the local path already had: the shared worker pool, the
 * `inFlightLoadJobs` registration, the pool-lifecycle null-guard, and the
 * `hydrationMetrics` sample + slow-load warning.
 *
 * A retained hydration that reaches the parse-and-replay stage must be visible
 * in `/api/health`'s ring exactly like a local one, or "is hydration slow for
 * remote sessions?" has no runtime answer. And the SHORT-CIRCUITED `absent`
 * read must record nothing — the ring holds 20 samples, so a no-op read
 * evicting a real slow hydration would defeat the question the requirement
 * exists to answer.
 *
 * See change: offload-retained-transcript-replay (D2, D6, tasks 6.14, 6.25,
 * 6.31, 6.32 / test-plan #P3, #X6, #X12, #X13).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDirectoryService, type DirectoryService } from "../directory-service.js";
import { createHydrationMetrics } from "../metrics/hydration-metrics.js";
import type { PreferencesStore } from "../persistence/preferences-store.js";
import { createRemoteTranscriptStore } from "../session/remote-transcript-store.js";
import { readRetainedTranscript } from "../session/retained-transcript.js";
import type { SessionManager } from "../session/memory-session-manager.js";

const RAW =
  [
    JSON.stringify({ type: "session", id: "sess-retained", timestamp: "2025-01-01T00:00:00Z" }),
    JSON.stringify({
      type: "message",
      id: "m1",
      parentId: null,
      timestamp: "2025-01-01T00:00:01Z",
      message: { role: "user", content: "from the other machine" },
    }),
  ].join("\n") + "\n";

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ds-retained-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
});

const store = () => createRemoteTranscriptStore({ homedir: home });

/** A `DirectoryService` with only what these paths touch. Checked out of the
 *  `directory-service-*.test.ts` harness. */
function makeService(hydrationMetrics?: ReturnType<typeof createHydrationMetrics>): DirectoryService {
  return createDirectoryService(
    { getPinnedDirectories: () => [] } as unknown as PreferencesStore,
    { listAll: () => [] } as unknown as SessionManager,
    undefined,
    // `useLoadWorker:false` keeps the assertions about the RESULT, not about
    // whether this host can spawn a thread; the worker-vs-in-process parity is
    // covered in `session-load-worker.test.ts`.
    { useLoadWorker: false, hydrationMetrics },
  );
}

/** Put a real retained transcript on disk for `id`. */
function retain(id: string): void {
  store().append(id, RAW.split("\n").filter((l) => l.length > 0), {
    restarted: true,
    complete: true,
  });
}

describe("retained hydration is measurable (D6)", () => {
  it("P3 a real hydration survives a ring's worth of no-op absent reads", async () => {
    const metrics = createHydrationMetrics(20);
    const svc = makeService(metrics);
    const s = store();

    // The discriminating order: the REAL sample is in the ring BEFORE the
    // no-op reads arrive, so 25 recorded no-ops would rotate it out. (The
    // reverse order passes either way — newest-first snapshotting makes the
    // last-recorded sample unconditionally present.)
    retain("sess-retained");
    const real = await readRetainedTranscript(s, svc, "sess-retained");
    expect(real.cancelled).toBe(false);
    expect(metrics.snapshot().some((x) => x.sessionId === "sess-retained")).toBe(true);

    for (let i = 0; i < 25; i++) {
      const absent = await readRetainedTranscript(s, svc, `never-transferred-${i}`);
      expect(absent).toEqual({ cancelled: false, events: [], state: "absent" });
    }

    // A no-op read that recorded a sample would have evicted the real one.
    expect(metrics.snapshot().some((x) => x.sessionId === "sess-retained")).toBe(true);
  });

  it("records the transcript's true byte size and the real entry/event counts", async () => {
    const metrics = createHydrationMetrics(20);
    const svc = makeService(metrics);
    retain("sess-retained");

    await readRetainedTranscript(store(), svc, "sess-retained");

    const sample = metrics.snapshot().find((x) => x.sessionId === "sess-retained");
    expect(sample).toBeDefined();
    // `Buffer.byteLength(raw)` — comparable with the local path's
    // `statSync().size`, where summing the split entries would undercount by
    // every newline.
    expect(sample?.fileBytes).toBe(Buffer.byteLength(RAW));
    // One branch entry: the session header is excluded by `parseSessionEntries`.
    expect(sample?.entryCount).toBe(1);
    expect(sample?.eventCount).toBeGreaterThan(0);
  });

  it("X12 a hydration past the slow-load threshold warns with the session id and byte size", async () => {
    const metrics = createHydrationMetrics(20);
    const svc = makeService(metrics);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    retain("sess-retained");

    // Faked clock: `loadRetainedEvents` samples `performance.now()` once at the
    // start and once in its `finally`.
    let tick = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (tick++ === 0 ? 0 : 6_000));

    await readRetainedTranscript(store(), svc, "sess-retained");

    const line = warn.mock.calls.map((c) => String(c[0])).find((l) => l.includes("slow load"));
    expect(line).toBeDefined();
    expect(line).toContain("sess-retained");
    expect(line).toContain(`bytes=${Buffer.byteLength(RAW)}`);
  });

  it("X13 a throwing recorder changes nothing and does not propagate", async () => {
    const svc = makeService({
      record: () => {
        throw new Error("recorder boom");
      },
      snapshot: () => [],
    });
    retain("sess-retained");

    const out = await readRetainedTranscript(store(), svc, "sess-retained");
    expect(out.cancelled).toBe(false);
    if (out.cancelled) return;
    expect(out.state).toBe("complete");
    expect(out.events.length).toBeGreaterThan(0);
  });
});

describe("pool lifecycle (D2)", () => {
  it("X6 a disposed pool resolves the state intact rather than throwing on null", async () => {
    const svc = makeService();
    retain("sess-retained");
    // Materialise the pool so `stopPolling` has something to dispose.
    expect(svc.ensureLoadWorkerPool()).not.toBeNull();
    svc.stopPolling();
    expect(svc.ensureLoadWorkerPool()).toBeNull();

    const out = await readRetainedTranscript(store(), svc, "sess-retained");
    // The bytes are real, so the STATE stands; only the render could not run.
    expect(out).toEqual({ cancelled: false, events: [], state: "complete" });
  });
});
