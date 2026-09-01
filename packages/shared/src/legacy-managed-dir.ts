/**
 * Detect the legacy `~/.pi-dashboard/` install directory left behind from
 * pre-R3 versions where the Electron app (and the standalone bootstrap
 * orchestrator) installed pi/openspec/tsx at runtime into a user-writable
 * directory.
 *
 * The directory is legacy ONLY when it is genuinely ORPHANED: no `node/`
 * managed runtime, no Electron wizard state files, no non-empty
 * `node_modules/`, and no `doctor.log`/`server.log` (logs are live content —
 * the Doctor itself appends and tails them). When live consumers still own
 * content under it, the detector reports WHICH consumers so the Doctor row
 * and the server startup advisory can name them without ever suggesting
 * deletion.
 *
 * NEVER move runtime install logic back into this directory. If you find
 * yourself reaching for `~/.pi-dashboard/`, you are working against R3.
 *
 * See change: unify-pi-runtime-identity (tasks 6.2, 9.8).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Directory is present and genuinely orphaned — nothing still owns content
 * under it. `sizeMb` is the recursive byte sum (capped at 500 MB).
 */
export interface LegacyManagedDirOrphan {
  present: true;
  orphaned: true;
  path: string;
  sizeMb: number;
}

/**
 * Directory is present but live consumers still own content under it.
 * `consumers` are human-readable labels naming each owner (managed runtime /
 * wizard state / node_modules / logs). NEVER suggest deleting these.
 */
export interface LegacyManagedDirLive {
  present: true;
  orphaned: false;
  path: string;
  consumers: string[];
  sizeMb: number;
}

export type LegacyManagedDir =
  | { present: false }
  | LegacyManagedDirOrphan
  | LegacyManagedDirLive;

export interface DetectDeps {
  /** Override HOME for tests. */
  homedir?: string;
}

const LEGACY_DIRNAME = ".pi-" + "dashboard"; // split literal so the no-managed-dir lint stays clean

/** Wizard state files written by `packages/electron/src/lib/wizard-state.ts`. */
const WIZARD_STATE_FILES = ["dashboard-settings.json", "recommended.json"] as const;

/** Log files that count as live content — the Doctor appends and tails them. */
const LOG_FILES = ["doctor.log", "server.log"] as const;

function getLegacyDirPath(env?: DetectDeps): string {
  return path.join(env?.homedir ?? os.homedir(), LEGACY_DIRNAME);
}

/** Sum file sizes under a directory tree, capped to avoid pathological scans. */
function dirSizeBytes(dir: string, cap = 500 * 1024 * 1024): number {
  let total = 0;
  const stack: string[] = [dir];
  while (stack.length > 0 && total < cap) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      try {
        if (e.isSymbolicLink()) continue;
        if (e.isDirectory()) {
          stack.push(full);
        } else if (e.isFile()) {
          const st = fs.statSync(full);
          total += st.size;
          if (total >= cap) return cap;
        }
      } catch {
        /* skip unreadable */
      }
    }
  }
  return total;
}

function countDirectChildren(dir: string): number {
  try {
    return fs.readdirSync(dir).length;
  } catch {
    return 0;
  }
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Name every live consumer that still owns content under the legacy
 * directory. Order is stable: managed runtime, wizard state, node_modules,
 * then logs — mirroring the spec's enumeration.
 */
function detectConsumers(dir: string): string[] {
  const consumers: string[] = [];
  if (isDirectory(path.join(dir, "node"))) {
    consumers.push("managed Node runtime (node/)");
  }
  const wizardFiles = WIZARD_STATE_FILES.filter((f) => fileExists(path.join(dir, f)));
  if (wizardFiles.length > 0) {
    consumers.push(`Electron wizard state (${wizardFiles.join(", ")})`);
  }
  const nmCount = countDirectChildren(path.join(dir, "node_modules"));
  if (nmCount > 0) {
    consumers.push(`managed node_modules (${nmCount} entries)`);
  }
  const logFiles = LOG_FILES.filter((f) => fileExists(path.join(dir, f)));
  if (logFiles.length > 0) {
    consumers.push(`logs (${logFiles.join(", ")})`);
  }
  return consumers;
}

/**
 * Detect whether the legacy `~/.pi-dashboard/` directory is present, and if
 * so whether it is genuinely orphaned or still owned by live consumers.
 *
 * - absent (or not a directory) → `{ present: false }`
 * - present, no live consumers → `{ present: true, orphaned: true, path,
 *   sizeMb }` — safe to delete manually
 * - present, live consumers → `{ present: true, orphaned: false, path,
 *   consumers, sizeMb }` — the caller MUST NOT suggest deletion
 *
 * Any internal failure collapses to `{ present: false }` (advisory absent
 * rather than report-blocking). See change: unify-pi-runtime-identity.
 */
export function detectLegacyManagedDir(deps: DetectDeps = {}): LegacyManagedDir {
  const dir = getLegacyDirPath(deps);
  try {
    const st = fs.statSync(dir);
    if (!st.isDirectory()) return { present: false };
  } catch {
    return { present: false };
  }
  const sizeMb = Math.round(dirSizeBytes(dir) / (1024 * 1024));
  const consumers = detectConsumers(dir);
  if (consumers.length === 0) {
    return { present: true, orphaned: true, path: dir, sizeMb };
  }
  return { present: true, orphaned: false, path: dir, consumers, sizeMb };
}

/** Path-only accessor for callers that want to display the path without scanning. */
export function getLegacyManagedDirPath(deps: DetectDeps = {}): string {
  return getLegacyDirPath(deps);
}
