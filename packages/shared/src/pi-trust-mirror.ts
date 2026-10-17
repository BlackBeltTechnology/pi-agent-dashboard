/**
 * Dashboard trust → pi `project_trust` mirror: the shared pure core.
 *
 * One folder decision (`decidePiTrust`) serves the bridge, `host.isProjectTrusted`
 * and the toggle gate. `piTrustKey` reproduces pi's trust-store key form;
 * `mirrorDenyRules` is a SEPARATE deny list from `forbidden-subjects` (it reuses
 * its values read-only and never changes the grant-subject rules);
 * `filterMirrorEntries` applies source/choice/deny/hook/project-root facts and
 * explains every ignored entry with a reason code.
 *
 * Node-only (`node:fs`/`os`/`path`): the browser client imports the types from
 * `pi-trust-mirror-types.ts` instead. Nothing here writes pi's `trust.json`.
 *
 * See change: mirror-dashboard-trust-to-pi.
 */
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PiTrustMirrorSourceId } from "./config.js";
import { forbiddenGrantSubjects, realpathNearestAncestor } from "./forbidden-subjects.js";
import type { MirrorIgnoreReason, MirrorSourceKind } from "./pi-trust-mirror-types.js";

export type { MirrorIgnoreReason, MirrorSourceKind, PiTrustSnapshot, PiTrustSnapshotEntry } from "./pi-trust-mirror-types.js";

// ── Key function ──────────────────────────────────────────────────────────

/**
 * pi's trust-store key: `canonicalizePath(resolvePath(path))` with no options
 * (no Unicode-space normalisation). `canonicalizePath` is `realpathSync` that
 * returns the INPUT on failure (not nearest-ancestor), so a missing leaf keeps
 * its lexical form. Tilde expands against the explicit `home`. Relative input
 * throws — a bridge cwd must never silently resolve against `process.cwd()`.
 */
export function piTrustKey(input: string, opts: { home: string }): string {
  let p = input;
  if (p === "~") p = opts.home;
  else if (p.startsWith("~/") || (path.sep === "\\" && p.startsWith("~\\"))) p = path.join(opts.home, p.slice(2));
  if (!path.isAbsolute(p)) throw new Error(`piTrustKey: relative path rejected: ${JSON.stringify(input)}`);
  const resolved = path.resolve(p);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

/**
 * True only for a canonical absolute path: no NUL, no `.`/`..` segments, already
 * normalised. Snapshot keys and trust-store keys are always in this form, so
 * anything else is refused before a filesystem probe rather than normalised.
 */
export function isCanonicalAbsolutePath(p: unknown): p is string {
  return (
    typeof p === "string" &&
    p.length > 0 &&
    !p.includes("\0") &&
    path.isAbsolute(p) &&
    path.normalize(p) === p &&
    !p.split(/[\\/]/).includes("..")
  );
}

/** `key` itself, then each ancestor, up to the root. */
export function ancestorKeys(key: string): string[] {
  const out: string[] = [];
  let cur = key;
  for (;;) {
    out.push(cur);
    const parent = path.dirname(cur);
    if (parent === cur) return out;
    cur = parent;
  }
}

// ── Deny rules ────────────────────────────────────────────────────────────

export interface MirrorDenyEnv {
  homedir?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

export interface MirrorDenyRules {
  /** Refused exactly (the folder itself, not its subtree). */
  exact: string[];
  /** Refused at and below. */
  subtree: string[];
}

const POSIX_BROAD_PARENTS = ["/Users", "/home", "/Volumes", "/private", "/var/tmp", "/mnt", "/media"];

/**
 * The mirror's own deny list (design D2). `exact`: the grant-subject `whole`
 * list (`/`, `$HOME`, system dirs) + every ancestor of `$HOME` + platform broad
 * parents. `subtree`: the grant-subject `sensitive` list (`~/.ssh`, `~/.pi`) +
 * `~/.aws`, `~/.gnupg`, `~/.kube`, `~/.docker`, temp dirs, `~/.cache`,
 * `~/Downloads`. All canonicalised (real paths).
 */
export function mirrorDenyRules(env: MirrorDenyEnv = {}): MirrorDenyRules {
  const home = env.homedir ?? os.homedir();
  const platform = env.platform ?? process.platform;
  const windows = platform === "win32";
  const p = windows ? path.win32 : path.posix;
  const canon = (x: string): string => realpathNearestAncestor(p.resolve(x));
  const grant = forbiddenGrantSubjects({ homedir: home, platform, env: env.env });
  const realHome = canon(home);

  const exact = [...grant.whole];
  for (let cur = p.dirname(realHome); ; cur = p.dirname(cur)) {
    exact.push(cur);
    if (p.dirname(cur) === cur) break;
  }
  if (windows) {
    const vars = env.env ?? process.env;
    exact.push(p.join(vars.SystemDrive ? `${vars.SystemDrive}\\` : "C:\\", "Users"));
  } else {
    exact.push(...POSIX_BROAD_PARENTS.map(canon));
  }

  const tmpdirs = windows ? [os.tmpdir()] : [os.tmpdir(), "/tmp", "/private/tmp"];
  const subtree = [
    ...grant.sensitive,
    ...[".aws", ".gnupg", ".kube", ".docker", ".cache", "Downloads"].map((d) => canon(p.join(home, d))),
    ...tmpdirs.map(canon),
  ];
  return { exact: [...new Set(exact)], subtree: [...new Set(subtree)] };
}

function samePathStr(a: string, b: string, windows: boolean): boolean {
  return windows ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** True when `key` is forbidden as a mirror entry, or lies inside a forbidden subtree. */
export function isMirrorDenied(key: string, rules: MirrorDenyRules, platform: NodeJS.Platform = process.platform): boolean {
  const windows = platform === "win32";
  const p = windows ? path.win32 : path.posix;
  const real = realpathNearestAncestor(p.resolve(key));
  if (rules.exact.some((f) => samePathStr(real, f, windows))) return true;
  return rules.subtree.some((root) => {
    if (samePathStr(real, root, windows)) return true;
    const rel = p.relative(root, real);
    return rel !== "" && !rel.startsWith("..") && !p.isAbsolute(rel);
  });
}

// ── Entries, settings, filter ─────────────────────────────────────────────

export interface MirrorSettings {
  enabled: boolean;
  coverInteractive: boolean;
  sources: Record<PiTrustMirrorSourceId, boolean>;
}

/** A source entry as read from a durable store, with the per-decision facts resolved. */
export interface MirrorCandidate {
  sourceKind: MirrorSourceKind;
  /** pi trust-store key form (canonical absolute path). */
  key: string;
  /** Stored per-entry choice; `undefined` = follows the source default. */
  choice?: boolean;
  /** worktreeInit/workflow: recorded hash vs the hook currently in `configRoot`. */
  hookState?: "current" | "changed" | "unreadable";
  /** accessGrants: the subject currently contains `.git` or `.pi`. */
  projectRoot?: boolean;
  /** Pass-through payload (configRoot, hookHash, ...) the caller needs after filtering. */
  meta?: Record<string, unknown>;
}

export interface MirrorFilterFacts {
  /** False when the per-entry choices file exists but cannot be read. */
  choicesReadable: boolean;
  /** `false` for a source whose producer is not installed (workflow before add-project-workflows). */
  installed?: Partial<Record<MirrorSourceKind, boolean>>;
  deny?: MirrorDenyRules;
  platform?: NodeJS.Platform;
  home?: string;
}

export interface MirrorIgnored {
  entry: MirrorCandidate;
  reason: MirrorIgnoreReason;
}

export interface MirrorFilterResult {
  counted: MirrorCandidate[];
  ignored: MirrorIgnored[];
}

/**
 * Split candidates into counted and ignored-with-reason. Precedence of reasons:
 * not installed → unreadable choice → forbidden folder → hook → project root →
 * source/choice. An entry counts iff (source on ∧ choice≠false) ∨ choice=true.
 */
export function filterMirrorEntries(
  candidates: readonly MirrorCandidate[],
  settings: Pick<MirrorSettings, "sources">,
  facts: MirrorFilterFacts,
): MirrorFilterResult {
  const deny = facts.deny ?? mirrorDenyRules({ homedir: facts.home, platform: facts.platform });
  const counted: MirrorCandidate[] = [];
  const ignored: MirrorIgnored[] = [];
  for (const entry of candidates) {
    const reason = ignoreReason(entry, settings, facts, deny);
    if (reason) ignored.push({ entry, reason });
    else counted.push(entry);
  }
  return { counted, ignored };
}

function ignoreReason(
  entry: MirrorCandidate,
  settings: Pick<MirrorSettings, "sources">,
  facts: MirrorFilterFacts,
  deny: MirrorDenyRules,
): MirrorIgnoreReason | null {
  if (facts.installed?.[entry.sourceKind] === false) return "source-not-installed";
  if (!facts.choicesReadable) return "choice-unreadable";
  if (isMirrorDenied(entry.key, deny, facts.platform)) return "forbidden-folder";
  if (entry.hookState === "changed" || entry.hookState === "unreadable") return "hook-changed";
  if (entry.sourceKind === "accessGrants" && entry.projectRoot !== true) return "not-project-root";
  const sourceOn = settings.sources[entry.sourceKind] === true;
  const wanted = entry.choice === true || (sourceOn && entry.choice !== false);
  return wanted ? null : "source-off";
}

// ── The shared folder decision ────────────────────────────────────────────

export type DefaultProjectTrust = "always" | "never" | "ask";

export type PiTrustSource =
  | { kind: "implicit" }
  | { kind: "recorded"; path: string }
  | { kind: "dashboard"; sourceKind: MirrorSourceKind; entry: string }
  | { kind: "default"; value: DefaultProjectTrust };

export interface PiTrustDecision {
  trusted: boolean;
  source: PiTrustSource;
}

export interface DecidePiTrustInput {
  /** pi's own `hasTrustRequiringProjectResources(cwd)`; `false` ⇒ implicitly trusted. */
  hasTrustRequiringResources: boolean;
  /** pi's nearest recorded entry (true OR false), or null. */
  recordedEntry: { path: string; decision: boolean } | null;
  /** The counted dashboard entry covering the cwd, or null. */
  mirrorEntry: { sourceKind: MirrorSourceKind; key: string } | null;
  /** `piTrustMirror.enabled`. */
  mirrorEnabled: boolean;
  piDefault: DefaultProjectTrust;
}

/**
 * implicit → pi's recorded entry → dashboard trust (even over `never`) →
 * `defaultProjectTrust`. Never writes anything. CLI `--approve/--no-approve`
 * is pi's and outside this core.
 */
export function decidePiTrust(input: DecidePiTrustInput): PiTrustDecision {
  if (!input.hasTrustRequiringResources) return { trusted: true, source: { kind: "implicit" } };
  if (input.recordedEntry) {
    return { trusted: input.recordedEntry.decision, source: { kind: "recorded", path: input.recordedEntry.path } };
  }
  if (input.mirrorEnabled && input.mirrorEntry) {
    return {
      trusted: true,
      source: { kind: "dashboard", sourceKind: input.mirrorEntry.sourceKind, entry: input.mirrorEntry.key },
    };
  }
  return { trusted: input.piDefault === "always", source: { kind: "default", value: input.piDefault } };
}

/** Human label for a source kind (UI + toggle prompt). */
export const MIRROR_SOURCE_LABELS: Record<MirrorSourceKind, string> = {
  worktreeInit: "worktree-init trust",
  workflow: "workflow trust",
  pinned: "pinned folder",
  folderWorkspaces: "folder workspace",
  accessGrants: "access grant",
};

// ── Covering entry + identity ─────────────────────────────────────────────

/** Nearest entry whose key equals the cwd key or an ancestor of it. */
export function findCoveringEntry<T extends { key: string }>(entries: readonly T[], cwdKey: string): T | null {
  if (entries.length === 0) return null;
  const byKey = new Map<string, T>();
  for (const e of entries) if (!byKey.has(e.key)) byKey.set(e.key, e);
  for (const k of ancestorKeys(cwdKey)) {
    const hit = byKey.get(k);
    if (hit) return hit;
  }
  return null;
}

export interface FolderIdentity {
  dev: string;
  ino: string;
  birthtimeMs?: number;
}

/**
 * Device + inode (as strings; bigint-safe) of `dir`, and its birth time only
 * when the filesystem reported one distinct from the change time. `null` when
 * the folder cannot be stat'ed.
 */
export function statFolderIdentity(dir: string): FolderIdentity | null {
  if (!isCanonicalAbsolutePath(dir)) return null;
  try {
    const st = fs.statSync(dir, { bigint: true });
    const identity: FolderIdentity = { dev: st.dev.toString(), ino: st.ino.toString() };
    const birth = Number(st.birthtimeMs);
    if (Number.isFinite(birth) && birth > 0 && st.birthtimeMs !== st.ctimeMs) identity.birthtimeMs = birth;
    return identity;
  } catch {
    return null;
  }
}

/** Observed identity equals the entry's: dev + ino, and birth time when the entry recorded one. */
export function identityMatches(
  entry: { dev: string; ino: string; birthtimeMs?: number },
  observed: FolderIdentity | null,
): boolean {
  if (!observed) return false;
  if (entry.dev !== observed.dev || entry.ino !== observed.ino) return false;
  if (entry.birthtimeMs !== undefined && entry.birthtimeMs !== observed.birthtimeMs) return false;
  return true;
}
