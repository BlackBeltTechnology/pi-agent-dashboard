/**
 * iMCP provisioning state machine. One traversal, two modes: write (the CLI
 * `bin`) and check (write-suppressed; backs the `--check` CLI flag, the doctor
 * probe, and the settings-panel status readout). Every side effect and probe
 * is injected so the suite runs on Linux CI without a real macOS host.
 *
 * See change: add-apple-tools-imcp-plugin (Decision 2).
 */
import {
  discoverServer,
  IMCP_BREW_CASK,
  IMCP_DOWNLOAD_URL,
  IMCP_RELATIVE,
  MIN_MACOS,
  meetsMinimum,
} from "./detect.js";
import {
  type ConfigIO,
  type ConfigWriteResult,
  ensureAdapterPackage,
  ensureMcpEntry,
} from "./mcp-config.js";

/** Closed, nine-member terminal-state enum. All three surfaces render these. */
export type TerminalState =
  | "UNSUPPORTED_PLATFORM"
  | "OS_VERSION_UNKNOWN"
  | "OS_TOO_OLD"
  | "NO_INSTALL_METHOD"
  | "INSTALL_FAILED"
  | "CONFIG_UNPARSEABLE"
  | "CONFIG_WRITE_FAILED"
  | "READY_PENDING_GRANTS"
  | "READY";

export const TERMINAL_STATES: readonly TerminalState[] = [
  "UNSUPPORTED_PLATFORM",
  "OS_VERSION_UNKNOWN",
  "OS_TOO_OLD",
  "NO_INSTALL_METHOD",
  "INSTALL_FAILED",
  "CONFIG_UNPARSEABLE",
  "CONFIG_WRITE_FAILED",
  "READY_PENDING_GRANTS",
  "READY",
];

export interface BrewResult {
  code: number;
  stderr: string;
  /** True when the invocation exceeded the timeout budget. */
  timedOut?: boolean;
}

/** Every environment interaction, injected for deterministic cross-platform tests. */
export interface InstallerEnv {
  platform: string;
  homedir: string;
  /** `sw_vers -productVersion`; null on absence / non-zero exit / empty stdout. */
  probeOsVersion: () => string | null;
  /** Existence check for a single path. */
  pathExists: (p: string) => boolean;
  /** Absolute path to `brew`, or null when not resolvable on PATH. */
  brewPath: () => string | null;
  /** Invoke `brew install --cask mattt/tap/iMCP` with an argv array + timeout. */
  runBrewCask: (brew: string) => BrewResult;
  /** Operator override for the imcp-server path (`imcpServerPath` config key). */
  overridePath?: string;
  /** Absolute path to `~/.pi/agent/mcp.json`. */
  mcpJsonPath: string;
  /** Absolute path to `~/.pi/agent/settings.json`. */
  settingsJsonPath: string;
  /** Injected config IO for the two writers. */
  configIO: ConfigIO;
}

export interface InstallResult {
  state: TerminalState;
  exitCode: number;
  message: string;
  /** Resolved imcp-server path when discovery/install succeeded. */
  resolvedPath?: string;
}

export interface RunOptions {
  /** When true, suppress every mutation (no brew, no config write). */
  check?: boolean;
}

const OK = 0;
const ERR = 1;

function fail(state: TerminalState, message: string): InstallResult {
  return { state, exitCode: ERR, message };
}

/**
 * Traverse the provisioning graph. Pure over `env`; the only mutations are the
 * brew invocation and the two config writes, both gated on `!check`.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: a provisioning state machine is intentionally branchy; each branch is one terminal state.
export function runInstaller(env: InstallerEnv, opts: RunOptions = {}): InstallResult {
  const check = opts.check === true;

  // 1. Platform gate — short-circuit before any subprocess or filesystem work.
  if (env.platform !== "darwin") {
    return {
      state: "UNSUPPORTED_PLATFORM",
      exitCode: OK,
      message: "iMCP is macOS-only; nothing to provision on this platform.",
    };
  }

  // 2. macOS version gate.
  const version = env.probeOsVersion();
  if (version === null) {
    return fail(
      "OS_VERSION_UNKNOWN",
      "Could not determine the macOS version (sw_vers unavailable or empty). No version was detected.",
    );
  }
  if (!meetsMinimum(version, MIN_MACOS)) {
    return fail(
      "OS_TOO_OLD",
      `macOS ${version} is below the minimum supported ${MIN_MACOS}. Please upgrade.`,
    );
  }

  // 3. Discover imcp-server (override-as-preference, ordered candidate list).
  let resolved = discoverServer(env.homedir, env.pathExists, env.overridePath);

  // 4. Install branch when the binary is absent.
  if (!resolved) {
    const brew = env.brewPath();
    if (!brew) {
      return fail(
        "NO_INSTALL_METHOD",
        `iMCP is not installed and Homebrew is unavailable. Install it from ${IMCP_DOWNLOAD_URL}`,
      );
    }
    if (check) {
      // Write-suppressed prediction: brew is present, so the install would
      // proceed. Report the state write-mode would reach; brew never invoked.
      resolved = `/Applications/${IMCP_RELATIVE}`;
    } else {
      const result = env.runBrewCask(brew);
      if (result.timedOut) {
        return fail(
          "INSTALL_FAILED",
          `\`brew install --cask ${IMCP_BREW_CASK}\` timed out after 10 minutes; aborted without writing any config.`,
        );
      }
      if (result.code !== 0) {
        return fail(
          "INSTALL_FAILED",
          `\`brew install --cask ${IMCP_BREW_CASK}\` failed (exit ${result.code}):\n${result.stderr}`,
        );
      }
      // Post-brew re-discovery gate: a successful cask that left no binary at
      // any candidate is a failure, NOT a config write pointing at nothing.
      resolved = discoverServer(env.homedir, env.pathExists, env.overridePath);
      if (!resolved) {
        return fail(
          "INSTALL_FAILED",
          "brew reported success but no imcp-server binary was found at any known location.",
        );
      }
    }
  }

  // 5. Config writes (suppressed in check mode).
  if (!check) {
    const mcp = ensureMcpEntry(env.configIO, env.mcpJsonPath, resolved);
    if (!mcp.ok) return relayConfigFailure(mcp);
    const pkg = ensureAdapterPackage(env.configIO, env.settingsJsonPath);
    if (!pkg.ok) return relayConfigFailure(pkg);
  } else {
    // Predict a config failure the write would hit (unparseable existing file).
    const predicted = predictConfigWritability(env);
    if (predicted) return predicted;
  }

  // 6. Terminal success. The installer never claims READY — only a live adapter
  //    round-trip (a granted tool call) can distinguish READY from pending.
  return {
    state: "READY_PENDING_GRANTS",
    exitCode: OK,
    resolvedPath: resolved,
    message:
      "iMCP provisioned. Final step (manual, unautomatable): open the iMCP menu-bar app and grant the Apple service permissions you need. Grants cannot be automated.",
  };
}

function relayConfigFailure(r: Extract<ConfigWriteResult, { ok: false }>): InstallResult {
  return fail(r.state, r.message);
}

/**
 * Check-mode dry predicate: reports the same CONFIG_UNPARSEABLE a real write
 * would hit, without touching disk. Only unparseable is predictable without a
 * write attempt; write-permission failures are not simulated in check mode.
 */
function predictConfigWritability(env: InstallerEnv): InstallResult | null {
  for (const path of [env.mcpJsonPath, env.settingsJsonPath]) {
    const raw = env.configIO.readFile(path);
    if (raw === null || raw.trim() === "") continue;
    try {
      const val = JSON.parse(raw);
      if (val === null || typeof val !== "object" || Array.isArray(val)) {
        return fail("CONFIG_UNPARSEABLE", `${path} is not a JSON object`);
      }
    } catch (e) {
      return fail("CONFIG_UNPARSEABLE", `${path} contains invalid JSON: ${(e as Error).message}`);
    }
  }
  return null;
}
