/**
 * Browser-safe types for the dashboard-trust → pi mirror (no Node imports).
 * See change: mirror-dashboard-trust-to-pi.
 */

/**
 * Trust source ids (mirrors `PiTrustMirrorSourceId` in config). `yolo` is
 * live-only: it never appears in the snapshot.
 */
export type MirrorSourceKind = "worktreeInit" | "workflow" | "pinned" | "folderWorkspaces" | "accessGrants" | "yolo";

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
  | "not-covered-session"
  | "identity-weak"
  | "live-timeout"
  | "live-unreachable"
  | "live-refused"
  | "live-unsupported"
  | "live-rate-limited"
  | "live-not-covered"
  | "live-error";

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

/** Readable label per bridge reason code (Access page legend; a code from a bridge log can be looked up). */
export const MIRROR_WITHHELD_LABELS: Record<MirrorWithheldReason, string> = {
  ...MIRROR_REASON_LABELS,
  "recorded-entry": "pi already has a recorded decision for this folder",
  "store-unreadable": "pi's trust store could not be read",
  "not-covered-session": "dashboard trust does not cover this session kind",
  "identity-weak": "folder proof unavailable (empty, symlinked, referenced code outside it, or too large)",
  "live-timeout": "live query did not finish within the time budget",
  "live-unreachable": "dashboard server could not be reached",
  "live-refused": "dashboard server refused the live query",
  "live-unsupported": "dashboard server does not offer the live query",
  "live-rate-limited": "dashboard server rate-limited the live query",
  "live-not-covered": "dashboard server does not trust this folder right now",
  "live-error": "live query failed or returned an unusable answer",
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
  /**
   * How many server-lifetime (live) entries count right now. A count only —
   * never a path or identity (live trust is memory-only). Readers treat a
   * missing or invalid value as 0.
   */
  liveCount: number;
}
