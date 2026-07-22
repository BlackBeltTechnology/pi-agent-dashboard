/**
 * Bounded pid-child-tree + CPU liveness probe.
 *
 * `process-classifier` classifies a bridge-provided `process_list` but carries
 * no CPU field and does not walk the pid tree (D4 correction). This probe adds
 * exactly that: given a session's root `pi` pid it returns whether the tree has
 * a live child and the aggregate CPU% — serving BOTH the quiescence gate's
 * "no live child" condition (gear 1) AND phantom detection's "~0 CPU" condition
 * (gear 3).
 *
 * The tree-walk + CPU-sum is a pure function (`summarizeProcessTree`) over
 * parsed `ps` rows, unit-testable without spawning anything. The default
 * implementation shells out to `ps` (posix) with a hard timeout; on any failure
 * it returns `{ ok: false }` so the reaper can map an unknown result to the
 * SAFE direction (never force-reap on unknown CPU; never idle-reap on unknown
 * children).
 *
 * See OpenSpec change: add-embed-session-lifecycle.
 */
import { execFileAsync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";

export interface LivenessSnapshot {
  /** False when the probe could not be taken (ps failed / unsupported). */
  ok: boolean;
  /** Count of descendant processes of the root pid (excluding the root). */
  childCount: number;
  /** Aggregate CPU% across the root pid's tree (0 when wedged/idle). */
  cpuPercent: number;
}

/** Probe a session's pi process tree by its root pid. */
export type LivenessProbe = (rootPid: number) => Promise<LivenessSnapshot>;

/** One parsed `ps` row: a process, its parent, and its instantaneous CPU%. */
export interface PsRow {
  pid: number;
  ppid: number;
  cpu: number;
}

/**
 * Pure tree summariser: BFS the descendants of `rootPid` over the parsed rows,
 * counting children and summing CPU% across the root and every descendant.
 */
export function summarizeProcessTree(rows: readonly PsRow[], rootPid: number): LivenessSnapshot {
  const byParent = new Map<number, PsRow[]>();
  const byPid = new Map<number, PsRow>();
  for (const r of rows) {
    byPid.set(r.pid, r);
    const siblings = byParent.get(r.ppid) ?? [];
    siblings.push(r);
    byParent.set(r.ppid, siblings);
  }

  const root = byPid.get(rootPid);
  if (!root) return { ok: true, childCount: 0, cpuPercent: 0 };

  let cpuPercent = root.cpu;
  let childCount = 0;
  const queue = [rootPid];
  const seen = new Set<number>([rootPid]);
  while (queue.length > 0) {
    const pid = queue.shift() as number;
    for (const child of byParent.get(pid) ?? []) {
      if (seen.has(child.pid)) continue; // guard against pid-cycle edge cases
      seen.add(child.pid);
      childCount += 1;
      cpuPercent += child.cpu;
      queue.push(child.pid);
    }
  }
  return { ok: true, childCount, cpuPercent };
}

/** Parse `ps -o pid=,ppid=,pcpu=` whitespace-columned output into rows. */
export function parsePsOutput(output: string): PsRow[] {
  const rows: PsRow[] = [];
  for (const line of output.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const pid = Number.parseInt(parts[0], 10);
    const ppid = Number.parseInt(parts[1], 10);
    const cpu = Number.parseFloat(parts[2]);
    if (Number.isFinite(pid) && Number.isFinite(ppid)) {
      rows.push({ pid, ppid, cpu: Number.isFinite(cpu) ? cpu : 0 });
    }
  }
  return rows;
}

export interface LivenessProbeOptions {
  /** Hard timeout for the `ps` call. */
  timeoutMs?: number;
  /** Injectable `ps` runner (tests / non-posix). Returns raw stdout. */
  runPs?: () => Promise<string>;
}

/**
 * Default posix liveness probe. Shells out to `ps` once, parses, and summarises
 * the root pid's tree. Never throws — returns `{ ok: false }` on any failure so
 * the caller maps an unknown result to the safe direction.
 */
export function createLivenessProbe(options: LivenessProbeOptions = {}): LivenessProbe {
  const timeoutMs = options.timeoutMs ?? 2000;
  const runPs =
    options.runPs ??
    (async () => {
      const { stdout } = await execFileAsync("ps", ["-eo", "pid=,ppid=,pcpu="], {
        timeout: timeoutMs,
        encoding: "utf-8",
      });
      return typeof stdout === "string" ? stdout : stdout.toString("utf-8");
    });

  return async (rootPid: number): Promise<LivenessSnapshot> => {
    try {
      const rows = parsePsOutput(await runPs());
      return summarizeProcessTree(rows, rootPid);
    } catch {
      return { ok: false, childCount: 0, cpuPercent: 0 };
    }
  };
}
