/**
 * Server-side retention — the half of D12 the spec actually requires.
 *
 * A remote session's transcript lives on another machine, and that machine
 * leaves. Retention is what makes the transcript outlive the session (11.10),
 * and what lets a read escape `memory-event-store`'s deliberate lossiness —
 * the 4 KB `DEFAULT_MAX_STRING_SIZE` cap, eviction, per-session trimming (11.9).
 * Locally that escape hatch is `findSessionToolCallPayload` reading the
 * `.jsonl`; for a remote session this store IS the `.jsonl`.
 *
 * Two properties carry the weight:
 *
 *   - **`sessionId` arrives over the wire** from a possibly-remote bridge, so
 *     it is untrusted input being used to build a filename. A store that
 *     interpolates it into a path is a write-anywhere primitive.
 *   - **A restart must not append.** The backfill cursor restarts when the
 *     origin's prefix was rewritten or truncated; appending that second read
 *     would duplicate every entry and silently corrupt the retained copy.
 *
 * Tasks 11.6, 11.9, 11.10; test-plan #X18.
 * See change: add-pi-gateway-transport-identity.
 *
 * `read` is ASYNC and `readRaw`/`completenessOf` exist since the retained
 * offload; the concurrency tests at the bottom cover the interleavings a
 * synchronous read could not produce. See change:
 * offload-retained-transcript-replay (D1, D5).
 */
import fs, { readFileSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRemoteTranscriptStore } from "../remote-transcript-store.js";

let home: string;
const store = () => createRemoteTranscriptStore({ homedir: home });

const line = (i: number) => JSON.stringify({ i });

/** The store's on-disk path for a session id's content. */
const contentPath = (id: string) =>
  path.join(home, ".pi", "dashboard", "remote-transcripts", `${id}.jsonl`);

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-rts-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
});

describe("createRemoteTranscriptStore", () => {
  it("retains appended chunks and reads them back in order", async () => {
    const s = store();
    s.append("sess-1", [line(0), line(1)], { restarted: false, complete: false });
    s.append("sess-1", [line(2)], { restarted: false, complete: true });
    const got = await s.read("sess-1");
    expect(got.entries.map((e: string) => JSON.parse(e).i)).toEqual([0, 1, 2]);
  });

  it("serves the transcript after the session has ended (task 11.10)", async () => {
    const s = store();
    s.append("sess-1", [line(0)], { restarted: false, complete: true });
    // A fresh store instance — no in-memory state, exactly like a server that
    // restarted after the remote host went away.
    expect((await store().read("sess-1")).entries).toHaveLength(1);
  });

  it("replaces rather than appends when the reader restarted", async () => {
    const s = store();
    s.append("sess-1", [line(0), line(1)], { restarted: false, complete: false });
    // The origin's prefix changed under the cursor; the bridge re-read from 0.
    s.append("sess-1", [line(9), line(8)], { restarted: true, complete: true });
    const got = await s.read("sess-1");
    expect(got.entries.map((e: string) => JSON.parse(e).i)).toEqual([9, 8]);
  });

  it("reports a transcript as incomplete until a chunk says complete (#X18)", async () => {
    const s = store();
    s.append("sess-1", [line(0)], { restarted: false, complete: false });
    expect((await s.read("sess-1")).complete).toBe(false);
    s.append("sess-1", [line(1)], { restarted: false, complete: true });
    expect((await s.read("sess-1")).complete).toBe(true);
  });

  it("keeps a bridge that died mid-transfer detectable, not silently partial", async () => {
    const s = store();
    s.append("sess-1", [line(0), line(1)], { restarted: false, complete: false });
    const got = await store().read("sess-1");
    expect(got.entries).toHaveLength(2);
    // Present, readable, and explicitly NOT the whole record.
    expect(got.complete).toBe(false);
  });

  it("returns an empty, incomplete, UNRETAINED result for a session it has never seen", async () => {
    expect(await store().read("never-heard-of-it")).toEqual({
      entries: [],
      complete: false,
      retained: false,
    });
  });

  /**
   * `complete:false` alone cannot answer "is this everything?" — it is also
   * what a session with NO retained transcript reads back as. Presenting those
   * two as one state tells a user "history may be missing" for a session that
   * never had any, and hides a truncated transfer behind the same words. The
   * distinguishing fact is whether a transcript FILE exists at all.
   * See change: serve-retained-remote-transcripts (task 1.2).
   */
  it("separates a partially-retained transcript from one that was never captured", async () => {
    const s = store();
    s.append("partial", [line(0)], { restarted: false, complete: false });
    const partial = await s.read("partial");
    expect(partial.retained).toBe(true);
    expect(partial.complete).toBe(false);

    expect((await s.read("never-captured")).retained).toBe(false);
  });

  it("reports a retained-but-EMPTY transcript as retained, not as never-captured", async () => {
    // An origin whose transcript file was genuinely empty still produced a
    // transfer. Reading that back as "never captured" would blame the wrong
    // half of the system for the empty screen.
    const s = store();
    s.append("empty-origin", [], { restarted: true, complete: true });
    expect(await s.read("empty-origin")).toEqual({ entries: [], complete: true, retained: true });
  });

  it.each([
    "../../../../etc/passwd",
    "..\\..\\windows\\system32",
    "a/b",
    "with space",
    "sess;rm -rf /",
    "",
  ])("refuses %j as a session id rather than building a path from it", (bad) => {
    const s = store();
    expect(() => s.append(bad, [line(0)], { restarted: false, complete: true })).toThrow();
    // And nothing escaped the store directory.
    const stray = fs.existsSync(path.join(home, ".pi")) ? fs.readdirSync(path.join(home, ".pi")) : [];
    expect(stray).not.toContain("passwd");
  });

  it("accepts the uuid shape real session ids actually have", async () => {
    const s = store();
    const id = "01a021b6-f7bf-71ab-ae67-f4e88b0c00fd";
    expect(() => s.append(id, [line(0)], { restarted: false, complete: true })).not.toThrow();
    expect((await s.read(id)).entries).toHaveLength(1);
  });

  it("stores full-fidelity entries, past the in-memory 4 KB cap (task 11.9)", async () => {
    const s = store();
    const big = JSON.stringify({ i: 0, blob: "z".repeat(50_000) });
    s.append("sess-1", [big], { restarted: false, complete: true });
    const back = (await s.read("sess-1")).entries[0];
    // Byte-identical: the whole point is that nothing here truncates.
    expect(back).toBe(big);
    expect(JSON.parse(back).blob).toHaveLength(50_000);
  });

  it("writes under 0700/0600 like every other credential-adjacent path", async () => {
    if (process.platform === "win32") return; // chmod is a documented no-op
    const s = store();
    s.append("sess-1", [line(0)], { restarted: false, complete: true });
    const dir = path.join(home, ".pi", "dashboard", "remote-transcripts");
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(dir, "sess-1.jsonl")).mode & 0o777).toBe(0o600);
  });

  it("drops a retained transcript on request", async () => {
    const s = store();
    s.append("sess-1", [line(0)], { restarted: false, complete: true });
    s.forget("sess-1");
    expect((await s.read("sess-1")).entries).toEqual([]);
    // Idempotent: forgetting twice is not an error.
    expect(() => s.forget("sess-1")).not.toThrow();
  });
});

/**
 * The `entries` projection is the HTTP surface, and the offload must not move
 * it. The tempting simplification — share the worker's `splitTranscriptLines`
 * (`raw.trim().split("\n")`) — would silently change three reachable cases.
 * See change: offload-retained-transcript-replay (D1, tasks 6.5–6.7).
 */
describe("the HTTP entries projection is unchanged by the offload", () => {
  it("E5 keeps a retained-but-empty transcript at [] rather than [\"\"]", async () => {
    const s = store();
    s.append("empty-origin", [], { restarted: true, complete: true });
    expect((await s.read("empty-origin")).entries).toEqual([]);
  });

  it("E6 drops an interior blank line, as today", async () => {
    const s = store();
    s.append("blanks", ["a", "", "b"], { restarted: true, complete: true });
    expect((await s.read("blanks")).entries).toEqual(["a", "b"]);
  });

  it("E7 keeps a leading BOM on entry 0 byte-for-byte", async () => {
    // `"".trim()` strips U+FEFF. Sharing the worker's splitter would therefore
    // change this surface, so the store keeps its own split.
    const s = store();
    s.append("bom", ["\uFEFFfirst", "second"], { restarted: true, complete: true });
    const entries = (await s.read("bom")).entries;
    expect(entries[0].charCodeAt(0)).toBe(0xfeff);
    expect(entries[1]).toBe("second");
  });
});

/**
 * The read is async now, so it can land inside a write. Both hazards resolve to
 * `complete: false` — a whole transcript may read `incomplete` for one read,
 * the only direction the three-state contract tolerates — and the ENOENT
 * window must NOT read as `absent`.
 * See change: offload-retained-transcript-replay (D5, tasks 6.26–6.28).
 */
describe("readRaw — read/write interleavings", () => {
  /** Route the store's `fs.promises.access` through a wrapper that can act on
   *  the Nth marker sample. `append` is synchronous, so this is exact. */
  function onMarkerSample(n: number, action: () => void): void {
    const realAccess = fs.promises.access.bind(fs.promises);
    let seen = 0;
    vi.spyOn(fs.promises, "access").mockImplementation(async (p: any, mode?: any) => {
      const isMarker = String(p).endsWith(".complete");
      if (isMarker && ++seen === n) await action();
      return realAccess(p, mode);
    });
  }

  it("X7 a concurrent completing append never reports complete over pre-completion content", async () => {
    const s = store();
    s.append("race", [line(0)], { restarted: false, complete: false });
    // The writer finishes between the read's two marker samples.
    onMarkerSample(2, () => s.append("race", [line(1)], { restarted: false, complete: true }));

    const got = await s.read("race");
    // `markerBefore` was sampled before the write, so the conjunction rejects
    // it. Reporting `complete` here would pair a completion flag with content
    // that predates it.
    expect(got.complete).toBe(false);
    expect(got.entries).toEqual([line(0)]);
  });

  it("X8 a restart's stale marker is rejected by the conjunction", async () => {
    const s = store();
    s.append("restart", [line(0), line(1)], { restarted: true, complete: true });
    // `markerBefore` sees the stale marker; the content read returns the
    // pre-restart body; the restart then clears the marker before the second
    // sample. Marker-LAST alone would have paired the fresh `true` with the
    // old body; the conjunction rejects it.
    onMarkerSample(2, () =>
      s.append("restart", [line(9)], { restarted: true, complete: false }),
    );

    const got = await s.read("restart");
    expect(got.complete).toBe(false);
    expect(got.retained).toBe(true);
    expect(got.entries).toEqual([line(0), line(1)]);
  });

  /**
   * X14 — a read that observes a PARTIALLY written body.
   *
   * `append` rewrites the body with a synchronous `writeFileSync`, but the read
   * runs on the threadpool, so `readFile` CAN open the file mid-write and
   * return a truncated prefix. A restart that also sets `complete:true` never
   * removes the pre-existing marker, so the marker conjunction alone samples
   * `true → true` and would stamp that truncated prefix `complete` — the exact
   * “truncated reported as whole” the three-state contract exists to prevent.
   *
   * The byte count is what catches it: `readFile` runs off-thread, so by the
   * time the read's continuation runs on the MAIN thread the write has
   * completed (main-thread JS cannot be interleaved), and the file is provably
   * longer than what was read.
   *
   * See change: offload-retained-transcript-replay (D5).
   */
  it("X14 a read that sees a partially written body is not complete", async () => {
    const s = store();
    s.append("midwrite", [line(0), line(1), line(2), line(3)], { restarted: true, complete: true });

    // The file on disk AND its marker stay the full, complete transcript; only
    // the read returns a strict prefix, exactly as a mid-write read does.
    const realReadFile = fs.promises.readFile.bind(fs.promises);
    let calls = 0;
    vi.spyOn(fs.promises, "readFile").mockImplementation((async (p: any, enc?: any) => {
      const full = (await realReadFile(p, enc)) as Buffer | string;
      if (++calls > 1) return full;
      const half = Math.floor(full.length / 2);
      return typeof full === "string" ? full.slice(0, half) : full.subarray(0, half);
    }) as any);

    const got = await s.read("midwrite");
    expect(got.complete).toBe(false);
    // The bytes are real, so the transcript is retained — only its completeness
    // is unprovable.
    expect(got.retained).toBe(true);
  });

  it("X9 a read landing in the restart's rm/write window is not absent", async () => {
    const s = store();
    s.append("window", [line(0)], { restarted: true, complete: true });

    // First content read fails ENOENT (the restart already `rm`'d); the single
    // retry after a macrotask yield sees the rewritten file.
    const realReadFile = fs.promises.readFile.bind(fs.promises);
    let reads = 0;
    vi.spyOn(fs.promises, "readFile").mockImplementation((async (p: any, enc: any) => {
      if (++reads === 1) {
        const err = new Error(`ENOENT: no such file or directory, open '${String(p)}'`) as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      return realReadFile(p, enc);
    }) as any);

    const got = await s.read("window");
    // Without the retry this is `absent` — "no transfer ever happened" for a
    // session that is merely mid-restart.
    expect(got.retained).toBe(true);
    expect(got.entries).toEqual([line(0)]);
  });
});

/**
 * Retention is driven by a bridge that may be REMOTE, so both of these are
 * reachable by a paired device rather than only by a local process.
 */
describe("retention is bounded and does not follow a planted symlink", () => {
  it("refuses to extend a transcript past the retention cap", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "retention-cap-"));
    // Injected ceiling: the real one is 256 MB, and a test that allocated that
    // much would be measuring the allocator.
    const store = createRemoteTranscriptStore({ homedir: home, maxRetainedBytes: 1024 });

    // One oversized chunk is refused outright...
    expect(() => store.append("sess-cap", ["x".repeat(2048)], { restarted: true, complete: false })).toThrow(
      /retention cap/,
    );

    // ...and so is a small chunk that would push an existing file past it.
    store.append("sess-cap2", ["y".repeat(900)], { restarted: true, complete: false });
    expect(() => store.append("sess-cap2", ["z".repeat(400)], { restarted: false, complete: false })).toThrow(
      /retention cap/,
    );
    // What was retained is intact, not truncated by the refusal.
    expect((await store.read("sess-cap2")).entries).toHaveLength(1);
  });

  it("does not write through a symlink planted at the transcript path", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "retention-link-"));
    const store = createRemoteTranscriptStore({ homedir: home });
    // Materialise the directory with a legitimate write first.
    store.append("sess-decoy", ["{}"], { restarted: true, complete: false });

    const victim = path.join(home, "victim.txt");
    writeFileSync(victim, "original");
    const planted = path.join(home, ".pi", "dashboard", "remote-transcripts", "sess-link.jsonl");
    symlinkSync(victim, planted);

    // A `restarted` chunk REPLACES the file — the path that would follow the link.
    store.append("sess-link", ['{"hijacked":true}'], { restarted: true, complete: false });

    expect(readFileSync(victim, "utf8")).toBe("original");
  });
});

/**
 * `completenessOf` answers the same three states as `read` without pulling the
 * body off disk — the archived-open stamp needs `.state` alone, and today pays
 * a full read of up to 44.1 MB for it.
 * See change: offload-retained-transcript-replay (D5, task 3.4).
 */
describe("completenessOf — state without the body read", () => {
  it("maps present+marker to complete, present+no-marker to incomplete, absent to absent", async () => {
    const s = store();
    s.append("complete", [line(0)], { restarted: true, complete: true });
    s.append("partial", [line(0)], { restarted: true, complete: false });

    expect(await s.completenessOf("complete")).toBe("complete");
    expect(await s.completenessOf("partial")).toBe("incomplete");
    expect(await s.completenessOf("never-seen")).toBe("absent");
  });

  it("never throws for a session id the store refuses", async () => {
    await expect(store().completenessOf("../../etc/passwd")).resolves.toBe("absent");
  });

  it("R6 a DIRECTORY at the content path reads absent, exactly as read() reports it", async () => {
    // One three-state truth, so the probe must match `read`'s mapping exactly:
    // `access` alone calls a directory readable, while `fileFor` + `readFile`
    // fails on it with EISDIR and maps to `retained: false`.
    const s = store();
    s.append("sess-dir", [line(0)], { restarted: true, complete: true });
    fs.rmSync(contentPath("sess-dir"));
    fs.mkdirSync(contentPath("sess-dir"));

    expect(await s.completenessOf("sess-dir")).toBe("absent");
    expect((await s.read("sess-dir")).retained).toBe(false);
  });

  it("agrees with read() on every state it can reach", async () => {
    const s = store();
    s.append("complete", [line(0)], { restarted: true, complete: true });
    s.append("partial", [line(0)], { restarted: true, complete: false });
    for (const id of ["complete", "partial", "never-seen"]) {
      const read = await s.read(id);
      const expected = read.retained ? (read.complete ? "complete" : "incomplete") : "absent";
      expect(await s.completenessOf(id), id).toBe(expected);
    }
  });
});
