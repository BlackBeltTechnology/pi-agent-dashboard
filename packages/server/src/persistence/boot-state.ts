/**
 * Durable, HOME-scoped boot record: `~/.pi/dashboard/boot-state.json`.
 *
 * One O(1) atomic write per exit — NOT one per session. That is the whole
 * point: the exit paths that matter (`/api/restart`, `/api/shutdown`, a
 * signal handler) have ~100 ms and cannot walk N sidecars on the way out,
 * which is exactly why the old per-session cleanup never ran on them.
 *
 * Lifecycle within one process:
 *   startup   → `stampBootStart(liveEpoch)`  (prior boot rolls into the ring)
 *   exit path → `recordExitIntent(intent)`   (write-once; first writer wins)
 *   classify  → `resolveExitIntent(liveEpoch)` against current + ring
 *
 * Every write is best-effort: a failure is logged and swallowed, leaving the
 * intent unrecorded — which reads as a dirty boot and over-offers rather than
 * under-offers. See change: fix-recovery-exit-intent (D1).
 */
import path from "node:path";
import {
  BOOT_RING_SIZE,
  type BootRecord,
  type BootState,
  type ExitIntent,
} from "@blackbelt-technology/pi-dashboard-shared/boot-state.js";
import { getDashboardConfigDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import { readJsonFile, writeJsonFile } from "./json-store.js";

/** Resolved per call — tests re-root HOME per file. */
function bootStatePath(): string {
  return path.join(getDashboardConfigDir(), "boot-state.json");
}

/** This process's boot id, set by `stampBootStart`. */
let currentBootId: number | undefined;
/** Write-once latch for the current boot. */
let intentRecorded = false;
/**
 * The state as of the last write by this process. The ring is immutable for
 * the lifetime of a boot, so classification (once per restored session) reads
 * this instead of re-reading the file N times.
 */
let cached: BootState | undefined;

function isBootRecord(v: unknown): v is BootRecord {
  const r = v as BootRecord | undefined;
  return !!r && typeof r.bootId === "number" && Number.isFinite(r.bootId);
}

/** Read + shape-validate the record. Absent / corrupt / foreign ⇒ `undefined`. */
export function readBootState(): BootState | undefined {
  const raw = readJsonFile<unknown>(bootStatePath(), undefined);
  if (!isBootRecord(raw)) return undefined;
  const state = raw as BootState;
  return {
    bootId: state.bootId,
    exitIntent: state.exitIntent ?? null,
    at: typeof state.at === "number" ? state.at : 0,
    ring: Array.isArray(state.ring) ? state.ring.filter(isBootRecord).slice(0, BOOT_RING_SIZE) : [],
  };
}

function write(state: BootState): void {
  cached = state;
  try {
    writeJsonFile(bootStatePath(), state);
  } catch (err) {
    // Never fatal — an unwritten intent degrades to "dirty boot" (over-offer),
    // the conservative direction. See design Risks.
    console.warn("[boot-state] write failed (recovery may over-offer):", err);
  }
}

/**
 * Open a new boot: roll the previous record into the ring and stamp
 * `{ bootId, exitIntent: null }`. Must run BEFORE classification, so a
 * session's `liveEpoch` can be resolved against the ring.
 */
export function stampBootStart(bootId: number): void {
  currentBootId = bootId;
  intentRecorded = false;
  const prior = readBootState();
  const ring = prior
    ? [{ bootId: prior.bootId, exitIntent: prior.exitIntent, at: prior.at }, ...prior.ring]
      .slice(0, BOOT_RING_SIZE)
    : [];
  write({ bootId, exitIntent: null, at: Date.now(), ring });
}

/**
 * Record how this boot is ending. Write-once per boot: the first writer wins,
 * so `restart`'s SIGTERM→SIGKILL ladder cannot let a late `signal` overwrite
 * the `restart` that was already announced.
 */
export function recordExitIntent(intent: ExitIntent): void {
  if (intentRecorded || currentBootId === undefined) return;
  intentRecorded = true;
  const onDisk = readBootState();
  // Another writer (this boot, earlier in the exit) already claimed it.
  if (onDisk?.bootId === currentBootId && onDisk.exitIntent != null) return;
  write({
    bootId: currentBootId,
    exitIntent: intent,
    at: Date.now(),
    ring: onDisk?.ring ?? cached?.ring ?? [],
  });
  console.info(`[boot-state] exit intent recorded: ${intent} (boot ${currentBootId})`);
}

/**
 * Which intent ended the boot that owned `liveEpoch`? `null` when the boot is
 * unresolvable — no record, a sidecar older than the ring, or a pre-feature
 * sidecar with no epoch at all — which the caller treats as recovery-allowed.
 */
export function resolveExitIntent(liveEpoch: number | undefined): ExitIntent | null {
  if (liveEpoch === undefined) return null;
  const state = cached ?? readBootState();
  if (!state) return null;
  if (state.bootId === liveEpoch) return state.exitIntent;
  return state.ring.find((r) => r.bootId === liveEpoch)?.exitIntent ?? null;
}

/** Test seam: drop the in-process boot latch + cache. */
export function _resetBootStateForTests(): void {
  currentBootId = undefined;
  intentRecorded = false;
  cached = undefined;
}
