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

import { replayEntriesAsEvents } from "@blackbelt-technology/pi-dashboard-shared/state-replay.js";
import { decideTranscriptRequest } from "@blackbelt-technology/pi-dashboard-shared/transcript-request-guard.js";
import type { RemoteTranscriptStore } from "./remote-transcript-store.js";
import { parseSessionEntries } from "./session-file-reader.js";
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

export interface RetainedTranscriptRead {
  /** Verbatim `.jsonl` lines, in the order the origin held them. */
  entries: string[];
  /** The same lines replayed into dashboard events, oldest first. */
  events: Array<{ eventType: string; timestamp: number; data: Record<string, unknown> }>;
  state: RetainedTranscriptState;
}

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
 * Read what was retained for `sessionId` and replay it.
 *
 * Parses through `parseSessionEntries` — the same branch-order resolution the
 * local path uses — so a remote session renders the conversation the origin
 * machine would render, not a simpler linear approximation of it.
 *
 * Never throws — and the PARSE is inside that guarantee, not just the store
 * read. The store refuses a hostile session id rather than sanitising it, and
 * the replay walks attacker-shaped JSON (a single `message.content: [null]`
 * line reaches a property access on `null`). Both have to read as "no usable
 * transcript", not as an exception that takes a subscribe down or turns one
 * crafted line into a 500.
 */
export function readRetainedTranscript(
  store: RemoteTranscriptStore,
  sessionId: string,
  knownContextWindow?: number,
): RetainedTranscriptRead {
  let retained: ReturnType<RemoteTranscriptStore["read"]>;
  try {
    retained = store.read(sessionId);
  } catch {
    return { entries: [], events: [], state: "absent" };
  }
  if (!retained.retained) return { entries: [], events: [], state: "absent" };

  const state = retained.complete ? "complete" : "incomplete";
  let events: RetainedTranscriptRead["events"] = [];
  try {
    events = replayEntriesAsEvents(
      sessionId,
      parseSessionEntries(retained.entries),
      knownContextWindow,
    ).map((m) => m.event);
  } catch (err) {
    // The bytes are real and were really transferred, so the STATE still
    // stands; only the render of them failed. Reporting `absent` here would
    // claim nothing was captured, which is the one thing we know is false.
    console.error(`[transcript] retained replay failed for ${sessionId}: ${String(err)}`);
  }
  return { entries: retained.entries, events, state };
}
