/**
 * What a dashboard may ask this bridge for: its own session's transcript, by
 * id, and nothing else.
 *
 * Addressing is by session id ONLY. A path on the wire turns the bridge into a
 * file-read oracle for everything the pi process can read, and the existing
 * `/api/session-file` cwd-confinement is a *server-local* check that does not
 * travel to a remote dashboard. So the guard rejects on the FIELD's presence,
 * not on whether the value looks like a traversal — validating values would
 * make this a traversal-parsing contest, which is a contest defenders lose.
 *
 * Pure and filesystem-free by construction: a refusal that touched the disk
 * would already have done the thing it is refusing.
 *
 * See change: add-pi-gateway-transport-identity (D12; tasks 11.3, 11.4).
 */

/** Field names that would smuggle a filesystem path onto the wire. */
const PATH_BEARING_FIELDS = [
  "path",
  "file",
  "filePath",
  "filepath",
  "sessionFile",
  "sessionDir",
  "dir",
  "cwd",
] as const;

export type TranscriptRefusalCause = "path-on-the-wire" | "foreign-session";

export interface TranscriptRequest {
  sessionId: string;
  /** Opaque resume cursor; carries no path. */
  cursor?: unknown;
}

export type TranscriptVerdict =
  | { allow: true }
  | { allow: false; cause: TranscriptRefusalCause; reason: string };

export function decideTranscriptRequest(input: {
  request: TranscriptRequest;
  /** Undefined until `session_register` has settled. */
  ownSessionId: string | undefined;
}): TranscriptVerdict {
  // Via `unknown`: the guard inspects arbitrary wire shapes, so a direct
  // structural cast is not merely unsafe, TS rejects it outright.
  const req = input.request as unknown as Record<string, unknown>;

  // Shape first, subject second. The other order would leak existence: a
  // path-bearing probe answered with "foreign-session" tells the caller the
  // sessionId did not match, and one answered with "path-on-the-wire" tells it
  // the id DID — an enumeration oracle built out of two refusals.
  for (const field of PATH_BEARING_FIELDS) {
    if (req[field] !== undefined) {
      return {
        allow: false,
        cause: "path-on-the-wire",
        reason: `transcript request carried a '${field}' field; sessions are addressed by id only`,
      };
    }
  }

  // No id yet means no subject to compare against. "Unknown matches" would
  // serve the first asker.
  if (!input.ownSessionId || req.sessionId !== input.ownSessionId) {
    return {
      allow: false,
      cause: "foreign-session",
      reason: "transcript request named a session this bridge does not own",
    };
  }

  return { allow: true };
}
