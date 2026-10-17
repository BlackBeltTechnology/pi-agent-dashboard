/**
 * `project_trust` auto-decision — the bridge's snapshot-only decision.
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
 * reading rules) and the snapshot are read per event, never cached. Everything
 * doubtful is `undecided`. A recorded pi entry (true OR false) always wins, and
 * forbidden/temporary folders never auto-trust. Pure decision logic lives here
 * (deps injected) so it is unit-testable without the bridge.
 *
 * pi emits `project_trust` during resource-loader reload, BEFORE `session_start`,
 * so the activation cwd is captured at bridge module scope.
 *
 * See change: adopt-pi-074-080-features (A.3), mirror-dashboard-trust-to-pi.
 */
import os from "node:os";
import type { PiTrustMirrorConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { resolvePiAgentDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import { isMirrorDenied, type MirrorDenyRules, mirrorDenyRules } from "@blackbelt-technology/pi-dashboard-shared/pi-trust-mirror.js";
import {
  coverSnapshot,
  nearestRecordedEntry,
  type PiTrustFileRead,
  readPiTrustFileLockless,
  readPiTrustMirrorSnapshot,
  safePiTrustKey,
} from "@blackbelt-technology/pi-dashboard-shared/pi-trust-mirror-snapshot.js";
import type { MirrorWithheldReason, PiTrustSnapshot } from "@blackbelt-technology/pi-dashboard-shared/pi-trust-mirror-types.js";

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
}

export interface ProjectTrustResult {
  trusted: "yes" | "undecided";
  /** Why trust was withheld (undecided only). */
  reason?: MirrorWithheldReason;
  /** Which rule granted "yes". */
  via?: "activation" | "mirror";
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
  };
}

/**
 * Decide `project_trust` for one event. Never throws: any error → undecided.
 * Order: unreadable store → recorded pi entry → activation rule → mirror rule.
 */
export function decideBridgeProjectTrust(
  input: ProjectTrustDecisionInput,
  overrides: Partial<ProjectTrustDeps> = {},
): ProjectTrustResult {
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
    return decideFromMirror(input, deps, cwdKey, withheld);
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

/** The snapshot rule: enabled, covered by a still-valid entry, and an allowed session class. */
function decideFromMirror(
  input: ProjectTrustDecisionInput,
  deps: ProjectTrustDeps,
  cwdKey: string,
  withheld: (reason: MirrorWithheldReason) => ProjectTrustResult,
): ProjectTrustResult {
  const cfg = deps.readConfig();
  if (!cfg.enabled) return UNDECIDED;
  const coverage = coverSnapshot(deps.readSnapshot(), cwdKey);
  if (!coverage.covered) return coverage.reason ? withheld(coverage.reason) : UNDECIDED;
  if ((input.dashboardSpawned && input.isHeadless) || cfg.coverInteractive) return { trusted: "yes", via: "mirror" };
  // Covered, but this session class is not: say so.
  if (input.dashboardSpawned) deps.log(`project_trust withheld for ${cwdKey}: not-covered-session`);
  return { trusted: "undecided", reason: "not-covered-session" };
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
