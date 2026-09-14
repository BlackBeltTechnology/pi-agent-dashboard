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
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRemoteTranscriptStore } from "../remote-transcript-store.js";
import {
  chooseHydrationSource,
  decideRetainedRead,
  readRetainedTranscript,
} from "../retained-transcript.js";

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

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-rtr-"));
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

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

describe("readRetainedTranscript", () => {
  it("returns the retained entries in their original order", () => {
    const s = store();
    s.append("sess-remote", TRANSCRIPT, { restarted: false, complete: true });

    const got = readRetainedTranscript(s, "sess-remote");
    expect(got.entries).toEqual(TRANSCRIPT);
    expect(got.state).toBe("complete");
  });

  it("replays the retained entries into dashboard events, oldest first", () => {
    const s = store();
    s.append("sess-remote", TRANSCRIPT, { restarted: false, complete: true });

    const text = JSON.stringify(readRetainedTranscript(s, "sess-remote").events);
    expect(text).toContain("first thing said");
    expect(text).toContain("second thing said");
    expect(text.indexOf("first thing said")).toBeLessThan(text.indexOf("second thing said"));
  });

  it("reports a transfer that never completed as INCOMPLETE, with what it has", () => {
    const s = store();
    s.append("sess-remote", TRANSCRIPT.slice(0, 2), { restarted: false, complete: false });

    const got = readRetainedTranscript(s, "sess-remote");
    expect(got.state).toBe("incomplete");
    // Not withheld — a partial conversation still beats a blank screen, as
    // long as it is not presented as the whole one.
    expect(got.events.length).toBeGreaterThan(0);
  });

  it("reports a session that was never transferred as ABSENT, not as incomplete", () => {
    const got = readRetainedTranscript(store(), "never-transferred");
    expect(got.state).toBe("absent");
    expect(got.events).toEqual([]);
  });

  it("never builds a path out of a hostile session id", () => {
    // The store refuses rather than sanitises; the read must surface that as
    // an absent transcript, not as a crash that takes a subscribe down.
    expect(readRetainedTranscript(store(), "../../../../etc/passwd").state).toBe("absent");
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
  it("terminates on a parentId CYCLE instead of hanging the event loop", () => {
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

    const got = readRetainedTranscript(s, "cyclic");
    expect(got.state).toBe("complete");
    // Degrades to an order it can defend, rather than looping forever.
    expect(got.events.length).toBeGreaterThan(0);
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
   * See change: serve-retained-remote-transcripts (review finding D).
   */
  it("survives a transcript line that crashes the replay, keeping the state honest", () => {
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

    const got = readRetainedTranscript(s, "poison");
    expect(got.state).toBe("complete");
    expect(got.entries).toHaveLength(2);
  });

  it("terminates on a parentId SELF-loop", () => {
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
    expect(readRetainedTranscript(s, "selfloop").state).toBe("complete");
  });
});
