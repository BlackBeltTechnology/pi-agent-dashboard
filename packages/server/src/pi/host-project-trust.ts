/**
 * `host.isProjectTrusted(cwd)` — the plugin host service mirroring how a pi
 * SESSION decides project trust (`ctx.isProjectTrusted()`), through the ONE shared
 * folder decision (`decidePiTrust`): implicit trust (no trust-requiring project
 * resources, pi's own function) → pi's nearest recorded entry (true or false, read
 * from the trust store of the agent dir IN USE) → durable dashboard trust from the
 * snapshot (same bytes + rules as the bridge; overrides `defaultProjectTrust`,
 * including `never`) → `defaultProjectTrust` (`always` trusts; `ask`/`never` do not).
 * NOT the dashboard's toggle-trust policy (`resource-toggle-trust.ts`), which gates
 * writes rather than reads. Nothing here writes pi's `trust.json`.
 *
 * Consumed by the mcp-client plugin to decide whether `<cwd>/.pi/mcp.json` is
 * active. Synchronous because the service contract is; pi's classes are resolved
 * once at boot (`loadHostProjectTrust`). A pi that cannot be resolved reads every
 * project as untrusted (the safe answer) — and says so, once, in the log.
 *
 * See change: migrate-mcp-to-pi-builtin (D3 "Trust"), mirror-dashboard-trust-to-pi.
 */

import os from "node:os";
import { loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { resolvePiAgentDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import {
  type DefaultProjectTrust,
  decidePiTrust,
  type PiTrustDecision,
  type PiTrustSource,
} from "@blackbelt-technology/pi-dashboard-shared/pi-trust-mirror.js";
import {
  coverSnapshot,
  readPiTrustMirrorSnapshot,
  safePiTrustKey,
} from "@blackbelt-technology/pi-dashboard-shared/pi-trust-mirror-snapshot.js";
import type { MirrorSourceKind } from "@blackbelt-technology/pi-dashboard-shared/pi-trust-mirror-types.js";
import { getPiCore } from "./pi-resource-activation.js";

export type { DefaultProjectTrust };

export interface HostProjectTrustDeps {
  /** pi's own `hasTrustRequiringProjectResources(cwd)`. */
  hasTrustRequiringResources: (cwd: string) => boolean;
  /** pi's nearest recorded entry (true or false) for `cwd`, or null. Throws → fail closed. */
  recordedEntry: (cwd: string) => { path: string; decision: boolean } | null;
  defaultProjectTrust: () => DefaultProjectTrust;
  /** Durable dashboard trust. Absent → none (mirror off). */
  mirror?: {
    enabled: () => boolean;
    covering: (cwd: string) => { sourceKind: MirrorSourceKind; key: string } | null;
  };
}

export interface HostProjectTrustService {
  isProjectTrusted: (cwd: string) => boolean;
  /** Who decided (for the MCP effective view); `undefined` when the decision itself failed. */
  projectTrustSource: (cwd: string) => PiTrustSource | undefined;
  decide: (cwd: string) => PiTrustDecision | undefined;
}

/** The shared decision with every failure mapped to "untrusted, source unknown". */
export function createHostProjectTrustService(deps: HostProjectTrustDeps): HostProjectTrustService {
  const decide = (cwd: string): PiTrustDecision | undefined => {
    try {
      const hasTrustRequiringResources = deps.hasTrustRequiringResources(cwd);
      // An unreadable store (lock held, corrupt file) must not fall through to
      // `defaultProjectTrust: always` over an explicit "do not trust".
      const recordedEntry = hasTrustRequiringResources ? deps.recordedEntry(cwd) : null;
      const mirrorEnabled = deps.mirror?.enabled() === true;
      return decidePiTrust({
        hasTrustRequiringResources,
        recordedEntry,
        mirrorEnabled,
        mirrorEntry: mirrorEnabled && !recordedEntry ? (deps.mirror?.covering(cwd) ?? null) : null,
        piDefault: recordedEntry || !hasTrustRequiringResources ? "ask" : deps.defaultProjectTrust(),
      });
    } catch {
      return undefined;
    }
  };
  return {
    decide,
    isProjectTrusted: (cwd) => decide(cwd)?.trusted === true,
    projectTrustSource: (cwd) => decide(cwd)?.source,
  };
}

/**
 * Legacy shape (recorded decision + default only): kept for callers and tests that
 * predate the shared decision. A cwd is treated as having trust-requiring resources.
 */
export interface HostProjectTrustLegacyDeps {
  /** The recorded decision for `cwd` (nearest ancestor), or null when none. */
  recordedDecision: (cwd: string) => boolean | null;
  defaultProjectTrust: () => DefaultProjectTrust;
}

export function createHostProjectTrust(deps: HostProjectTrustLegacyDeps): (cwd: string) => boolean {
  return createHostProjectTrustService({
    hasTrustRequiringResources: () => true,
    recordedEntry: (cwd) => {
      const recorded = deps.recordedDecision(cwd);
      return recorded === null ? null : { path: cwd, decision: recorded };
    },
    defaultProjectTrust: deps.defaultProjectTrust,
  }).isProjectTrusted;
}

/**
 * The durable dashboard-trust entry covering `cwd` (snapshot bytes + the bridge's
 * rules), or null — also null when the mirror is disabled. Shared by the host
 * predicate and the resource-toggle gate. Never throws.
 */
export function coveringDashboardEntry(
  cwd: string,
  home: string = os.homedir(),
): { sourceKind: MirrorSourceKind; key: string } | null {
  try {
    if (!loadConfig().piTrustMirror.enabled) return null;
    const key = safePiTrustKey(cwd, home);
    if (key === null) return null;
    const coverage = coverSnapshot(readPiTrustMirrorSnapshot(), key);
    return coverage.covered ? { sourceKind: coverage.entry.sourceKind, key: coverage.entry.key } : null;
  } catch {
    return null;
  }
}

export interface LoadHostProjectTrustOptions {
  /** Test seam: pi core resolution. */
  getCore?: typeof getPiCore;
  /** Test seam: log sink for the one boot-time fallback line. */
  log?: (line: string) => void;
  home?: string;
}

/** Resolve pi's trust store + settings once; unresolvable pi → always untrusted (logged once). */
export async function loadHostProjectTrustService(
  agentDirOverride?: string,
  opts: LoadHostProjectTrustOptions = {},
): Promise<HostProjectTrustService> {
  const log = opts.log ?? ((line: string) => console.warn(line));
  const home = opts.home ?? os.homedir();
  // The agent dir is resolved per call so `PI_CODING_AGENT_DIR` is honoured like pi does.
  const agentDir = (): string => agentDirOverride ?? resolvePiAgentDir();
  try {
    const { ProjectTrustStore, SettingsManager, hasTrustRequiringProjectResources } = await (opts.getCore ?? getPiCore)();
    return createHostProjectTrustService({
      hasTrustRequiringResources: (cwd) => hasTrustRequiringProjectResources(cwd),
      // A fresh store per call: the decision file changes when the operator
      // trusts a folder in pi, and the read is a small JSON file.
      recordedEntry: (cwd) => {
        const store = new ProjectTrustStore(agentDir()) as {
          getEntry?: (cwd: string) => { path: string; decision: boolean } | null;
          get: (cwd: string) => boolean | null;
        };
        if (typeof store.getEntry === "function") return store.getEntry(cwd);
        const decision = store.get(cwd);
        return decision === null ? null : { path: cwd, decision };
      },
      // `defaultProjectTrust` is a global setting; no project layer is read.
      defaultProjectTrust: () =>
        SettingsManager.create(home, agentDir(), { projectTrusted: false }).getDefaultProjectTrust(),
      mirror: {
        enabled: () => loadConfig().piTrustMirror.enabled,
        covering: (cwd) => coveringDashboardEntry(cwd, home),
      },
    });
  } catch (err) {
    // Not silent: every folder now reads as untrusted, which explains an MCP page
    // saying "not trusted" for a folder pi itself would trust.
    log(`[host-project-trust] pi core could not be resolved; every project reads as untrusted: ${(err as Error)?.message ?? String(err)}`);
    return createHostProjectTrustService({
      hasTrustRequiringResources: () => {
        throw new Error("pi unresolved");
      },
      recordedEntry: () => null,
      defaultProjectTrust: () => "ask",
    });
  }
}

/** Boolean predicate form (the `host.isProjectTrusted` plugin service). */
export async function loadHostProjectTrust(
  agentDir?: string,
  opts?: LoadHostProjectTrustOptions,
): Promise<(cwd: string) => boolean> {
  return (await loadHostProjectTrustService(agentDir, opts)).isProjectTrusted;
}
