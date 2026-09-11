/**
 * Voiceprint library: persisted speaker embeddings plus the multi-speaker
 * "cohort" used to remove the shared channel/session direction from every
 * comparison (centering).
 *
 * Two invariants drive the shape:
 *   1. Stored vectors are **raw** (L2-normalised, uncentered). Centering is
 *      applied at comparison time so a later enrollment cannot invalidate an
 *      earlier voiceprint.
 *   2. The cohort is a **list of contributions**, not one aggregate sum. Float
 *      addition is not associative, so erasing a contribution exactly requires
 *      deleting it and re-deriving the mean — `(s1+s2+s3) - s2 !== s1+s3`.
 *
 * See change: add-speaker-id-enrollment.
 */
import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Store schema version. A non-matching version loads as empty. */
const STORE_VERSION = 3;

/** Minimum embeddings in the cohort before its mean is trusted. */
export const MIN_COHORT = 40;

/** Env var overriding the default store path. */
export const STORE_ENV_VAR = "PI_VOICEPRINT_STORE";

/** Lock file older than this (ms) is considered stale and broken. */
const LOCK_STALENESS_MS = 30_000;

export interface Contribution {
  recordingId: string;
  /** Cluster tag within the recording (normalised label id). */
  speakerKey: string;
  /** Bound name when this contribution came from an enrolled subject. */
  name?: string;
  /** Full-precision sum of the contribution's L2-normalised vectors. */
  sum: number[];
  /** Number of embeddings folded into `sum`. */
  count: number;
  /** Total cue duration (seconds) this contribution covers. */
  duration: number;
  dim: number;
  model: string;
}

export interface Voiceprint {
  /** L2-normalised, **uncentered** average embedding. */
  vector: number[];
  dim: number;
  model: string;
  nSegments: number;
  enrollSeconds: number;
  coherence: number;
  sources: string[];
}

export interface Library {
  version: number;
  voiceprints: Record<string, Voiceprint>;
  contributions: Contribution[];
  /** Recording ids that have already contributed (dedup, not a tombstone). */
  contributedRecordings: string[];
}

export interface ModelMismatch {
  /** Voiceprint names built with a different dim or model name. */
  names: string[];
  /** Contributions built with a different dim or model name. */
  contributions: number;
}

// ------------------------------------------------------------------ vectors

/** L2-normalise; a zero vector is returned unchanged (never NaN). */
export function l2(v: ArrayLike<number>): Float32Array {
  const out = Float32Array.from(v);
  let norm = 0;
  for (let i = 0; i < out.length; i++) norm += out[i] * out[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

/** Cosine similarity; 0 when either vector is all-zero (never NaN). */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

/** Mean of a vector list, L2-normalised. Empty input yields a zero vector. */
export function centroid(vectors: ArrayLike<number>[]): Float32Array {
  if (vectors.length === 0) return new Float32Array(0);
  const dim = vectors[0].length;
  const sum = new Float64Array(dim);
  for (const v of vectors) for (let i = 0; i < dim; i++) sum[i] += v[i];
  for (let i = 0; i < dim; i++) sum[i] /= vectors.length;
  return l2(sum);
}

/**
 * Remove the shared channel/session direction. `mean === null` is a plain
 * normalisation; otherwise the mean is subtracted first.
 */
export function centre(v: ArrayLike<number>, mean: ArrayLike<number> | null): Float32Array {
  if (mean === null) return l2(v);
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] - mean[i];
  return l2(out);
}

// --------------------------------------------------------------- library IO

export function emptyLibrary(): Library {
  return { version: STORE_VERSION, voiceprints: {}, contributions: [], contributedRecordings: [] };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Load a library; absent or malformed input yields an empty library. */
export function loadLibrary(file: string): Library {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
      !isObject(parsed) ||
      parsed.version !== STORE_VERSION ||
      !isObject(parsed.voiceprints) ||
      !Array.isArray(parsed.contributions) ||
      !Array.isArray(parsed.contributedRecordings)
    ) {
      return emptyLibrary();
    }
    return parsed as unknown as Library;
  } catch {
    return emptyLibrary();
  }
}

/**
 * Write the library atomically: a uniquely named temp sibling then rename. A
 * concurrent writer cannot clobber another's temp, and a mid-write failure
 * leaves the previous file intact.
 */
export function saveLibrary(file: string, lib: Library): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(lib, null, 2));
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // ignore cleanup failure
    }
    throw err;
  }
}

/** True when the lock was acquired; throws on any non-EEXIST error. */
function tryAcquireLock(lock: string): boolean {
  try {
    fs.closeSync(fs.openSync(lock, "wx"));
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }
}

/** Age of the lock file in ms; 0 when it vanished or cannot be statted. */
function lockAgeMs(lock: string): number {
  try {
    return Date.now() - fs.statSync(lock).mtimeMs;
  } catch {
    return 0;
  }
}

function removeLock(lock: string): void {
  try {
    fs.rmSync(lock, { force: true });
  } catch {
    // ignore
  }
}

/**
 * Steal a stale lock atomically: rename it aside so at most one process can win
 * the steal. A plain unlink would let two processes both remove the lock and
 * each re-acquire it, losing an enrollment on the stale-lock path.
 */
function stealLock(lock: string): void {
  const stolen = `${lock}.stale.${process.pid}.${randomBytes(4).toString("hex")}`;
  try {
    fs.renameSync(lock, stolen);
    fs.rmSync(stolen, { force: true });
  } catch {
    // another process won the steal or the lock vanished — retry the loop
  }
}

/**
 * Run `fn` while holding an exclusive lock (`open(lock, 'wx')`). A lock older
 * than `stalenessMs` is broken and re-acquired. Profiling must happen outside
 * the critical section, so `fn` must contain only the read-modify-write.
 */
export async function withStoreLock<T>(
  file: string,
  fn: () => T | Promise<T>,
  stalenessMs: number = LOCK_STALENESS_MS,
): Promise<T> {
  const lock = `${file}.lock`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const deadline = Date.now() + stalenessMs * 4;
  for (;;) {
    if (tryAcquireLock(lock)) break;
    if (lockAgeMs(lock) > stalenessMs) {
      stealLock(lock);
      continue;
    }
    if (Date.now() > deadline) throw new Error(`timed out acquiring store lock: ${lock}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  try {
    return await fn();
  } finally {
    removeLock(lock);
  }
}

/** Default store path: `<home>/.pi/voiceprints/voiceprints.json`. */
export function defaultStorePath(home: string = os.homedir()): string {
  return path.join(home, ".pi", "voiceprints", "voiceprints.json");
}

/** Resolve the store path: explicit flag, then env var, then the default. */
export function resolveStorePath(
  flag?: string,
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): string {
  return flag?.trim() || env[STORE_ENV_VAR]?.trim() || defaultStorePath(home);
}

// ---------------------------------------------------------------- recording

const RECORDING_CHUNK = 1024 * 1024;

/**
 * Content-derived recording identity: SHA-256 of the first and last 1 MiB plus
 * the byte length. A renamed or re-transcribed copy keeps the same id, so the
 * cohort cannot double-count one recording.
 */
export function recordingId(file: string): string {
  const size = fs.statSync(file).size;
  const window = Math.min(RECORDING_CHUNK, size);
  const first = Buffer.alloc(window);
  const last = Buffer.alloc(window);
  const fd = fs.openSync(file, "r");
  try {
    if (window > 0) {
      fs.readSync(fd, first, 0, window, 0);
      fs.readSync(fd, last, 0, window, size - window);
    }
  } finally {
    fs.closeSync(fd);
  }
  const hash = createHash("sha256");
  hash.update(first);
  hash.update(last);
  hash.update(String(size));
  return hash.digest("hex");
}

// ------------------------------------------------------------------- cohort

function byStableOrder(a: Contribution, b: Contribution): number {
  if (a.recordingId !== b.recordingId) return a.recordingId < b.recordingId ? -1 : 1;
  if (a.speakerKey !== b.speakerKey) return a.speakerKey < b.speakerKey ? -1 : 1;
  return 0;
}

/**
 * Derive the cohort mean, summing contributions in a defined stable order
 * (`recordingId`, then `speakerKey`) so the result never depends on storage
 * order. Returns null below `MIN_COHORT` or when there is nothing to average.
 */
export function cohortMean(lib: Library): Float32Array | null {
  const total = lib.contributions.reduce((n, c) => n + c.count, 0);
  if (total < MIN_COHORT) return null;
  const sorted = [...lib.contributions].sort(byStableOrder);
  const dim = sorted[0].dim;
  const sum = new Float64Array(dim);
  for (const c of sorted) for (let i = 0; i < dim; i++) sum[i] += c.sum[i];
  for (let i = 0; i < dim; i++) sum[i] /= total;
  return Float32Array.from(sum);
}

/** Total embeddings currently in the cohort. */
export function cohortCount(lib: Library): number {
  return lib.contributions.reduce((n, c) => n + c.count, 0);
}

/** Build a contribution from a cluster's L2-normalised vectors. */
export function makeContribution(
  recordingIdValue: string,
  speakerKey: string,
  vectors: ArrayLike<number>[],
  duration: number,
  model: string,
  name?: string,
): Contribution {
  const dim = vectors[0].length;
  const sum = new Array<number>(dim).fill(0);
  for (const v of vectors) for (let i = 0; i < dim; i++) sum[i] += v[i];
  return {
    recordingId: recordingIdValue,
    speakerKey,
    ...(name ? { name } : {}),
    sum,
    count: vectors.length,
    duration,
    dim,
    model,
  };
}

/** Voiceprints and contributions whose model/dim disagree with the active one. */
export function modelMismatches(lib: Library, dim: number, model: string): ModelMismatch {
  const names = Object.entries(lib.voiceprints)
    .filter(([, vp]) => vp.dim !== dim || vp.model !== model)
    .map(([name]) => name);
  const contributions = lib.contributions.filter(
    (c) => c.dim !== dim || c.model !== model,
  ).length;
  return { names, contributions };
}

/**
 * Add a recording's contributions exactly once. Refuses a mixed-model cohort
 * rather than resetting it; a re-contribution from an already-seen recording is
 * ignored (dedup, not a tombstone).
 */
export function addRecordingContributions(
  lib: Library,
  recordingIdValue: string,
  contributions: Contribution[],
): void {
  if (contributions.length === 0) return;
  if (lib.contributedRecordings.includes(recordingIdValue)) return;
  const mismatch = lib.contributions.find(
    (c) => c.dim !== contributions[0].dim || c.model !== contributions[0].model,
  );
  if (mismatch) {
    throw new Error(
      `refusing to mix embedding models: cohort holds ${mismatch.dim}-dim ` +
        `'${mismatch.model}', incoming is ${contributions[0].dim}-dim ` +
        `'${contributions[0].model}'. Re-enroll or forget the old contributions.`,
    );
  }
  lib.contributions.push(...contributions);
  lib.contributedRecordings.push(recordingIdValue);
}

// -------------------------------------------------------------- voiceprints

/**
 * Merge a fresh enrollment into an existing voiceprint as a segment-count
 * weighted average, appending the source recording. With `replace`, the
 * previous vector is discarded and sources reset.
 */
export function mergeVoiceprint(
  existing: Voiceprint | undefined,
  freshVector: ArrayLike<number>,
  freshSegments: number,
  source: string,
  meta: { dim: number; model: string; enrollSeconds: number; coherence: number },
  replace = false,
): Voiceprint {
  if (!existing || replace) {
    return {
      vector: Array.from(l2(freshVector)),
      dim: meta.dim,
      model: meta.model,
      nSegments: freshSegments,
      enrollSeconds: meta.enrollSeconds,
      coherence: meta.coherence,
      sources: [source],
    };
  }
  const old = l2(existing.vector);
  const fresh = l2(freshVector);
  const wOld = existing.nSegments;
  const wNew = freshSegments;
  const blended = new Float32Array(old.length);
  for (let i = 0; i < old.length; i++) {
    blended[i] = (old[i] * wOld + fresh[i] * wNew) / (wOld + wNew);
  }
  return {
    ...existing,
    vector: Array.from(l2(blended)),
    nSegments: wOld + wNew,
    enrollSeconds: existing.enrollSeconds + meta.enrollSeconds,
    coherence: meta.coherence,
    sources: [...existing.sources, source],
    // dim/model are unchanged: a merge only happens under an agreeing model.
  };
}

// ------------------------------------------------------------------ erasure

/** Forget a name: drop its voiceprint and the cohort contributions bound to it. */
export function forgetByName(lib: Library, name: string): void {
  delete lib.voiceprints[name];
  lib.contributions = lib.contributions.filter((c) => c.name !== name);
}

/**
 * Forget a whole recording: drop its contributions and clear it from the
 * contributed set so it may contribute again.
 */
export function forgetRecording(lib: Library, recordingIdValue: string): void {
  lib.contributions = lib.contributions.filter((c) => c.recordingId !== recordingIdValue);
  lib.contributedRecordings = lib.contributedRecordings.filter((r) => r !== recordingIdValue);
}
