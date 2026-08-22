/**
 * Where a remote session's transcript lives once it reaches this dashboard.
 *
 * D12's retention half: the origin host leaves, and the transcript has to
 * outlive it (11.10). It also has to be full-fidelity, because
 * `memory-event-store` is lossy BY DESIGN — 4 KB string cap, eviction,
 * per-session trimming — and the local escape hatch
 * (`findSessionToolCallPayload` reading the `.jsonl`) has no remote equivalent.
 * For a remote session, this file IS the `.jsonl` (11.9).
 *
 * `sessionId` is untrusted input: it arrives in a `session_register` from a
 * possibly-remote bridge. Interpolating it into a path would be a
 * write-anywhere primitive, so ids are validated against a strict shape and
 * rejected rather than sanitised — sanitising invites a normalisation contest.
 *
 * A restarted read REPLACES; it never appends. The backfill cursor restarts
 * when the origin's prefix was rewritten or the file truncated, and appending
 * that second pass would duplicate every entry into a corrupt retained copy.
 *
 * See change: add-pi-gateway-transport-identity (D12; tasks 11.6, 11.9, 11.10).
 */

import fs from "node:fs";
import path from "node:path";
import { getDashboardConfigDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";

/**
 * A safe filename component: alphanumerics, dash, underscore, bounded.
 *
 * Deliberately NOT "must be a uuid". Today's ids are uuids, but pinning the
 * format here would make the store start refusing — and silently losing —
 * transcripts the day pi changes it. This charset already excludes every
 * traversal primitive (`/`, `\`, `.`, NUL) and separators, which is the actual
 * requirement; matching a specific id grammar is not.
 */
const SESSION_ID_SHAPE = /^[A-Za-z0-9_-]{1,64}$/;

interface RetainedTranscript {
  entries: string[];
  /** True once a chunk reported the origin file fully read. */
  complete: boolean;
}

export interface RemoteTranscriptStore {
  append(
    sessionId: string,
    entries: string[],
    meta: { restarted: boolean; complete: boolean },
  ): void;
  read(sessionId: string): RetainedTranscript;
  forget(sessionId: string): void;
}

export function createRemoteTranscriptStore(env?: {
  homedir?: string;
}): RemoteTranscriptStore {
  const dir = path.join(getDashboardConfigDir(env), "remote-transcripts");

  const fileFor = (sessionId: string): string => {
    if (!SESSION_ID_SHAPE.test(sessionId)) {
      throw new Error(`refusing to build a transcript path from session id ${JSON.stringify(sessionId)}`);
    }
    return path.join(dir, `${sessionId}.jsonl`);
  };

  // A sidecar rather than a field inside the transcript: the transcript must
  // stay byte-identical to what the origin holds, so completeness cannot be
  // recorded inside it.
  const markerFor = (sessionId: string): string => `${fileFor(sessionId)}.complete`;

  return {
    append(sessionId, entries, meta) {
      const file = fileFor(sessionId);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      // `recursive: true` does not apply the mode to a directory that already
      // existed, and this sits beside identity.key and paired-devices.json.
      try {
        fs.chmodSync(dir, 0o700);
      } catch {
        /* Windows: chmod is a documented no-op. */
      }
      const body = entries.length > 0 ? `${entries.join("\n")}\n` : "";
      if (meta.restarted) {
        fs.writeFileSync(file, body, { mode: 0o600 });
      } else {
        fs.appendFileSync(file, body, { mode: 0o600 });
      }
      try {
        fs.chmodSync(file, 0o600);
      } catch {
        /* Windows */
      }
      if (meta.complete) fs.writeFileSync(markerFor(sessionId), "", { mode: 0o600 });
      else if (meta.restarted) fs.rmSync(markerFor(sessionId), { force: true });
    },

    read(sessionId) {
      let raw: string;
      try {
        raw = fs.readFileSync(fileFor(sessionId), "utf8");
      } catch {
        return { entries: [], complete: false };
      }
      return {
        entries: raw.split("\n").filter((l) => l.length > 0),
        complete: fs.existsSync(markerFor(sessionId)),
      };
    },

    forget(sessionId) {
      fs.rmSync(fileFor(sessionId), { force: true });
      fs.rmSync(markerFor(sessionId), { force: true });
    },
  };
}
