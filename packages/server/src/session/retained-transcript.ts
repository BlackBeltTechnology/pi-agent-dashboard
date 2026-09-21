/**
 * Serving back a remote transcript this dashboard already retained.
 *
 * `add-pi-gateway-transport-identity` shipped the acquisition half: a joining
 * bridge streams `transcript_chunk` frames and `RemoteTranscriptStore` persists
 * them. The read half was deferred, so the data sat on disk with no caller and
 * no route — a user joining a remote dashboard saw a session whose history
 * existed on the server and rendered empty.
 *
 * Two boundaries make adding that caller safe, and they are enforced in this
 * order deliberately:
 *
 *   1. **No path on the wire.** Enforced by the SAME `decideTranscriptRequest`
 *      the bridge applies to an inbound `transcript_request` — one rule, one
 *      source, because a duplicated security rule drifts and the copy that
 *      drifts is the one nobody is reading. Sessions are addressed by id only.
 *   2. **Remote-origin only** (D13). A local session already has a read path
 *      through its own `.jsonl`; answering for one here would make this a
 *      second, less-confined road to local files — the #E15 shape.
 *
 * Shape first, subject second, matching the bridge guard exactly: one rule from
 * one source means the same probe gets the same refusal at both ends. (Origin
 * is not itself a secret — `originDeviceId` rides `GET /api/sessions` — so the
 * ordering is rule-consistency, not concealment.)
 *
 * See change: serve-retained-remote-transcripts (tasks 1.1, 1.2, 1.3).
 */

import { decideTranscriptRequest } from "@blackbelt-technology/pi-dashboard-shared/transcript-request-guard.js";
import type { DirectoryService } from "../directory-service.js";
import type { RemoteTranscriptStore } from "./remote-transcript-store.js";
import type { SessionOrigin } from "./session-origin.js";

type RetainedReadRefusal = "path-on-the-wire" | "local-origin";

export type RetainedReadVerdict =
  | { allow: true }
  | { allow: false; cause: RetainedReadRefusal; reason: string };

/**
 * Three states, because two cannot answer the only question a user asks of an
 * empty transcript: is something missing?
 *
 *   - `complete`   — the origin's file was read to its end; this IS everything.
 *   - `incomplete` — a transfer happened and stopped early; more existed.
 *   - `absent`     — no transfer ever happened; there is nothing to be missing.
 *
 * Collapsing `incomplete` into `absent` warns about loss on sessions that never
 * had history; collapsing it into `complete` hides real loss. Neither is
 * recoverable downstream, so the distinction is made here.
 */
export type RetainedTranscriptState = "complete" | "incomplete" | "absent";

/** Which disk a session's cold hydration reads from. */
export type HydrationSource = "retained" | "local-file" | "none";

/**
 * Pick the hydration source for a session.
 *
 * The #E15 hazard is that a remote session's recorded `sessionFile` names a
 * path on ANOTHER host — and when two machines share a username it also names
 * a real, unrelated file on THIS one. So "a remote origin never reads the local
 * file" must hold by construction: the remote arm below has no branch that can
 * return `"local-file"`, whatever the other inputs say.
 *
 * A remote session with no retention store therefore yields `"none"`, not the
 * `sessionFile` fallback. A missing store is a reason to show nothing; it is
 * never a reason to open another host's path on this disk.
 *
 * See change: serve-retained-remote-transcripts (task 2.1).
 */
export function chooseHydrationSource(input: {
  origin: SessionOrigin;
  sessionFile: string | undefined;
  hasRetentionStore: boolean;
}): HydrationSource {
  if (!input.origin.local) return input.hasRetentionStore ? "retained" : "none";
  return input.sessionFile ? "local-file" : "none";
}

export interface RetainedStateRead {
  /** Verbatim `.jsonl` lines, in the order the origin held them. */
  entries: string[];
  state: RetainedTranscriptState;
}

/** The event shape both hydration sources produce (`LoadResult.events`). */
type RetainedTranscriptEvents = Array<{
  eventType: string;
  timestamp: number;
  data: Record<string, unknown>;
}>;

/**
 * Cold-hydration result.
 *
 * `entries` is deliberately ABSENT: no caller reads it, and shipping the split
 * array back across the worker boundary would put on the main thread exactly
 * the work the offload moved off it. `readRetainedState` keeps entries for its
 * two HTTP call sites, which do need them.
 *
 * `cancelled` is surfaced DISTINCTLY rather than folded into
 * `{events: [], state}`. The local path skips every side effect on cancel, so
 * folding it would stamp `retainedTranscript` and broadcast `session_updated`
 * after the last subscriber left.
 * See change: offload-retained-transcript-replay (D3, tasks 4.4, 4.6).
 */
export type RetainedTranscriptHydration =
  | { cancelled: true }
  | { cancelled: false; events: RetainedTranscriptEvents; state: RetainedTranscriptState };

/**
 * The one `DirectoryService` method the hydration read needs. Narrowed to a
 * `Pick` so a unit test can supply the load contract alone, and so the module
 * cannot grow a second dependency on the poller by accident.
 */
export type RetainedEventLoader = Pick<DirectoryService, "loadRetainedEvents">;

/** May this dashboard serve `sessionId`'s retained transcript to this caller? */
export function decideRetainedRead(input: {
  sessionId: string;
  /** The caller's request fields, minus the id. Inspected for path smuggling. */
  query: Record<string, unknown>;
  origin: SessionOrigin;
}): RetainedReadVerdict {
  // `as never` because the guard deliberately types its input as the LEGITIMATE
  // request shape while inspecting arbitrary caller-supplied fields; there is
  // no honest structural type for "whatever the caller sent".
  //
  // `sessionId` is spread LAST, so a `?sessionId=` rider cannot displace the
  // route parameter as the subject. The id comes from the route, never from the
  // query, which satisfies the guard's subject check by construction and leaves
  // its shape check — the half that matters here — to run over the rest.
  const verdict = decideTranscriptRequest({
    request: { ...input.query, sessionId: input.sessionId } as never,
    ownSessionId: input.sessionId,
  });
  if (!verdict.allow) {
    return { allow: false, cause: "path-on-the-wire", reason: verdict.reason };
  }
  if (input.origin.local) {
    return {
      allow: false,
      cause: "local-origin",
      reason:
        `session ${input.sessionId} originated on this host; ` +
        "its transcript is read from its own session file, not from remote retention",
    };
  }
  return { allow: true };
}

/**
 * Read what was retained for `sessionId`, WITHOUT replaying it.
 *
 * The two HTTP callers need `entries` and/or `state` and discard events
 * entirely, so replaying for them would spend a full parse + event synthesis
 * on output nobody reads — on the main thread, against a transcript whose
 * observed maximum is 44.1 MB. Only cold hydration actually needs the events.
 *
 * Never throws: the store refuses a hostile session id rather than sanitising
 * it, and that refusal has to read as "no transcript", not as an exception.
 * See CodeRabbit #663, thread 5.
 */
export async function readRetainedState(
  store: RemoteTranscriptStore,
  sessionId: string,
): Promise<RetainedStateRead> {
  let retained: Awaited<ReturnType<RemoteTranscriptStore["read"]>>;
  try {
    // `await` INSIDE the `try` is load-bearing: `fileFor`'s refusal for a
    // hostile session id is a REJECTION once the read is async, and a
    // `try/catch` around a non-awaited promise catches nothing — the
    // never-throws guarantee would break silently.
    // See change: offload-retained-transcript-replay (D5, task 4.9).
    retained = await store.read(sessionId);
  } catch {
    return { entries: [], state: "absent" };
  }
  if (!retained.retained) return { entries: [], state: "absent" };
  return { entries: retained.entries, state: retained.complete ? "complete" : "incomplete" };
}

/**
 * Read what was retained for `sessionId` AND replay it into dashboard events.
 *
 * For cold hydration, which is the only caller that consumes the events; a
 * caller wanting just entries or completeness should use `readRetainedState`
 * and skip the parse entirely.
 *
 * The read, the line split, the parse and the replay all happen off the main
 * thread: the raw text goes to the load worker, which runs the SAME
 * `parseSessionEntries` + `replayEntriesAsEvents` projection the local path
 * uses — one projection, so a remote session renders the conversation the
 * origin machine would render, not a simpler linear approximation of it.
 *
 * Never throws — and the PARSE is inside that guarantee, not just the store
 * read. The replay walks attacker-shaped JSON (a single `message.content:
 * [null]` line reaches a property access on `null`); the worker reports it as
 * a failed load and the STATE still stands.
 */
export async function readRetainedTranscript(
  store: RemoteTranscriptStore,
  loader: RetainedEventLoader,
  sessionId: string,
  knownContextWindow?: number,
): Promise<RetainedTranscriptHydration> {
  let raw: string;
  let state: RetainedTranscriptState;
  try {
    const read = await store.readRaw(sessionId);
    // The absent short-circuit: no pool round-trip for a session that never
    // transferred, and no hydration sample (see `loadRetainedEvents`).
    if (!read.retained) return { cancelled: false, events: [], state: "absent" };
    raw = read.raw;
    state = read.complete ? "complete" : "incomplete";
  } catch {
    // A refused id, or any store failure: “no transcript”, never an exception.
    return { cancelled: false, events: [], state: "absent" };
  }

  // `await` INSIDE a `try`: the loader is expected to resolve a failure rather
  // than reject, but the READ's contract is never-throws, and an unexpected
  // rejection (a pool or worker fault outside the handled paths) must degrade
  // to `{events: [], state}` rather than escape to the caller and lose the
  // state we already know.
  let out: Awaited<ReturnType<RetainedEventLoader["loadRetainedEvents"]>>;
  try {
    out = await loader.loadRetainedEvents(sessionId, raw, knownContextWindow);
  } catch (err) {
    console.error(`[transcript] retained load rejected for ${sessionId}: ${String(err)}`);
    return { cancelled: false, events: [], state };
  }
  if (out.error === "cancelled") {
    // The last subscriber left before this resolved. Take the same silent exit
    // the local path takes: no insert, no broadcast, no `retainedTranscript`
    // stamp after the session has nobody watching it.
    return { cancelled: true };
  }
  if (!out.success) {
    // Disposed pool, an invalid request, or the worker's replay-throw message.
    // The bytes ARE real and were really transferred, so the STATE still
    // stands; only the render of them failed. Reporting `absent` here would
    // claim nothing was captured, which is the one thing we know is false.
    console.error(
      `[transcript] retained replay failed for ${sessionId}: ${out.error ?? "replay_error"}`,
    );
    return { cancelled: false, events: [], state };
  }
  return { cancelled: false, events: out.events, state };
}
