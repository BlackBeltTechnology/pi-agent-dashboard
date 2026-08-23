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
/**
 * Per-session retention ceiling, overridable per store.
 *
 * Measured (task 13.7) rather than guessed: p50 73 KB, p90 1.1 MB, p99 3.9 MB,
 * and an observed MAXIMUM of 44.1 MB across 3471 local transcripts. An earlier
 * 64 MB was called "generous" against the p99 — but against the real maximum it
 * is 1.45x, which is not headroom. A legitimate transcript half again as large
 * as today's biggest would silently stop being retained, and losing a real
 * user's history is a worse failure than the disk-fill it guards against —
 * especially as that attack already requires an authenticated paired device.
 *
 * 256 MB keeps the stream bounded while making a false positive remote.
 */
const DEFAULT_MAX_RETAINED_BYTES = 256 * 1024 * 1024;

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

export function createRemoteTranscriptStore(
  env?: {
    homedir?: string;
    /** Per-session retention ceiling; injectable so a test need not write 256 MB. */
    maxRetainedBytes?: number;
  },
): RemoteTranscriptStore {
  const maxRetainedBytes = env?.maxRetainedBytes ?? DEFAULT_MAX_RETAINED_BYTES;
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
      // Retention is driven by a possibly-REMOTE bridge, so it is a disk-fill
      // primitive without a ceiling: a paired device can stream chunks until
      // the dashboard's disk is gone. The cap is generous next to the measured
      // p99 (3.9 MB) but finite; past it the transcript is simply not extended.
      const existingBytes = meta.restarted ? 0 : (fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0);
      if (existingBytes + Buffer.byteLength(body) > maxRetainedBytes) {
        throw new Error(
          `remote transcript for ${sessionId} exceeds the ${maxRetainedBytes}-byte retention cap; not extended`,
        );
      }
      // `writeFileSync`/`appendFileSync` FOLLOW symlinks, so a same-uid process
      // can pre-plant <sessionId>.jsonl and redirect remote-controlled content
      // to an arbitrary file. `writeOwnerPid` already defends this exact shape;
      // the two now agree.
      if (meta.restarted) {
        fs.rmSync(file, { force: true });
        fs.writeFileSync(file, body, { mode: 0o600, flag: "wx" });
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
