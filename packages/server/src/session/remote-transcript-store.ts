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
// Type-only: erased at compile time, so this does not couple the store to the
// read module at runtime (`retained-transcript.ts` imports this module's type).
import type { RetainedTranscriptState } from "./retained-transcript.js";

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
  /**
   * True when a transcript file exists for this session at all.
   *
   * `complete:false` cannot carry this: it is equally what a never-transferred
   * session reads back as, so without this flag "the transfer stopped early"
   * and "nothing was ever captured" are the same answer — and they call for
   * opposite responses from whoever is looking at the empty screen.
   * See change: serve-retained-remote-transcripts (task 1.2).
   */
  retained: boolean;
}

export interface RemoteTranscriptStore {
  append(
    sessionId: string,
    entries: string[],
    meta: { restarted: boolean; complete: boolean },
  ): void;
  /**
   * Async since the retained offload (`fs.promises`): the synchronous
   * `readFileSync` of a 44 MB transcript was a main-thread stall in its own
   * right. See change: offload-retained-transcript-replay (D5).
   */
  read(sessionId: string): Promise<RetainedTranscript>;
  /**
   * The same bytes as `read`, without the store's entries projection, plus
   * both marker samples. `read` is implemented on top of this, so the two
   * cannot disagree about completeness.
   */
  readRaw(sessionId: string): Promise<RemoteTranscriptRawRead>;
  /**
   * `complete | incomplete | absent` for `sessionId`, WITHOUT reading the
   * file body. For a caller that wants only the state (the archived-open
   * stamp), reading a 44 MB transcript to answer a boolean is pure waste.
   */
  completenessOf(sessionId: string): Promise<RetainedTranscriptState>;
  forget(sessionId: string): void;
}

/** `readRaw`'s result: verbatim text + completeness, no entries projection. */
interface RemoteTranscriptRawRead {
  raw: string;
  complete: boolean;
  retained: boolean;
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

  /**
   * Is a completion marker present AND readable?
   *
   * `fs.promises.access` REJECTS on ENOENT where `existsSync` merely returned
   * `false`, so both outcomes have to be caught here — and both mean the same
   * thing (`no completion recorded`), which is emphatically not `absent`. That
   * distinction is what keeps a missing marker on the `incomplete` side of the
   * three-state contract.
   *
   * `R_OK`, not the default `F_OK`: a marker that EXISTS but cannot be read is
   * not a completion we can trust, and `F_OK` would answer `complete` for it.
   */
  async function markerExists(sessionId: string): Promise<boolean> {
    try {
      await fs.promises.access(markerFor(sessionId), fs.constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Sample the marker BEFORE and AFTER the content read and take the
   * conjunction.
   *
   * `append` writes the body then the marker (completion race), and on a
   * restart rewrites the body then CLEARS the marker (restart race).
   * Marker-first alone fixes only the first; marker-last alone only the
   * second. The conjunction resolves both to `complete: false`, i.e. a whole
   * transcript may briefly read `incomplete` — the conservative direction the
   * three-state contract tolerates, self-healing on the next read.
   */
  async function readRaw(sessionId: string): Promise<RemoteTranscriptRawRead> {
    const markerBefore = await markerExists(sessionId);
    const file = fileFor(sessionId);

    // Read BYTES, not a decoded string: the byte count is compared against the
    // file's size below, and decoding first would make that comparison lossy for
    // invalid UTF-8 (every replacement character is 3 bytes).
    let bytes: Buffer;
    try {
      bytes = await fs.promises.readFile(file);
    } catch (err) {
      // The restart path `rmSync`s before it `writeFileSync`s, and this read
      // runs on the threadpool — so a read landing inside that window gets
      // ENOENT and would report “no transfer ever happened” for a session that
      // is merely mid-restart. One retry after a macrotask yield closes a
      // window two adjacent synchronous `fs` calls wide; a genuinely absent
      // transcript costs one extra failed `open`.
      // A non-ENOENT failure (EACCES, EISDIR, or the refused-id throw from
      // `fileFor`) is the ordinary `retained: false` mapping.
      if ((err as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
        return { raw: "", complete: false, retained: false };
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      try {
        bytes = await fs.promises.readFile(file);
      } catch {
        return { raw: "", complete: false, retained: false };
      }
    }

    // The byte count is a THIRD conjunct, and it is not redundant with the two
    // marker samples. `append` rewrites the body with a synchronous
    // `writeFileSync` while a restart that also sets `complete:true` leaves the
    // pre-existing marker in place — and `readFile` runs on the threadpool, so
    // it CAN open the file mid-write and return a truncated prefix while BOTH
    // marker samples read `true`. Main-thread JS cannot be interleaved, so the
    // write has necessarily finished by the time this continuation runs: a
    // short read against a longer file proves the bytes are not the whole
    // current body. Reporting a whole transcript as `incomplete` is the only
    // direction the three-state contract tolerates, and the next read corrects
    // it. See change: offload-retained-transcript-replay (D5).
    let sizeAfter: number | null;
    try {
      sizeAfter = (await fs.promises.stat(file)).size;
    } catch {
      // The file moved underneath us; we cannot vouch for what we read.
      sizeAfter = null;
    }
    const wholeBody = sizeAfter !== null && sizeAfter === bytes.length;

    const complete = markerBefore && wholeBody && (await markerExists(sessionId));
    return { raw: bytes.toString("utf8"), complete, retained: true };
  }

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

    async read(sessionId) {
      const { raw, complete, retained } = await readRaw(sessionId);
      if (!retained) return { entries: [], complete: false, retained: false };
      // Deliberately NOT the shared `splitTranscriptLines`: that is
      // `raw.trim().split("\n")`, which turns `""` into `[""]` (an
      // empty-origin transcript IS reachable — the bridge emits one), drops
      // interior blanks, and strips a leading BOM off entry 0. The HTTP
      // `entries` surface is byte-for-byte what it is today.
      // See change: offload-retained-transcript-replay (D1/D5, task 2.2).
      return {
        entries: raw.split("\n").filter((l) => l.length > 0),
        complete,
        retained: true,
      };
    },

    readRaw,

    async completenessOf(sessionId) {
      // Marker + a REGULAR, READABLE file — never the body. The probe has to
      // match `readRaw`'s mapping exactly or this store would hold two truths:
      // `stat().isFile()` rejects a DIRECTORY (which `readFile` fails on with
      // EISDIR) and `R_OK` rejects an unreadable file (which `readFile` fails
      // on with EACCES) — both of which `read`/`readRaw` report as `absent`.
      // `access` alone would call a directory readable; `stat` alone would
      // call a chmod-000 file readable.
      // See change: offload-retained-transcript-replay (D5, task 6.30).
      try {
        const target = fileFor(sessionId);
        const stat = await fs.promises.stat(target);
        if (!stat.isFile()) return "absent";
        await fs.promises.access(target, fs.constants.R_OK);
      } catch {
        // Absent, unreadable, a directory, or a refused id — all “we cannot
        // show a transcript”.
        return "absent";
      }
      return (await markerExists(sessionId)) ? "complete" : "incomplete";
    },

    forget(sessionId) {
      fs.rmSync(fileFor(sessionId), { force: true });
      fs.rmSync(markerFor(sessionId), { force: true });
    },
  };
}
