/**
 * Browser-safe types for the dashboard-trust → pi mirror (no Node imports).
 * See change: mirror-dashboard-trust-to-pi.
 */

/** Durable trust source ids (mirrors `PiTrustMirrorSourceId` in config). */
export type MirrorSourceKind = "worktreeInit" | "workflow" | "pinned" | "folderWorkspaces" | "accessGrants";

/** Why an entry does not confer pi trust (Access page + bridge log vocabulary). */
export type MirrorIgnoreReason =
  | "forbidden-folder"
  | "not-project-root"
  | "hook-changed"
  | "source-off"
  | "source-not-installed"
  | "identity-mismatch"
  | "choice-unreadable";

/** Every reason code the bridge may log when it withholds trust. */
export type MirrorWithheldReason =
  | MirrorIgnoreReason
  | "recorded-entry"
  | "store-unreadable"
  | "not-covered-session";

/** Readable label per ignore reason (Access page). */
export const MIRROR_REASON_LABELS: Record<MirrorIgnoreReason, string> = {
  "forbidden-folder": "folder never mirrored (home, system, temp, secrets)",
  "not-project-root": "not a project root (no .git or .pi)",
  "hook-changed": "hook changed — re-approve",
  "source-off": "source or entry opted out",
  "source-not-installed": "source not installed",
  "identity-mismatch": "folder changed since it was trusted",
  "choice-unreadable": "per-entry choices unreadable",
};

/** One durable entry in `~/.pi/dashboard/pi-trust-mirror.json`. */
export interface PiTrustSnapshotEntry {
  /** Canonical folder path in pi's trust-store key form. */
  key: string;
  sourceKind: MirrorSourceKind;
  /** Device / inode as decimal strings (bigint-safe). */
  dev: string;
  ino: string;
  /** Only when the filesystem reported one distinct from ctime at write time. */
  birthtimeMs?: number;
  /** worktreeInit/workflow: the configuration root whose hook is re-hashed. */
  configRoot?: string;
  hookHash?: string;
}

export interface PiTrustSnapshot {
  version: 1;
  /** Strictly increases on every rewrite. */
  generation: number;
  entries: PiTrustSnapshotEntry[];
}
