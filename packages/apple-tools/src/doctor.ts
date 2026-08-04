/**
 * Doctor probe for iMCP provisioning. Derives its verdict from the SAME
 * write-suppressed checker the CLI `--check` and the settings panel use, so all
 * surfaces agree. Read-only: it never writes config and never installs.
 *
 * See change: add-apple-tools-imcp-plugin.
 */
import { type InstallerEnv, runInstaller, type TerminalState } from "./install.js";

export interface DoctorProbeResult {
  /** Whether the apple-tools package itself is present on the host. */
  packagePresent: boolean;
  /** Whether the platform supports iMCP at all (macOS). */
  supported: boolean;
  /** Terminal provisioning state (identical vocabulary to the CLI). */
  state: TerminalState;
  /**
   * Whether the operator must act. Always false on a non-macOS host — an
   * unsupported platform is not a fault to remediate (#X19).
   */
  requiresRemediation: boolean;
}

const HEALTHY: readonly TerminalState[] = ["READY", "READY_PENDING_GRANTS"];

/**
 * Run the read-only provisioning probe. `packagePresent` is injected by the
 * caller (the doctor skill), which knows whether apple-tools is installed.
 */
export function doctorProbe(env: InstallerEnv, packagePresent: boolean): DoctorProbeResult {
  const result = runInstaller(env, { check: true });
  const supported = env.platform === "darwin";
  return {
    packagePresent,
    supported,
    state: result.state,
    // Non-macOS is never a remediation item; a healthy state needs no action.
    requiresRemediation: supported && !HEALTHY.includes(result.state),
  };
}
