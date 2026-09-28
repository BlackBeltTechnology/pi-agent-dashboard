/**
 * The READ half of D12 — serving back a remote transcript this dashboard
 * already retained.
 *
 * The write half shipped; `RemoteTranscriptStore.read()` had no caller and no
 * route, so the bytes were on disk and nothing could show them. Two properties
 * decide whether adding that caller is safe:
 *
 *   - **The read is addressed by session id, never by path.** It is the same
 *     rule the bridge enforces on the wire (`decideTranscriptRequest`), applied
 *     to the dashboard's own route, from the SAME source. A route that accepted
 *     a path would be a file-read oracle wearing a transcript's clothes.
 *   - **It serves REMOTE-origin sessions only.** A local session already has a
 *     read path through its own `.jsonl`; letting this route answer for one
 *     would make it a second, less-confined way to reach local files (#E15).
 *
 * And one correctness property: a partial transfer must not read back as the
 * whole conversation, nor as an empty one.
 *
 * Tasks 1.1, 1.2, 1.3.
 * See change: serve-retained-remote-transcripts.
 *
 * Since the offload both reads are ASYNC and the hydration read takes the load
 * worker through `RetainedEventLoader`; the tests below wire the REAL
 * `loadAndReplay` projection in-process, so they exercise the production parse
 * and replay minus the thread hop.
 * See change: offload-retained-transcript-replay (D1, D3, D5).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRemoteTranscriptStore } from "../remote-transcript-store.js";
import {
  chooseHydrationSource,
  decideRetainedRead,
  type RetainedEventLoader,
  readRetainedState,
  readRetainedTranscript,
} from "../retained-transcript.js";
import { loadAndReplay } from "../session-load-worker.js";

let home: string;
const store = () => createRemoteTranscriptStore({ homedir: home });

const REMOTE = { local: false as const, deviceId: "device-abc" };
const LOCAL = { local: true as const };

/** A minimal but REAL pi transcript: header + two linear messages. */
const TRANSCRIPT = [
  { type: "session", id: "sess-remote", timestamp: "2025-01-01T00:00:00Z", cwd: "/elsewhere" },
  {
    type: "message",
    id: "e1",
    parentId: null,
    timestamp: "2025-01-01T00:00:01Z",
    message: { role: "user", content: "first thing said" },
  },
  {
    type: "message",
    id: "e2",
    parentId: "e1",
    timestamp: "2025-01-01T00:00:02Z",
    message: { role: "assistant", content: [{ type: "text", text: "second thing said" }] },
  },
].map((e) => JSON.stringify(e));

/**
 * The production projection, run in-process: the worker's `raw` arm IS
 * `parseSessionEntries(splitTranscriptLines(raw))` + `replayEntriesAsEvents`.
 * A unit test that faked the replay would be asserting its own fake.
 */
const loader: RetainedEventLoader = {
  loadRetainedEvents: async (sessionId, raw, knownContextWindow) => {
    const out = loadAndReplay({ jobId: 0, sessionId, raw, knownContextWindow });
    return { success: out.success, events: out.events, error: out.error };
  },
};

/** Hydrate and unwrap the non-cancelled arm, so a cancel is a loud test bug. */
async function hydrate(s: ReturnType<typeof store>, id: string, kcw?: number) {
  const out = await readRetainedTranscript(s, loader, id, kcw);
  if (out.cancelled) throw new Error(`unexpected cancel for ${id}`);
  return out;
}

const markerPath = (id: string) =>
  path.join(home, ".pi", "dashboard", "remote-transcripts", `${id}.jsonl.complete`);
const contentPath = (id: string) =>
  path.join(home, ".pi", "dashboard", "remote-transcripts", `${id}.jsonl`);

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-rtr-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
});

describe("decideRetainedRead", () => {
  it("serves a remote-origin session addressed by id alone", () => {
    expect(decideRetainedRead({ sessionId: "s1", query: {}, origin: REMOTE }).allow).toBe(true);
  });

  it.each(["path", "file", "filePath", "sessionFile", "sessionDir", "dir", "cwd"])(
    "refuses a request carrying a '%s' field",
    (field) => {
      const v = decideRetainedRead({
        sessionId: "s1",
        query: { [field]: "../../etc/passwd" },
        origin: REMOTE,
      });
      expect(v.allow).toBe(false);
      expect(v.allow === false && v.cause).toBe("path-on-the-wire");
    },
  );

  it("refuses a benign-looking relative path on the same rule", () => {
    // The rule is the FIELD's presence, not whether the value looks like an
    // escape — validating values makes this a traversal-parsing contest.
    const v = decideRetainedRead({ sessionId: "s1", query: { path: "notes.md" }, origin: REMOTE });
    expect(v.allow === false && v.cause).toBe("path-on-the-wire");
  });

  it("refuses a LOCAL-origin session, so this cannot become a second local read (task 1.3)", () => {
    const v = decideRetainedRead({ sessionId: "s1", query: {}, origin: LOCAL });
    expect(v.allow).toBe(false);
    expect(v.allow === false && v.cause).toBe("local-origin");
  });

  it("refuses the path BEFORE deciding on the origin, so both ends refuse alike", () => {
    // One rule, one source: the bridge refuses a path-bearing
    // `transcript_request` on shape before it looks at the subject, and this
    // route must answer the same way to the same probe. (Origin itself is not
    // a secret — `originDeviceId` rides `GET /api/sessions` — so this is
    // rule-consistency, not concealment.)
    const v = decideRetainedRead({ sessionId: "s1", query: { path: "x" }, origin: LOCAL });
    expect(v.allow === false && v.cause).toBe("path-on-the-wire");
  });

  it("cannot be induced to serve another session by a sessionId query field", () => {
    // The subject comes from the ROUTE parameter. A `?sessionId=` rider must
    // not become the subject, or the route serves any id the caller names.
    const v = decideRetainedRead({
      sessionId: "s1",
      query: { sessionId: "someone-elses-session" },
      origin: REMOTE,
    });
    expect(v.allow).toBe(true);
  });
});

/**
 * Which disk a session's history is read from. The whole #E15 hazard is that a
 * remote session's recorded `sessionFile` NAMES A REAL LOCAL FILE when two
 * machines share a username, so "remote origin never reaches the local file"
 * has to hold by CONSTRUCTION, not by the order of a chain of ifs.
 * See change: serve-retained-remote-transcripts (review findings 2, 3).
 */
describe("chooseHydrationSource", () => {
  it("reads a local session from its own transcript file", () => {
    expect(
      chooseHydrationSource({
        origin: LOCAL,
        sessionFile: "/home/me/.pi/sessions/s1.jsonl",
        hasRetentionStore: true,
      }),
    ).toBe("local-file");
  });

  it("reads a remote session from retention", () => {
    expect(
      chooseHydrationSource({
        origin: REMOTE,
        sessionFile: "/home/me/.pi/sessions/s1.jsonl",
        hasRetentionStore: true,
      }),
    ).toBe("retained");
  });

  it("FAILS CLOSED for a remote session when no retention store is wired", () => {
    // The tempting fallback is the recorded `sessionFile`. That is the #E15
    // read: a missing store is a reason to show nothing, never a reason to
    // open another host's path on this disk.
    expect(
      chooseHydrationSource({
        origin: REMOTE,
        sessionFile: "/home/me/.pi/sessions/s1.jsonl",
        hasRetentionStore: false,
      }),
    ).toBe("none");
  });

  it("never returns local-file for a remote origin, whatever the inputs", () => {
    for (const sessionFile of [undefined, "", "/any/path.jsonl"]) {
      for (const hasRetentionStore of [true, false]) {
        expect(
          chooseHydrationSource({ origin: REMOTE, sessionFile, hasRetentionStore }),
        ).not.toBe("local-file");
      }
    }
  });

  it("has nothing to read for a local session with no transcript path", () => {
    expect(
      chooseHydrationSource({ origin: LOCAL, sessionFile: undefined, hasRetentionStore: true }),
    ).toBe("none");
  });
});

/**
 * The HTTP callers want entries and/or completeness and discard events. Making
 * them pay a full parse + event synthesis for output nobody reads is wasted
 * main-thread time against a transcript whose observed maximum is 44.1 MB.
 * See CodeRabbit #663, thread 5.
 */
describe("readRetainedState", () => {
  it("returns entries and state without replaying", async () => {
    const s = store();
    s.append("sess-remote", TRANSCRIPT, { restarted: true, complete: true });
    expect(await readRetainedState(s, "sess-remote")).toEqual({
      entries: TRANSCRIPT,
      state: "complete",
    });
  });

  it("E8 maps the three states off {content, marker} independently", async () => {
    const s = store();
    s.append("complete", TRANSCRIPT, { restarted: true, complete: true });
    s.append("incomplete", TRANSCRIPT, { restarted: true, complete: false });

    expect((await readRetainedState(s, "complete")).state).toBe("complete");
    expect((await readRetainedState(s, "incomplete")).state).toBe("incomplete");
    // Content present but no marker does NOT collapse into absent — the
    // distinction the whole three-state contract exists for.
    expect((await readRetainedState(s, "never-seen")).state).toBe("absent");
  });

  it("agrees with the replaying read on every state, so the two cannot drift", async () => {
    const s = store();
    s.append("complete", TRANSCRIPT, { restarted: true, complete: true });
    s.append("partial", TRANSCRIPT.slice(0, 2), { restarted: true, complete: false });
    for (const id of ["complete", "partial", "never-seen"]) {
      expect((await readRetainedState(s, id)).state, id).toBe((await hydrate(s, id)).state);
    }
  });

  it("agrees with the store on the HTTP entries, so the surface cannot drift", async () => {
    const s = store();
    s.append("sess-remote", TRANSCRIPT, { restarted: false, complete: true });
    expect((await readRetainedState(s, "sess-remote")).entries).toEqual(
      (await s.read("sess-remote")).entries,
    );
  });

  it("E9 resolves ABSENT for a refused session id, without rejecting", async () => {
    // The store refuses rather than sanitises; the read must surface that as an
    // absent transcript, not as a crash that takes a subscribe down.
    await expect(readRetainedState(store(), "../../../../etc/passwd")).resolves.toEqual({
      entries: [],
      state: "absent",
    });
  });

  it("does NOT throw on a transcript whose replay would crash", async () => {
    // It never reaches the replay at all — that is the point of the split.
    const s = store();
    s.append(
      "poison",
      [
        JSON.stringify({ type: "session", id: "poison", timestamp: "2025-01-01T00:00:00Z" }),
        JSON.stringify({
          type: "message",
          id: "p1",
          parentId: null,
          message: { role: "assistant", content: [null] },
        }),
      ],
      { restarted: true, complete: true },
    );
    expect((await readRetainedState(s, "poison")).state).toBe("complete");
  });
});

describe("readRetainedTranscript", () => {
  it("replays the retained entries into dashboard events, oldest first", async () => {
    const s = store();
    s.append("sess-remote", TRANSCRIPT, { restarted: false, complete: true });

    const text = JSON.stringify((await hydrate(s, "sess-remote")).events);
    expect(text).toContain("first thing said");
    expect(text).toContain("second thing said");
    expect(text.indexOf("first thing said")).toBeLessThan(text.indexOf("second thing said"));
  });

  it("carries the state alongside the events, and no `entries`", async () => {
    // Shipping the split array back across the worker boundary would put on the
    // main thread exactly the work the offload moved off it, and no caller
    // reads it. See change: offload-retained-transcript-replay (task 4.6).
    const s = store();
    s.append("sess-remote", TRANSCRIPT, { restarted: false, complete: true });
    expect(Object.keys(await hydrate(s, "sess-remote")).sort()).toEqual(["cancelled", "events", "state"]);
  });

  it("reports a transfer that never completed as INCOMPLETE, with what it has", async () => {
    const s = store();
    s.append("sess-remote", TRANSCRIPT.slice(0, 2), { restarted: false, complete: false });

    const got = await hydrate(s, "sess-remote");
    expect(got.state).toBe("incomplete");
    // Not withheld — a partial conversation still beats a blank screen, as
    // long as it is not presented as the whole one.
    expect(got.events.length).toBeGreaterThan(0);
  });

  it("reports a session that was never transferred as ABSENT, not as incomplete", async () => {
    const s = store();
    const got = await hydrate(store(), "never-transferred");
    expect(got.state).toBe("absent");
    expect(got.events).toEqual([]);

    // E11: the absent short-circuit happens BEFORE the pool, so a no-op read
    // cannot inflate the shared in-flight counter or evict a real hydration
    // sample from the ring.
    const pool = { loadRetainedEvents: vi.fn() };
    expect(await readRetainedTranscript(s, pool as unknown as RetainedEventLoader, "never-transferred")).toEqual({
      cancelled: false,
      events: [],
      state: "absent",
    });
    expect(pool.loadRetainedEvents).not.toHaveBeenCalled();
  });

  it("never builds a path out of a hostile session id", async () => {
    // The store refuses rather than sanitises; the read must surface that as
    // an absent transcript, not as a crash that takes a subscribe down.
    expect((await hydrate(store(), "../../../../etc/passwd")).state).toBe("absent");
  });

  /**
   * The retained bytes are VERBATIM bridge-controlled input (`event-wiring`
   * appends `msg.entries` with no content validation), and this read runs on
   * the event loop. Until this change the same parser only ever saw
   * pi-written local files inside the load worker, so a `parentId` cycle was
   * unreachable; now it is two well-formed lines away. An unbounded leaf→root
   * walk would hang the whole dashboard — no HTTP, no WS, and not even the
   * hydration heartbeat, which shares the blocked loop.
   *
   * Bounded by a 2s fake ceiling: a regression does not fail this test, it
   * hangs the run, so the assertion is "it returned at all".
   * See change: serve-retained-remote-transcripts (review finding 1).
   */
  it("terminates on a parentId CYCLE instead of hanging the event loop", async () => {
    const s = store();
    s.append(
      "cyclic",
      [
        JSON.stringify({ type: "session", id: "cyclic", timestamp: "2025-01-01T00:00:00Z" }),
        JSON.stringify({
          type: "message",
          id: "a",
          parentId: "b",
          message: { role: "user", content: "ping" },
        }),
        JSON.stringify({
          type: "message",
          id: "b",
          parentId: "a",
          message: { role: "user", content: "pong" },
        }),
      ],
      { restarted: true, complete: true },
    );

    const got = await hydrate(s, "cyclic");
    expect(got.state).toBe("complete");
    // Degrades to an order it can defend, rather than looping forever — and
    // specifically to the LINEAR fallback, not to an arbitrary prefix of the
    // walk that failed. Both entries survive; a returned partial branch would
    // have dropped one. (CodeRabbit #663, thread 4.)
    expect(got.events.length).toBeGreaterThan(0);
    const text = JSON.stringify(got.events);
    expect(text).toContain("ping");
    expect(text).toContain("pong");
  });

  /**
   * The store read is guarded, but the REPLAY was not: one line carrying
   * `message.content: [null]` reaches a property access on `null` inside
   * `replayEntriesAsEvents`. On the route that is a 500 from a single crafted
   * line sent by a paired device; on hydration it is a degraded session. The
   * contract says "never throws", so the parse has to be inside it.
   *
   * The STATE must survive: the bytes really were transferred, and reporting
   * `absent` would claim the one thing known to be false.
   * See change: serve-retained-remote-transcripts (review finding D);
   * test-plan #X3 / #E10.
   */
  it("X3 survives a transcript line that crashes the replay, keeping the state honest", async () => {
    const s = store();
    s.append(
      "poison",
      [
        JSON.stringify({ type: "session", id: "poison", timestamp: "2025-01-01T00:00:00Z" }),
        JSON.stringify({
          type: "message",
          id: "p1",
          parentId: null,
          timestamp: "2025-01-01T00:00:01Z",
          message: { role: "assistant", content: [null] },
        }),
      ],
      { restarted: true, complete: true },
    );

    const got = await hydrate(s, "poison");
    expect(got.state).toBe("complete");
    expect(got.events).toEqual([]);
  });

  it("R5 a loader that REJECTS still resolves, with the state intact", async () => {
    // `loadRetainedEvents` is expected to resolve a failure rather than reject,
    // but this read's contract is never-throws: an unexpected rejection (a pool
    // or worker fault outside the handled paths) must degrade the render, not
    // escape the caller and lose the state we already know is true.
    const s = store();
    s.append("sess-remote", TRANSCRIPT, { restarted: true, complete: true });
    const rejecting = {
      loadRetainedEvents: async () => {
        throw new Error("pool exploded");
      },
    } as unknown as RetainedEventLoader;

    await expect(readRetainedTranscript(s, rejecting, "sess-remote")).resolves.toEqual({
      cancelled: false,
      events: [],
      state: "complete",
    });
  });

  it("terminates on a parentId SELF-loop", async () => {
    const s = store();
    s.append(
      "selfloop",
      [
        JSON.stringify({ type: "session", id: "selfloop", timestamp: "2025-01-01T00:00:00Z" }),
        JSON.stringify({
          type: "message",
          id: "a",
          parentId: "a",
          message: { role: "user", content: "me" },
        }),
      ],
      { restarted: true, complete: true },
    );
    expect((await hydrate(s, "selfloop")).state).toBe("complete");
  });
});

/**
 * EACCES on the two files must map to two DIFFERENT states. Getting this wrong
 * in the obvious direction — one shared catch — collapses every `incomplete`
 * into `absent`, i.e. "history may be missing" becomes "there is nothing to
 * miss" (or the reverse) for the failure mode an operator can actually fix.
 * See change: offload-retained-transcript-replay (D5, tasks 3.5, 6.29, 6.30).
 */
describe("unreadable marker vs unreadable content", () => {
  it("X10 an unreadable MARKER reads INCOMPLETE, never absent", async () => {
    if (process.platform === "win32") return; // chmod is a documented no-op
    const s = store();
    s.append("sess-remote", TRANSCRIPT, { restarted: true, complete: true });
    fs.chmodSync(markerPath("sess-remote"), 0o000);

    expect((await readRetainedState(s, "sess-remote")).state).toBe("incomplete");
  });

  it("X11 unreadable CONTENT reads ABSENT, and does not throw", async () => {
    if (process.platform === "win32") return;
    const s = store();
    s.append("sess-remote", TRANSCRIPT, { restarted: true, complete: true });
    fs.chmodSync(contentPath("sess-remote"), 0o000);

    await expect(readRetainedState(s, "sess-remote")).resolves.toEqual({
      entries: [],
      state: "absent",
    });
  });
});
