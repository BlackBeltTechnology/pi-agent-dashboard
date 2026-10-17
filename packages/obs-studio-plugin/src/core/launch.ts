/**
 * `pi-obs launch` — the managed service's start command (design D5, spike F2/F3).
 *
 * OBS 32 removed `--disable-shutdown-check`, so a leftover `.sentinel/run_*`
 * makes the next launch block on the safe-mode prompt. This wrapper moves
 * stale sentinels aside ONLY when no OBS process exists, bounded by a strike
 * rule so a genuine crash loop still reaches safe mode:
 *   - sentinels younger than 60 s are ignored (strikes unchanged);
 *   - a leftover is judged from the NEWEST OBS log: unload-phase lines →
 *     teardown crash (stop / quit) → strikes reset; no unload lines and log
 *     mtime − lastLaunchAt < 10 min → early mid-run crash → strike + 1;
 *     otherwise reset;
 *   - strikes ≥ 2 → `suspended` (cleared ONLY by `--reset-recovery`): no
 *     sentinel is moved, OBS shows its prompt, the service reaches `blocked`;
 *   - a corrupt state file fails safe (rewritten `suspended: true`).
 * State is written atomically BEFORE spawning. After quarantining, the process
 * is re-checked: an OBS that appeared meanwhile is never doubled, and the
 * quarantined files stay quarantined. Quarantine keeps the 10 newest batches.
 * See change: add-obs-studio-plugin.
 */
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "./instances.js";
import { ensureStateDir, logsDir, sentinelDir } from "./paths.js";

const SENTINEL_MIN_AGE_MS = 60_000;
const EARLY_CRASH_MS = 10 * 60_000;
const STRIKE_LIMIT = 2;
const QUARANTINE_KEEP = 10;

/** Unload-phase markers of a teardown (spike F2). */
const UNLOAD_MARKERS = ["plugin unloaded", "obs_module_unload"];

export interface LaunchState {
  lastLaunchAt?: number;
  strikes: number;
  suspended: boolean;
}

export function launchStateFile(state: string): string {
  return path.join(state, "launch-state.json");
}

export function quarantineDir(state: string): string {
  return path.join(state, "sentinel-quarantine");
}

/** Read the recovery state; `corrupt` when the file exists but cannot be parsed. */
export function readLaunchState(state: string): { state: LaunchState; corrupt: boolean } {
  let raw: string;
  try {
    raw = fs.readFileSync(launchStateFile(state), "utf8");
  } catch {
    return { state: { strikes: 0, suspended: false }, corrupt: false };
  }
  try {
    const v = JSON.parse(raw) as Partial<LaunchState>;
    if (typeof v !== "object" || v === null || typeof v.strikes !== "number" || typeof v.suspended !== "boolean") throw new Error("shape");
    return { state: { strikes: v.strikes, suspended: v.suspended, ...(typeof v.lastLaunchAt === "number" ? { lastLaunchAt: v.lastLaunchAt } : {}) }, corrupt: false };
  } catch {
    return { state: { strikes: 0, suspended: true }, corrupt: true };
  }
}

function writeLaunchState(state: string, s: LaunchState): void {
  ensureStateDir(state);
  writeJsonAtomic(launchStateFile(state), s);
}

/** Newest file in `<config>/logs/`, or undefined. */
export function newestLog(configDir: string): { file: string; mtimeMs: number } | undefined {
  const dir = logsDir(configDir);
  let best: { file: string; mtimeMs: number } | undefined;
  for (const name of safeReaddir(dir)) {
    const file = path.join(dir, name);
    try {
      const st = fs.statSync(file);
      if (st.isFile() && (!best || st.mtimeMs > best.mtimeMs)) best = { file, mtimeMs: st.mtimeMs };
    } catch {
      /* vanished */
    }
  }
  return best;
}

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

type LaunchVerdict = "no-leftover" | "young-only" | "teardown-crash" | "early-crash" | "late-crash";

/** How did the previous run end? Pure apart from reading the newest log. */
function judgeLeftover(configDir: string, leftovers: number, young: number, lastLaunchAt: number | undefined): LaunchVerdict {
  if (leftovers === 0) return young > 0 ? "young-only" : "no-leftover";
  const log = newestLog(configDir);
  if (log) {
    let text = "";
    try {
      text = fs.readFileSync(log.file, "utf8");
    } catch {
      /* unreadable → treated as no unload lines */
    }
    if (UNLOAD_MARKERS.some((m) => text.includes(m))) return "teardown-crash";
    if (lastLaunchAt !== undefined && log.mtimeMs - lastLaunchAt < EARLY_CRASH_MS) return "early-crash";
  }
  return "late-crash";
}

export interface LaunchDeps {
  state: string;
  configDir: string;
  now: () => number;
  /** Pids of running OBS processes (exact-basename matcher). */
  findObs: () => Promise<number[]>;
  /** Detached spawn of OBS; resolves once started. */
  spawnObs: () => Promise<void>;
  log?: (line: string) => void;
}

export interface LaunchResult {
  action: "already-running" | "launched" | "appeared";
  verdict?: LaunchVerdict;
  recoverySuspended: boolean;
  quarantined: number;
  corruptState?: boolean;
}

export async function resetRecovery(state: string): Promise<LaunchState> {
  const { state: s } = readLaunchState(state);
  const next: LaunchState = { strikes: 0, suspended: false, ...(s.lastLaunchAt !== undefined ? { lastLaunchAt: s.lastLaunchAt } : {}) };
  writeLaunchState(state, next);
  return next;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ordered recovery steps from design D5 with distinct early returns
export async function launch(d: LaunchDeps): Promise<LaunchResult> {
  const log = d.log ?? (() => {});
  if ((await d.findObs()).length > 0) {
    const { state: s, corrupt } = readLaunchState(d.state);
    return { action: "already-running", recoverySuspended: s.suspended || corrupt, quarantined: 0 };
  }
  const { state: prev, corrupt } = readLaunchState(d.state);
  const now = d.now();
  const dir = sentinelDir(d.configDir);
  const sentinels = safeReaddir(dir).filter((n) => n.startsWith("run_"));
  const old: string[] = [];
  let young = 0;
  for (const n of sentinels) {
    try {
      const age = now - fs.statSync(path.join(dir, n)).mtimeMs;
      if (age < SENTINEL_MIN_AGE_MS) young++;
      else old.push(n);
    } catch {
      /* vanished */
    }
  }

  if (corrupt || prev.suspended) {
    // Suspended (or unreadable record → fail safe): clear nothing, let OBS prompt.
    writeLaunchState(d.state, { strikes: prev.strikes, suspended: true, lastLaunchAt: now });
    log(`[pi-obs] launch: recovery-suspended${corrupt ? " (launch-state.json was unreadable)" : ""}; sentinels left in place`);
    await d.spawnObs();
    return { action: "launched", recoverySuspended: true, quarantined: 0, ...(corrupt ? { corruptState: true } : {}) };
  }

  const verdict = judgeLeftover(d.configDir, old.length, young, prev.lastLaunchAt);
  const strikes = verdict === "early-crash" ? prev.strikes + 1 : verdict === "young-only" ? prev.strikes : 0;
  if (strikes >= STRIKE_LIMIT) {
    writeLaunchState(d.state, { strikes, suspended: true, lastLaunchAt: now });
    log(`[pi-obs] launch: ${strikes} early crashes in a row → recovery-suspended; OBS will show its safe-mode prompt (reset: pi-obs launch --reset-recovery)`);
    await d.spawnObs();
    return { action: "launched", verdict, recoverySuspended: true, quarantined: 0 };
  }

  let quarantined = 0;
  if (old.length) {
    const batch = path.join(quarantineDir(d.state), String(now));
    fs.mkdirSync(batch, { recursive: true, mode: 0o700 });
    for (const n of old) {
      try {
        fs.renameSync(path.join(dir, n), path.join(batch, n));
        quarantined++;
      } catch {
        /* vanished: nothing to move */
      }
    }
    pruneQuarantine(d.state);
  }

  if ((await d.findObs()).length > 0) {
    writeLaunchState(d.state, { strikes, suspended: false, ...(prev.lastLaunchAt !== undefined ? { lastLaunchAt: prev.lastLaunchAt } : {}) });
    log("[pi-obs] launch: OBS appeared during recovery; not launching a second instance");
    return { action: "appeared", verdict, recoverySuspended: false, quarantined };
  }

  writeLaunchState(d.state, { strikes, suspended: false, lastLaunchAt: now });
  log(`[pi-obs] launch: ${verdict}, ${quarantined} sentinel(s) quarantined, strikes=${strikes}`);
  await d.spawnObs();
  return { action: "launched", verdict, recoverySuspended: false, quarantined };
}

/** Keep the newest `QUARANTINE_KEEP` batches (batch dir names are epoch ms). */
function pruneQuarantine(state: string): void {
  const root = quarantineDir(state);
  const batches = safeReaddir(root)
    .filter((n) => /^\d+$/.test(n))
    .sort((a, b) => Number(b) - Number(a));
  for (const n of batches.slice(QUARANTINE_KEEP)) fs.rmSync(path.join(root, n), { recursive: true, force: true });
}
