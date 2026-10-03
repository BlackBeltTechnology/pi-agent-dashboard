/**
 * `host.isProjectTrusted(cwd)` — the plugin host service mirroring how a pi
 * SESSION decides project trust (`ctx.isProjectTrusted()`): the decision
 * recorded in pi's `ProjectTrustStore` (nearest ancestor wins) when there is
 * one, else the `defaultProjectTrust` setting (`always` → trusted; `ask` /
 * `never` → untrusted). NOT the dashboard's toggle-trust policy
 * (`resource-toggle-trust.ts`), which gates writes rather than reads.
 *
 * Consumed by the mcp-client plugin to decide whether `<cwd>/.pi/mcp.json`
 * is active. Synchronous because the service contract is; pi's classes are
 * resolved once at boot (`loadHostProjectTrust`) and a pi that cannot be
 * resolved reads every project as untrusted (the safe answer).
 *
 * See change: migrate-mcp-to-pi-builtin (D3 "Trust").
 */

import os from "node:os";
import { AGENT_DIR, getPiCore } from "./pi-resource-activation.js";

export type DefaultProjectTrust = "always" | "never" | "ask";

export interface HostProjectTrustDeps {
  /** The recorded decision for `cwd` (nearest ancestor), or null when none. */
  recordedDecision: (cwd: string) => boolean | null;
  defaultProjectTrust: () => DefaultProjectTrust;
}

export function createHostProjectTrust(deps: HostProjectTrustDeps): (cwd: string) => boolean {
  return (cwd) => {
    let recorded: boolean | null;
    try {
      recorded = deps.recordedDecision(cwd);
    } catch {
      // An unreadable store (lock held, corrupt file) must not fall through to
      // `defaultProjectTrust: always` over an explicit "do not trust".
      return false;
    }
    if (recorded !== null) return recorded;
    try {
      return deps.defaultProjectTrust() === "always";
    } catch {
      return false;
    }
  };
}

/** Resolve pi's trust store + settings once; unresolvable pi → always untrusted. */
export async function loadHostProjectTrust(agentDir: string = AGENT_DIR): Promise<(cwd: string) => boolean> {
  try {
    const { ProjectTrustStore, SettingsManager } = await getPiCore();
    return createHostProjectTrust({
      // A fresh store per call: the decision file changes when the operator
      // trusts a folder in pi, and the read is a small JSON file.
      recordedDecision: (cwd) => new ProjectTrustStore(agentDir).get(cwd),
      // `defaultProjectTrust` is a global setting; no project layer is read.
      defaultProjectTrust: () =>
        SettingsManager.create(os.homedir(), agentDir, { projectTrusted: false }).getDefaultProjectTrust(),
    });
  } catch {
    return () => false;
  }
}
