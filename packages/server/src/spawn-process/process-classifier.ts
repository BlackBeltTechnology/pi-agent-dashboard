/**
 * Pure process classifier. Enriches each scanned `process_list` entry with a
 * `kind`, a human-readable `label`, and (for sub-sessions) a `sessionRef`,
 * by cross-referencing the entry's `pid`/`command` against a `pidIndex`
 * built from currently connected sessions.
 *
 * Server-side because only the server holds the global `pid → session`
 * index needed to name `sub-session` rows. No side effects; safe to unit
 * test in isolation. See change: classify-process-list-entries.
 */
import type { ProcessKind } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/** A scanned process entry as received from the bridge. */
export interface RawProcessEntry {
  pid: number;
  pgid: number;
  command: string;
  elapsedMs: number;
}

/** A classified process entry forwarded to browsers. */
export interface ClassifiedProcessEntry extends RawProcessEntry {
  kind: ProcessKind;
  label: string;
  sessionRef?: string;
}

/** Per-pid session info used to name `sub-session` rows. */
export interface PidIndexEntry {
  sessionId: string;
  name?: string;
  model?: string;
}

export type PidIndex = Map<number, PidIndexEntry>;

/**
 * Build a `pid → session` index from connected sessions only. A session
 * contributes iff it is not ended and carries a numeric `pid`. Restricting
 * to live sessions avoids pid-reuse mislinks against dead sessions.
 */
export function buildPidIndex(sessions: readonly DashboardSession[]): PidIndex {
  const index: PidIndex = new Map();
  for (const s of sessions) {
    if (s.status === "ended") continue;
    if (typeof s.pid !== "number") continue;
    index.set(s.pid, { sessionId: s.id, name: s.name, model: s.model });
  }
  return index;
}

/** Basename of the first whitespace-delimited token of a command. */
function commandBasename(command: string): string {
  const first = command.trim().split(/\s+/)[0] ?? "";
  return first.split("/").pop() ?? "";
}

/**
 * Extract a plugin name from a pi-agent plugin path of the form
 * `…/.pi/agent/**\/<name>/<file>` (e.g.
 * `bun /Users/x/.pi/agent/npm/node_modules/context-mode/server.bundle.mjs`
 * → `context-mode`). Returns `undefined` when the command is not a plugin
 * path.
 */
function extractPluginName(command: string): string | undefined {
  const match = command.match(/\.pi\/agent\/.*\/([^/\s]+)\/[^/\s]+$/);
  return match ? match[1] : undefined;
}

/** Classify a single entry. Non-destructive: original fields preserved. */
function classifyOne(entry: RawProcessEntry, pidIndex: PidIndex): ClassifiedProcessEntry {
  const base: RawProcessEntry = {
    pid: entry.pid,
    pgid: entry.pgid,
    command: entry.command,
    elapsedMs: entry.elapsedMs,
  };

  if (commandBasename(entry.command) === "pi") {
    const session = pidIndex.get(entry.pid);
    if (session) {
      return {
        ...base,
        kind: "sub-session",
        label: session.name || session.model || "pi session",
        sessionRef: session.sessionId,
      };
    }
    return { ...base, kind: "pi-worker", label: "pi worker" };
  }

  const pluginName = extractPluginName(entry.command);
  if (pluginName) {
    return { ...base, kind: "plugin", label: pluginName };
  }

  return { ...base, kind: "task", label: entry.command };
}

/**
 * Classify a list of scanned processes. Pure function of `(processes,
 * pidIndex)`. Order preserved.
 */
export function classifyProcesses(
  processes: readonly RawProcessEntry[],
  pidIndex: PidIndex,
): ClassifiedProcessEntry[] {
  return processes.map((p) => classifyOne(p, pidIndex));
}
