/**
 * `project_trust` auto-decision — the bridge's snapshot decision plus a bounded live step.
 *
 * A dashboard-spawned headless RPC session has no human at pi's TUI to answer
 * `project_trust`, so pi leaves the no-UI decision un-trusted and the session can
 * stall. The bridge answers "yes" (this run only, never remembered) in two cases:
 *
 *   1. ACTIVATION rule — the event cwd is (canonically) the exact dir the
 *      dashboard spawned into, for a dashboard-spawned headless session;
 *   2. MIRROR rule — a durable dashboard-trust entry from the server-written
 *      snapshot covers the cwd, for dashboard-spawned headless sessions, or for
 *      every session when `piTrustMirror.coverInteractive` is on.
 *
 * Neither contacts the server: config, pi's `trust.json` (lockless, pi's own
 * reading rules) and the snapshot are read per event, never cached. Only when the
 * snapshot does not cover the cwd — and the snapshot reports live (server-lifetime)
 * entries, or this is a REMOTE bridge — does a third rule ask the server, once, over
 * an authenticated one-shot HTTP request, under ONE deadline (`liveQueryTimeoutMs`)
 * that bounds the request and the folder-proof check together. Every failure is
 * `undecided` with a reason code. Everything doubtful is `undecided`. A recorded pi entry (true OR false) always wins, and
 * forbidden/temporary folders never auto-trust. Pure decision logic lives here
 * (deps injected) so it is unit-testable without the bridge.
 *
 * pi emits `project_trust` during resource-loader reload, BEFORE `session_start`,
 * so the activation cwd is captured at bridge module scope.
 *
 * See change: adopt-pi-074-080-features (A.3), mirror-dashboard-trust-to-pi,
 * mirror-dashboard-trust-live-remote.
 */
import os from "node:os";
import type { PiTrustMirrorConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { effectiveLiveQueryTimeoutMs, loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { resolvePiAgentDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import {
  ancestorKeys,
  type FolderIdentity,
  identityMatches,
  isCanonicalAbsolutePath,
  isMirrorDenied,
  type MirrorDenyRules,
  mirrorDenyRules,
  statFolderIdentityAsync,
} from "@blackbelt-technology/pi-dashboard-shared/pi-trust-mirror.js";
import {
  isRemoteLiveAnswer,
  parsePiTrustLiveAnswer,
} from "@blackbelt-technology/pi-dashboard-shared/pi-trust-live-query.js";
import {
  trustResourceDigest,
  trustResourceManifest,
} from "@blackbelt-technology/pi-dashboard-shared/pi-trust-resource-digest.js";
import {
  coverSnapshot,
  nearestRecordedEntry,
  type PiTrustFileRead,
  readPiTrustFileLockless,
  readPiTrustMirrorSnapshot,
  safePiTrustKey,
} from "@blackbelt-technology/pi-dashboard-shared/pi-trust-mirror-snapshot.js";
import type { MirrorWithheldReason, PiTrustSnapshot } from "@blackbelt-technology/pi-dashboard-shared/pi-trust-mirror-types.js";
import type { LiveQueryFn } from "./project-trust-live.js";

export interface ProjectTrustDecisionInput {
  /** True when this pi was spawned by the dashboard (spawn token captured at activation). */
  dashboardSpawned: boolean;
  /** True for a headless RPC session (no TTY, bridge over WebSocket). */
  isHeadless: boolean;
  /** cwd carried by the project_trust event (undefined when unreadable). */
  eventCwd: string | undefined;
  /** cwd captured at bridge activation (the dashboard-provided spawn cwd). */
  activationCwd: string;
}

export interface ProjectTrustDeps {
  home: string;
  agentDir: string;
  readConfig: () => PiTrustMirrorConfig;
  readSnapshot: () => PiTrustSnapshot | null;
  readTrustFile: (agentDir: string) => PiTrustFileRead;
  denyRules: () => MirrorDenyRules;
  /** Receives one line per withheld decision of a dashboard-spawned session. */
  log: (line: string) => void;
  /** Is the dashboard endpoint remote (non-loopback, with a paired-device token)? Default: no. */
  isRemoteBridge: () => boolean;
  /** The live query transport. Default: unreachable (no endpoint known outside the bridge). */
  liveQuery: LiveQueryFn;
  /** Async folder-proof inputs (all honour the deadline's `AbortSignal`). */
  manifest: typeof trustResourceManifest;
  statIdentity: (dir: string, signal: AbortSignal) => Promise<FolderIdentity | null>;
}

export interface ProjectTrustResult {
  trusted: "yes" | "undecided";
  /** Why trust was withheld (undecided only). */
  reason?: MirrorWithheldReason;
  /** Which rule granted "yes". */
  via?: "activation" | "mirror" | "live";
}

const UNDECIDED: ProjectTrustResult = { trusted: "undecided" };

function defaultDeps(): ProjectTrustDeps {
  const home = os.homedir();
  return {
    home,
    agentDir: resolvePiAgentDir(),
    readConfig: () => loadConfig().piTrustMirror,
    readSnapshot: () => readPiTrustMirrorSnapshot(),
    readTrustFile: readPiTrustFileLockless,
    denyRules: () => mirrorDenyRules({ homedir: home }),
    log: (line) => console.error(`[dashboard] ${line}`),
    isRemoteBridge: () => false,
    liveQuery: async () => ({ kind: "unreachable" }),
    manifest: trustResourceManifest,
    statIdentity: statFolderIdentityAsync,
  };
}

/**
 * Decide `project_trust` for one event. Never throws: any error → undecided.
 * Order: unreadable store → recorded pi entry → activation rule → snapshot rule →
 * live query (only on a snapshot miss, under its conditions). The live step is the
 * only part that awaits, and it is bounded by `liveQueryTimeoutMs`.
 */
export async function decideBridgeProjectTrust(
  input: ProjectTrustDecisionInput,
  overrides: Partial<ProjectTrustDeps> = {},
): Promise<ProjectTrustResult> {
  try {
    const deps = { ...defaultDeps(), ...overrides };
    if (input.eventCwd === undefined) return UNDECIDED;
    const cwdKey = safePiTrustKey(input.eventCwd, deps.home);
    if (cwdKey === null) return UNDECIDED;
    const spawnedHeadless = input.dashboardSpawned && input.isHeadless;
    const withheld = (reason: MirrorWithheldReason): ProjectTrustResult => {
      if (spawnedHeadless) deps.log(`project_trust withheld for ${cwdKey}: ${reason}`);
      return { trusted: "undecided", reason };
    };

    const stop = piStoreBlocks(deps, cwdKey);
    if (stop) return withheld(stop);

    if (spawnedHeadless && safePiTrustKey(input.activationCwd, deps.home) === cwdKey) {
      return isMirrorDenied(cwdKey, deps.denyRules()) ? withheld("forbidden-folder") : { trusted: "yes", via: "activation" };
    }
    return await decideFromMirror(input, deps, cwdKey, withheld);
  } catch {
    return UNDECIDED;
  }
}

/** pi's own store: unreadable, or a recorded entry (true OR false) for the cwd or an ancestor. */
function piStoreBlocks(deps: ProjectTrustDeps, cwdKey: string): MirrorWithheldReason | null {
  const trustFile = deps.readTrustFile(deps.agentDir);
  if (trustFile.kind === "unreadable") return "store-unreadable";
  if (trustFile.kind === "ok" && nearestRecordedEntry(trustFile.data, cwdKey)) return "recorded-entry";
  return null;
}

/** The snapshot rule, then the live query: enabled, covered, and an allowed session class. */
async function decideFromMirror(
  input: ProjectTrustDecisionInput,
  deps: ProjectTrustDeps,
  cwdKey: string,
  withheld: (reason: MirrorWithheldReason) => ProjectTrustResult,
): Promise<ProjectTrustResult> {
  const cfg = deps.readConfig();
  if (!cfg.enabled) return UNDECIDED;
  const snapshot = deps.readSnapshot();
  const coverage = coverSnapshot(snapshot, cwdKey);
  const sessionAllowed = (input.dashboardSpawned && input.isHeadless) || cfg.coverInteractive;
  if (coverage.covered) {
    if (sessionAllowed) return { trusted: "yes", via: "mirror" };
    // Covered, but this session class is not: say so.
    if (input.dashboardSpawned) deps.log(`project_trust withheld for ${cwdKey}: not-covered-session`);
    return { trusted: "undecided", reason: "not-covered-session" };
  }

  // The snapshot yields no cover (for any reason, including identity-mismatch): ask the
  // server when it may know more — live entries exist, or this bridge is remote.
  if (sessionAllowed && cfg.liveQuery && !isMirrorDenied(cwdKey, deps.denyRules())) {
    const remote = deps.isRemoteBridge();
    if ((snapshot?.liveCount ?? 0) > 0 || remote) {
      const live = await runLiveQuery(deps, cfg, cwdKey, remote);
      return live.ok ? { trusted: "yes", via: "live" } : withheld(live.reason);
    }
  }
  return coverage.reason ? withheld(coverage.reason) : UNDECIDED;
}

type LiveOutcome = { ok: true } | { ok: false; reason: MirrorWithheldReason };

/**
 * One live query under ONE deadline. The deadline is enforced by racing, not by
 * cooperation: the whole step (request + folder-proof check) is `Promise.race`d
 * against a timer, and on either outcome a per-call `AbortController` is aborted so
 * no socket or filesystem walk outlives the handler. Never throws.
 */
async function runLiveQuery(
  deps: ProjectTrustDeps,
  cfg: PiTrustMirrorConfig,
  cwdKey: string,
  remote: boolean,
): Promise<LiveOutcome> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<LiveOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: "live-timeout" }), effectiveLiveQueryTimeoutMs(cfg, remote));
  });
  const work = liveWork(deps, cwdKey, remote, controller.signal).catch(
    (): LiveOutcome => ({ ok: false, reason: "live-error" }),
  );
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

function mapStatus(status: number): MirrorWithheldReason {
  if (status === 401 || status === 403) return "live-refused";
  if (status === 404) return "live-unsupported";
  if (status === 429) return "live-rate-limited";
  return "live-error";
}

async function liveWork(deps: ProjectTrustDeps, cwdKey: string, remote: boolean, signal: AbortSignal): Promise<LiveOutcome> {
  const res = await deps.liveQuery({ cwdKey, remote, signal });
  if (res.kind === "unreachable") return { ok: false, reason: "live-unreachable" };
  if (res.kind === "error") return { ok: false, reason: "live-error" };
  if (res.status !== 200) return { ok: false, reason: mapStatus(res.status) };
  const answer = parsePiTrustLiveAnswer(res.body);
  if (!answer) return { ok: false, reason: "live-error" };
  if (!answer.covered) return { ok: false, reason: "live-not-covered" };

  if (isRemoteLiveAnswer(answer)) {
    // Remote proof: recompute the digest of pi's trust-requiring resources HERE.
    const manifest = await deps.manifest(cwdKey, { home: deps.home, signal });
    if (signal.aborted) return { ok: false, reason: "live-timeout" };
    if (manifest === null) return { ok: false, reason: "identity-weak" };
    return trustResourceDigest(answer.salt, cwdKey, manifest) === answer.digest
      ? { ok: true }
      : { ok: false, reason: "identity-mismatch" };
  }
  // Local proof: the identity the server recorded when it created the live entry.
  if (!isCanonicalAbsolutePath(answer.key) || !ancestorKeys(cwdKey).includes(answer.key)) {
    return { ok: false, reason: "live-error" };
  }
  const observed = await deps.statIdentity(answer.key, signal);
  if (signal.aborted) return { ok: false, reason: "live-timeout" };
  return identityMatches(answer, observed) ? { ok: true } : { ok: false, reason: "identity-mismatch" };
}

/**
 * Read the trust-decision cwd from the `project_trust` event (authoritative)
 * or, failing that, its per-event context — defensively. The read is wrapped
 * in try/catch so a stale/replaced ctx whose `cwd` getter throws yields
 * `undefined` (→ undecided, no crash). NEVER reads a cached ctx.
 */
export function readEventCwd(event: unknown, ctx: unknown): string | undefined {
  try {
    const fromEvent = (event as { cwd?: unknown } | null | undefined)?.cwd;
    if (typeof fromEvent === "string") return fromEvent;
    const fromCtx = (ctx as { cwd?: unknown } | null | undefined)?.cwd;
    if (typeof fromCtx === "string") return fromCtx;
    return undefined;
  } catch {
    return undefined;
  }
}
