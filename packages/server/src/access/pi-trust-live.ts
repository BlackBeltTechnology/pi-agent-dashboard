/**
 * Live dashboard-trust entries: trust whose lifetime is the running server.
 *
 * Sources (all in memory, never persisted, never in the snapshot):
 *   - session-scoped worktree-init trust ("until the dashboard restarts");
 *   - session-scoped access grants on project roots;
 *   - each root of a live YOLO session (operator: until expiry/end; env: for the
 *     server process; unscoped never).
 *
 * Every entry records the folder's identity (dev + ino [+ birth time]) the first
 * time the provider sees it — `reconcile()` runs synchronously inside the action
 * that created it — so a deleted-and-re-created folder never inherits trust. A
 * folder that cannot be stat'ed at creation gets no identity and never counts.
 * Per-entry "also trust in pi" choices for live entries are held here, in memory,
 * and end with the entry.
 *
 * Entries then pass the SAME switch / choice / deny / hook / project-root rules as
 * durable ones (`filterMirrorEntries`). The provider answers: how many count
 * (`reconcile`), which cover a cwd (`covering`), and whether a YOLO entry is still
 * live (`isStillLive`, re-checked after a proof is built).
 *
 * See change: mirror-dashboard-trust-live-remote (D3).
 */
import os from "node:os";
import type { PiTrustMirrorConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import {
  type FolderIdentity,
  filterMirrorEntries,
  findCoveringEntry,
  type MirrorCandidate,
  type MirrorDenyRules,
  type MirrorIgnored,
  mirrorDenyRules,
  statFolderIdentity,
} from "@blackbelt-technology/pi-dashboard-shared/pi-trust-mirror.js";
import { currentHookHash, safePiTrustKey } from "@blackbelt-technology/pi-dashboard-shared/pi-trust-mirror-snapshot.js";
import type { MirrorSourceKind } from "@blackbelt-technology/pi-dashboard-shared/pi-trust-mirror-types.js";
import { hasProjectRootMarker } from "@blackbelt-technology/pi-dashboard-shared/project-root.js";
import type { YoloSession } from "./yolo-session.js";

type LiveSourceKind = Extract<MirrorSourceKind, "worktreeInit" | "accessGrants" | "yolo">;

export type LiveLifetime =
  | { kind: "restart" }
  | { kind: "yolo-until"; until: number }
  | { kind: "yolo-process" };

/** Human lifetime phrase for server-side views ("until dashboard restarts", …). */
export function liveLifetimeText(l: LiveLifetime): string {
  if (l.kind === "restart") return "until dashboard restarts";
  if (l.kind === "yolo-process") return "YOLO while the server runs";
  return `YOLO until ${new Date(l.until).toISOString()}`;
}

export interface LiveEntry {
  sourceKind: LiveSourceKind;
  /** pi trust-store key form (canonical absolute path). */
  key: string;
  /** Identity recorded when the entry was created. */
  identity: FolderIdentity;
  lifetime: LiveLifetime;
}

export interface LiveProviderDeps {
  getConfig: () => PiTrustMirrorConfig;
  /** In-memory session worktree-init trust (`path.resolve` keys). */
  listSessionTrust: () => Array<{ repoRoot: string; hash: string }>;
  /** In-memory session access grants. */
  listSessionGrants: () => Array<{ subject: string }>;
  /** Lazy: YOLO is constructed after the mirror service. */
  getYolo: () => { status(): YoloSession | null } | undefined;
  home?: string;
  now?: () => number;
  hookHash?: (configRoot: string) => string | null;
  denyRules?: () => MirrorDenyRules;
  /** Test seam: identity probe (default `statFolderIdentity`). */
  stat?: (key: string) => FolderIdentity | null;
}

interface LiveEnumeration {
  counted: LiveEntry[];
  ignored: MirrorIgnored[];
  /** Every live candidate (counted + ignored), with its lifetime, for the Access page. */
  candidates: Array<{ candidate: MirrorCandidate; lifetime: LiveLifetime; confers: boolean }>;
}

export interface PiTrustLiveProvider {
  /** Record identities of new entries, drop those that ended, return how many count. */
  reconcile(): number;
  enumerate(): LiveEnumeration;
  /** The nearest counted live entry whose folder is the cwd key or an ancestor. */
  covering(cwdKey: string): LiveEntry | null;
  /** False once a YOLO entry's session ended or expired (always true for the other sources). */
  isStillLive(entry: LiveEntry): boolean;
  /** Hold (or clear with `null`) one live entry's choice in memory. */
  setChoice(kind: LiveSourceKind, folder: string, choice: boolean | null): void;
}

const idKey = (kind: string, key: string): string => `${kind}\u0000${key}`;

interface RawCandidate {
  candidate: MirrorCandidate;
  lifetime: LiveLifetime;
}

type Unchoiced = { candidate: Omit<MirrorCandidate, "choice">; lifetime: LiveLifetime };
type KeyOf = (folder: string) => string | null;

function sessionTrustCandidates(deps: LiveProviderDeps, keyOf: KeyOf, hookHash: (root: string) => string | null): Unchoiced[] {
  const out: Unchoiced[] = [];
  for (const { repoRoot, hash } of deps.listSessionTrust()) {
    const key = keyOf(repoRoot);
    if (!key) continue;
    const current = hookHash(repoRoot);
    const hookState = current === null ? "unreadable" : current === hash ? "current" : "changed";
    out.push({
      candidate: { sourceKind: "worktreeInit", key, hookState, meta: { configRoot: repoRoot, hookHash: hash } },
      lifetime: { kind: "restart" },
    });
  }
  return out;
}

function sessionGrantCandidates(deps: LiveProviderDeps, keyOf: KeyOf): Unchoiced[] {
  const out: Unchoiced[] = [];
  for (const { subject } of deps.listSessionGrants()) {
    const key = keyOf(subject);
    if (key) {
      out.push({ candidate: { sourceKind: "accessGrants", key, projectRoot: hasProjectRootMarker(key) }, lifetime: { kind: "restart" } });
    }
  }
  return out;
}

function yoloCandidates(deps: LiveProviderDeps, keyOf: KeyOf): Unchoiced[] {
  const session = deps.getYolo()?.status() ?? null;
  if (!session || session.unscoped) return [];
  const lifetime: LiveLifetime =
    session.expiresAt === null ? { kind: "yolo-process" } : { kind: "yolo-until", until: session.expiresAt };
  const out: Unchoiced[] = [];
  for (const root of session.roots) {
    const key = keyOf(root.path);
    if (key) out.push({ candidate: { sourceKind: "yolo", key }, lifetime });
  }
  return out;
}

/** Counted candidates that hold a recorded identity become entries; the rest are ignored `identity-mismatch`. */
function toEntries(
  counted: readonly MirrorCandidate[],
  identities: ReadonlyMap<string, FolderIdentity | null>,
  lifetimes: ReadonlyMap<string, LiveLifetime>,
): { entries: LiveEntry[]; noIdentity: MirrorIgnored[] } {
  const entries: LiveEntry[] = [];
  const noIdentity: MirrorIgnored[] = [];
  for (const c of counted) {
    const k = idKey(c.sourceKind, c.key);
    const identity = identities.get(k);
    if (!identity) {
      noIdentity.push({ entry: c, reason: "identity-mismatch" });
      continue;
    }
    entries.push({ sourceKind: c.sourceKind as LiveSourceKind, key: c.key, identity, lifetime: lifetimes.get(k) as LiveLifetime });
  }
  return { entries, noIdentity };
}

export function createPiTrustLiveProvider(deps: LiveProviderDeps): PiTrustLiveProvider {
  const home = deps.home ?? os.homedir();
  const now = deps.now ?? Date.now;
  const hookHash = deps.hookHash ?? currentHookHash;
  const stat = deps.stat ?? statFolderIdentity;
  /** `null` = could not be stat'ed at creation: never counts. */
  const identities = new Map<string, FolderIdentity | null>();
  const choices = new Map<string, boolean>();

  const keyOf: KeyOf = (folder) => safePiTrustKey(folder, home);

  function raw(): RawCandidate[] {
    const all = [...sessionTrustCandidates(deps, keyOf, hookHash), ...sessionGrantCandidates(deps, keyOf), ...yoloCandidates(deps, keyOf)];
    return all.map(({ candidate, lifetime }) => ({
      candidate: { ...candidate, choice: choices.get(idKey(candidate.sourceKind, candidate.key)) },
      lifetime,
    }));
  }

  /** Stat new keys now (creation time), forget keys that ended, drop their choices. */
  function sync(candidates: RawCandidate[]): void {
    const present = new Set(candidates.map((c) => idKey(c.candidate.sourceKind, c.candidate.key)));
    for (const { candidate } of candidates) {
      const k = idKey(candidate.sourceKind, candidate.key);
      if (!identities.has(k)) identities.set(k, stat(candidate.key));
    }
    for (const k of [...identities.keys()]) {
      if (!present.has(k)) {
        identities.delete(k);
        choices.delete(k);
      }
    }
  }

  function enumerate(): LiveEnumeration {
    const candidates = raw();
    sync(candidates);
    const lifetimes = new Map(candidates.map((c) => [idKey(c.candidate.sourceKind, c.candidate.key), c.lifetime]));
    const filtered = filterMirrorEntries(candidates.map((c) => c.candidate), { sources: deps.getConfig().sources }, {
      choicesReadable: true,
      deny: deps.denyRules ? deps.denyRules() : mirrorDenyRules({ homedir: home }),
      home,
    });
    const { entries, noIdentity } = toEntries(filtered.counted, identities, lifetimes);
    const countedKeys = new Set(entries.map((e) => idKey(e.sourceKind, e.key)));
    return {
      counted: entries,
      ignored: [...filtered.ignored, ...noIdentity],
      candidates: candidates.map((c) => ({
        candidate: c.candidate,
        lifetime: c.lifetime,
        confers: countedKeys.has(idKey(c.candidate.sourceKind, c.candidate.key)),
      })),
    };
  }

  function yoloStillLive(entry: LiveEntry): boolean {
    if (!deps.getConfig().sources.yolo) return false;
    const session = deps.getYolo()?.status() ?? null;
    if (!session || session.unscoped) return false;
    if (session.expiresAt !== null && now() >= session.expiresAt) return false;
    return session.roots.some((r) => keyOf(r.path) === entry.key);
  }

  return {
    reconcile: () => enumerate().counted.length,
    enumerate,
    covering: (cwdKey) => findCoveringEntry(enumerate().counted, cwdKey),
    isStillLive: (entry) => entry.sourceKind !== "yolo" || yoloStillLive(entry),
    setChoice(kind, folder, choice) {
      const key = keyOf(folder);
      if (!key) return;
      if (choice === null) choices.delete(idKey(kind, key));
      else choices.set(idKey(kind, key), choice);
    },
  };
}
