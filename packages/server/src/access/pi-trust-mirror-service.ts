/**
 * Dashboard trust → pi `project_trust` mirror: the server side.
 *
 * Derives the DURABLE trust entries from the persisted source stores (worktree-init
 * hook trust, pinned folders, folder-workspaces, persisted access grants — the
 * workflow source is a slot until `add-project-workflows` lands), applies the
 * shared filter (deny rules, source switches, per-entry choices, hook/project-root
 * facts), and writes the snapshot the bridge decides from at `project_trust` time.
 *
 * Ordering invariants (design D4):
 *   - revoke: rewrite the snapshot WITHOUT the entry first, then write the source
 *     store; success only when both complete (a crash in between heals at boot).
 *   - grant: write the per-entry choice, then the source store, then the snapshot;
 *     a failure of the first two fails the grant (and rolls the choice back).
 * Server-lifetime trust (session worktree trust, session grants, YOLO) never reaches
 * this module: the registry only lists persisted stores.
 *
 * Only the server holding the dashboard home lock writes the snapshot (one server
 * per HOME; this service is created by that server). Nothing here writes pi's
 * `trust.json`.
 *
 * See change: mirror-dashboard-trust-to-pi.
 */
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PiTrustMirrorConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import {
  filterMirrorEntries,
  type MirrorCandidate,
  type MirrorDenyRules,
  type MirrorIgnored,
  mirrorDenyRules,
  piTrustKey,
  statFolderIdentity,
} from "@blackbelt-technology/pi-dashboard-shared/pi-trust-mirror.js";
import {
  currentHookHash,
  piTrustMirrorSnapshotPath,
  piTrustOverridesPath,
  readPiTrustMirrorSnapshot,
} from "@blackbelt-technology/pi-dashboard-shared/pi-trust-mirror-snapshot.js";
import type {
  MirrorSourceKind,
  PiTrustSnapshot,
  PiTrustSnapshotEntry,
} from "@blackbelt-technology/pi-dashboard-shared/pi-trust-mirror-types.js";

/** Above this many counted entries every snapshot rewrite logs a warning. */
export const SNAPSHOT_WARN_ENTRIES = 5000;

export interface PiTrustMirrorServiceDeps {
  getConfig: () => PiTrustMirrorConfig;
  listPinned: () => string[];
  listWorkspaceFolders: () => string[];
  /** Persisted (project-scope) worktree-init trust only — never the session set. */
  listWorktreeTrust: () => Array<{ repoRoot: string; hash: string }>;
  /** Persisted (project-scope) access grants only — never session grants. */
  listPersistedGrants: () => Array<{ subject: string }>;
  /** Defaults to the dashboard config dir under `home`. */
  snapshotPath?: string;
  overridesPath?: string;
  home?: string;
  /** Fault-injection seam: atomic file write. Default: tmp + rename, mode 0600. */
  writeAtomic?: (file: string, content: string, mode: number) => void;
  /** Hook hash currently in a configuration root (default: reads `.pi/settings.json`). */
  hookHash?: (configRoot: string) => string | null;
  /** `false` marks a source whose producer is not installed. Default: workflow not installed. */
  installed?: Partial<Record<MirrorSourceKind, boolean>>;
  warn?: (msg: string) => void;
  canWrite?: () => boolean;
  /** Test seam: deny rules (default `mirrorDenyRules({ homedir: home })`). */
  denyRules?: () => MirrorDenyRules;
}

interface CountedMirrorEntry {
  candidate: MirrorCandidate;
  snapshotEntry: PiTrustSnapshotEntry;
}

interface MirrorEvaluation {
  counted: CountedMirrorEntry[];
  ignored: MirrorIgnored[];
  /** Every candidate (counted + ignored), for the Access page. */
  candidates: MirrorCandidate[];
  choicesReadable: boolean;
  sourcesNotInstalled: MirrorSourceKind[];
}

export interface PiTrustMirrorService {
  evaluate(opts?: { exclude?: Array<{ sourceKind: MirrorSourceKind; key: string }> }): MirrorEvaluation;
  /** The stored choice: `true`/`false`, `undefined` = follows the source default. */
  choiceFor(sourceKind: MirrorSourceKind, key: string): boolean | undefined;
  /** Rewrite the snapshot from the persisted stores. Returns its generation. Throws on write failure. */
  rewriteSnapshot(opts?: { exclude?: Array<{ sourceKind: MirrorSourceKind; key: string }> }): number;
  /** Boot: rebuild the snapshot from the stores (heals a crash between revoke writes). */
  rebuildAtBoot(): number;
  /** Set (or clear with `null`) one entry's choice. Throws on write failure. */
  setChoice(sourceKind: MirrorSourceKind, folder: string, choice: boolean | null): void;
  /** Grant: choice → source store → snapshot. Failure of the first two fails the grant. */
  grant(sourceKind: MirrorSourceKind, folder: string, choice: boolean | undefined, writeSource: () => void): void;
  /** Revoke: snapshot without the entry → source store → drop the choice. */
  revoke(sourceKind: MirrorSourceKind, folder: string, writeSource: () => void): void;
  /** Revoke several entries at once (same ordering), e.g. deleting a workspace. */
  revokeMany(entries: Array<{ sourceKind: MirrorSourceKind; folder: string }>, writeSource: () => void): void;
  /** Best-effort snapshot rewrite after a change that has no ordering need (logs on failure). */
  refresh(): void;
  /** The snapshot as currently on disk, or null. */
  readSnapshot(): PiTrustSnapshot | null;
}

const choiceKey = (kind: MirrorSourceKind, key: string): string => `${kind}\u0000${key}`;

interface ChoicesRead {
  readable: boolean;
  choices: Record<string, boolean>;
}

/** The per-entry choices file: absent = readable + empty; anything unparseable = unreadable. */
function readChoicesFile(file: string): ChoicesRead {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code === "ENOENT"
      ? { readable: true, choices: {} }
      : { readable: false, choices: {} };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    const c = (parsed as { choices?: unknown } | null)?.choices;
    if (!c || typeof c !== "object" || Array.isArray(c)) return { readable: false, choices: {} };
    const choices: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(c)) if (typeof v === "boolean") choices[k] = v;
    return { readable: true, choices };
  } catch {
    return { readable: false, choices: {} };
  }
}

function worktreeCandidate(
  key: string,
  repoRoot: string,
  recordedHash: string,
  currentHash: string | null,
): Omit<MirrorCandidate, "choice"> {
  const hookState = currentHash === null ? "unreadable" : currentHash === recordedHash ? "current" : "changed";
  return { sourceKind: "worktreeInit", key, hookState, meta: { configRoot: repoRoot, hookHash: recordedHash } };
}

/** Every durable candidate from the persisted source stores, with its stored choice and per-decision facts. */
function buildCandidates(
  deps: PiTrustMirrorServiceDeps,
  choices: Record<string, boolean>,
  keyOf: (folder: string) => string | null,
  hookHash: (configRoot: string) => string | null,
): MirrorCandidate[] {
  const out: MirrorCandidate[] = [];
  const push = (c: Omit<MirrorCandidate, "choice">): void => {
    out.push({ ...c, choice: choices[choiceKey(c.sourceKind, c.key)] });
  };
  for (const dir of deps.listPinned()) {
    const key = keyOf(dir);
    if (key) push({ sourceKind: "pinned", key });
  }
  for (const dir of deps.listWorkspaceFolders()) {
    const key = keyOf(dir);
    if (key) push({ sourceKind: "folderWorkspaces", key });
  }
  for (const { repoRoot, hash } of deps.listWorktreeTrust()) {
    // The worktree-init store keys on `path.resolve`; translate to pi's key form.
    const key = keyOf(repoRoot);
    if (key) push(worktreeCandidate(key, repoRoot, hash, hookHash(repoRoot)));
  }
  for (const { subject } of deps.listPersistedGrants()) {
    const key = keyOf(subject);
    if (key) push({ sourceKind: "accessGrants", key, projectRoot: isProjectRootDir(key) });
  }
  return out;
}

function isProjectRootDir(dir: string): boolean {
  try {
    return fs.existsSync(path.join(dir, ".git")) || fs.existsSync(path.join(dir, ".pi"));
  } catch {
    return false;
  }
}

function defaultWriteAtomic(file: string, content: string, mode: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, content, { mode });
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* best effort */
    }
    throw err;
  }
}

export function createPiTrustMirrorService(deps: PiTrustMirrorServiceDeps): PiTrustMirrorService {
  const home = deps.home ?? os.homedir();
  const snapshotFile = deps.snapshotPath ?? piTrustMirrorSnapshotPath();
  const overridesFile = deps.overridesPath ?? piTrustOverridesPath();
  const writeAtomic = deps.writeAtomic ?? defaultWriteAtomic;
  const hookHash = deps.hookHash ?? currentHookHash;
  const warn = deps.warn ?? ((m: string) => console.warn(`[pi-trust-mirror] ${m}`));
  const installed: Partial<Record<MirrorSourceKind, boolean>> = { workflow: false, ...deps.installed };
  let lastGeneration = 0;

  const keyOf = (folder: string): string | null => {
    try {
      return piTrustKey(folder, { home });
    } catch {
      return null;
    }
  };

  const readChoices = (): ChoicesRead => readChoicesFile(overridesFile);

  function writeChoices(choices: Record<string, boolean>): void {
    writeAtomic(overridesFile, `${JSON.stringify({ version: 1, choices }, null, 2)}\n`, 0o600);
  }

  const candidatesFor = (choices: Record<string, boolean>): MirrorCandidate[] =>
    buildCandidates(deps, choices, keyOf, hookHash);

  function evaluate(opts?: { exclude?: Array<{ sourceKind: MirrorSourceKind; key: string }> }): MirrorEvaluation {
    const cfg = deps.getConfig();
    const { readable, choices } = readChoices();
    const excluded = new Set((opts?.exclude ?? []).map((e) => choiceKey(e.sourceKind, e.key)));
    const candidates = candidatesFor(choices).filter((c) => !excluded.has(choiceKey(c.sourceKind, c.key)));
    const filtered = filterMirrorEntries(candidates, { sources: cfg.sources }, {
      choicesReadable: readable,
      installed,
      deny: deps.denyRules ? deps.denyRules() : mirrorDenyRules({ homedir: home }),
      home,
    });
    const counted: CountedMirrorEntry[] = [];
    const ignored: MirrorIgnored[] = [...filtered.ignored];
    for (const candidate of filtered.counted) {
      const identity = statFolderIdentity(candidate.key);
      if (!identity) {
        ignored.push({ entry: candidate, reason: "identity-mismatch" });
        continue;
      }
      const meta = candidate.meta as { configRoot?: string; hookHash?: string } | undefined;
      counted.push({
        candidate,
        snapshotEntry: {
          key: candidate.key,
          sourceKind: candidate.sourceKind,
          ...identity,
          ...(meta?.configRoot ? { configRoot: meta.configRoot } : {}),
          ...(meta?.hookHash ? { hookHash: meta.hookHash } : {}),
        },
      });
    }
    const sourcesNotInstalled = (Object.keys(installed) as MirrorSourceKind[]).filter((k) => installed[k] === false);
    return { counted, ignored, candidates, choicesReadable: readable, sourcesNotInstalled };
  }

  function rewriteSnapshot(opts?: { exclude?: Array<{ sourceKind: MirrorSourceKind; key: string }> }): number {
    if (deps.canWrite && !deps.canWrite()) throw new Error("pi-trust-mirror: this server does not hold the home lock");
    const evaluation = evaluate(opts);
    const onDisk = readPiTrustMirrorSnapshot(snapshotFile);
    const generation = Math.max(lastGeneration, onDisk?.generation ?? 0) + 1;
    const snapshot: PiTrustSnapshot = {
      version: 1,
      generation,
      entries: evaluation.counted.map((c) => c.snapshotEntry),
    };
    writeAtomic(snapshotFile, `${JSON.stringify(snapshot)}\n`, 0o600);
    lastGeneration = generation;
    if (snapshot.entries.length > SNAPSHOT_WARN_ENTRIES) {
      warn(`snapshot holds ${snapshot.entries.length} entries (> ${SNAPSHOT_WARN_ENTRIES}); consider unpinning unused folders`);
    }
    return generation;
  }

  function setChoice(kind: MirrorSourceKind, folder: string, choice: boolean | null): void {
    const key = keyOf(folder);
    if (!key) throw new Error(`pi-trust-mirror: cannot key folder ${JSON.stringify(folder)}`);
    const { readable, choices } = readChoices();
    if (!readable) throw new Error("pi-trust-mirror: per-entry choices file is unreadable");
    const k = choiceKey(kind, key);
    if (choice === null) delete choices[k];
    else choices[k] = choice;
    writeChoices(choices);
  }

  function revokeMany(entries: Array<{ sourceKind: MirrorSourceKind; folder: string }>, writeSource: () => void): void {
    const keyed = entries.flatMap((e) => {
      const key = keyOf(e.folder);
      return key ? [{ sourceKind: e.sourceKind, key, folder: e.folder }] : [];
    });
    if (keyed.length > 0) rewriteSnapshot({ exclude: keyed.map(({ sourceKind, key }) => ({ sourceKind, key })) });
    writeSource();
    for (const e of keyed) {
      try {
        setChoice(e.sourceKind, e.folder, null);
      } catch {
        /* orphan choices are ignored */
      }
    }
    // Siblings of an excluded entry (another hook hash, another source row of
    // the same folder) were dropped from the snapshot above; put them back.
    try {
      rewriteSnapshot();
    } catch (err) {
      warn(`snapshot refresh after revoke failed: ${(err as Error)?.message}`);
    }
  }

  return {
    evaluate,
    choiceFor(kind, key) {
      const { choices } = readChoices();
      return choices[choiceKey(kind, key)];
    },
    rewriteSnapshot,
    rebuildAtBoot: () => rewriteSnapshot(),
    setChoice,
    grant(kind, folder, choice, writeSource) {
      const key = keyOf(folder);
      if (!key) throw new Error(`pi-trust-mirror: cannot key folder ${JSON.stringify(folder)}`);
      const previous = readChoices();
      if (choice !== undefined) setChoice(kind, folder, choice);
      try {
        writeSource();
      } catch (err) {
        // Roll the choice back so a failed grant leaves no orphan behind.
        if (choice !== undefined) {
          try {
            writeChoices(previous.choices);
          } catch {
            /* orphan choices are ignored */
          }
        }
        throw err;
      }
      rewriteSnapshot();
    },
    revoke(kind, folder, writeSource) {
      revokeMany([{ sourceKind: kind, folder }], writeSource);
    },
    revokeMany,
    refresh() {
      try {
        rewriteSnapshot();
      } catch (err) {
        warn(`snapshot refresh failed: ${(err as Error)?.message}`);
      }
    },
    readSnapshot: () => readPiTrustMirrorSnapshot(snapshotFile),
  };
}

// ── Process-wide handle (set by server.ts; absent in unit tests = legacy behaviour) ──

let current: PiTrustMirrorService | undefined;

export function setPiTrustMirror(service: PiTrustMirrorService | undefined): void {
  current = service;
}

export function getPiTrustMirror(): PiTrustMirrorService | undefined {
  return current;
}
