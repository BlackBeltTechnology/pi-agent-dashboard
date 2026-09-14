/**
 * Provisions the dashboard's own entry into the Pi-global `mcp.json` so a local
 * pi session can reach `/mcp` (design.md Decision 5, Decision 11).
 *
 * The read → merge-one-key → atomic-write discipline now lives in the
 * `mcp-client` plugin's `./core` (`createMcpClientConfigService`); this module
 * owns only the dashboard's collision policy for its reserved key. It is a
 * package dependency, NOT a manifest `dependsOn` — provisioning degrades
 * gracefully and must not gate plugin load.
 *
 * TWO traps this module exists to avoid.
 *
 * 1. **The legacy-default trap.** Per the `pi-mcp-adapter` 2.20.0 changelog,
 *    "Legacy remains the default." An entry written WITHOUT `protocolVersion`
 *    gets the legacy handshake — `initialize` plus `Mcp-Session-Id` — against a
 *    server that is spec-bound to ignore both. The failure would look like a
 *    handshake timeout rather than a config mistake, so `protocolVersion` is
 *    never omitted (J2).
 *
 * 2. **The wrong-shape trap.** `ensureMcpEntry` writes a stdio `command` entry
 *    for iMCP. This endpoint is HTTP and must be declared by `url` (J1).
 *
 * See change: extract-mcp-client-plugin (task 6.2).
 */

import { fileURLToPath } from "node:url";
import {
  type AdapterPort,
  type ConfigIO,
  createMcpClientConfigService,
} from "@blackbelt-technology/pi-dashboard-mcp-client-plugin/core";

export type { ConfigIO };

/**
 * The reserved key (Decision 11). Namespaced by product so it cannot collide
 * with `iMCP` or a future provisioner.
 */
export const DASHBOARD_MCP_KEY = "pi-dashboard";

/** Pinned rather than "auto": this server serves exactly one revision. */
export const PROVISIONED_PROTOCOL_VERSION = "2026-07-28";

/**
 * The env var carrying the per-session credential (design.md D2). The bridge
 * extension assigns the minted plaintext to it in the pi process's own
 * environment; the entry's `env` slot below re-declares it so the adapter's
 * per-request interpolation resolves the LIVE value, never a snapshot.
 */
export const MCP_TOKEN_ENV_VAR = "PI_DASHBOARD_MCP_TOKEN";

/**
 * Absolute path of the header command this package ships. Resolved from this
 * module's own URL, so it is correct wherever the plugin is installed (global
 * npm, worktree, Electron bundle) — the pi process and this server share the
 * machine in the local path this entry serves.
 */
export function headerCommandPath(): string {
  return fileURLToPath(new URL("./header-command.mjs", import.meta.url));
}

export type ProvisionResult =
  | { ok: true; action: "created" | "updated" | "unchanged" }
  | {
      ok: false;
      state: "CONFIG_UNPARSEABLE" | "CONFIG_WRITE_FAILED" | "FOREIGN_ENTRY";
      message: string;
    };

export interface DashboardMcpEntry {
  url: string;
  protocolVersion: typeof PROVISIONED_PROTOCOL_VERSION;
  /**
   * The per-session credential transport (design.md D2). The command echoes
   * `{"Authorization": "Bearer …"}` read from ITS OWN environment — the env
   * value is the interpolation form, so no credential ever lands in this file
   * (E9: no literal `mcp_` value at rest) and none rides in argv (spike Q1b).
   * `args` carries only a plain path: every interpolation form there resolves
   * to "" via the adapter's `Array.map` env-overload bug (spike Q1a).
   */
  requestHeadersCommand: {
    command: "node";
    args: [string];
    env: Record<string, string>;
  };
}

export function buildDashboardEntry(url: string): DashboardMcpEntry {
  return {
    url,
    protocolVersion: PROVISIONED_PROTOCOL_VERSION,
    requestHeadersCommand: {
      command: "node",
      args: [headerCommandPath()],
      env: { [MCP_TOKEN_ENV_VAR]: `\${${MCP_TOKEN_ENV_VAR}}` },
    },
  };
}

export interface ProvisionOptions {
  url: string;
  /**
   * The adapter port the config service resolves paths through. Injected for
   * tests (a temp-dir stub); the default is the worker-thread port over the
   * real `pi-mcp-adapter/config`, so `PI_CODING_AGENT_DIR` is honoured.
   */
  adapter?: AdapterPort;
}

/** An entry is "ours" iff it is an object declaring an HTTP `url`. */
function isDashboardHttpEntry(v: unknown): boolean {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    typeof (v as { url?: unknown }).url === "string"
  );
}

/**
 * Write (or refresh) the dashboard entry.
 *
 * Collision policy for the reserved key, per Decision 11:
 *   - absent                      → create
 *   - present AND declares a url  → overwrite (ours; the port may have moved)
 *   - present, any other shape    → REFUSE the whole write, file untouched
 *
 * The refusal is deliberately total rather than "write the other keys anyway":
 * a partial write against a config we do not understand is exactly the silent
 * clobber J6 forbids.
 */
export function provisionDashboardEntry(
  configIO: ConfigIO,
  opts: ProvisionOptions,
): ProvisionResult {
  const service = createMcpClientConfigService({
    configIO,
    knownCwds: () => [],
    ...(opts.adapter ? { adapter: opts.adapter } : {}),
  });
  const scope = { kind: "global" } as const;
  const path = service.targetPath(scope);

  // Parse gate: the writer's own read status, so a present-but-unparseable file
  // is refused (with the path in the message) rather than treated as absent.
  const status = service.checkConfigFiles();
  if (!status.mcpJson.ok) {
    const detail = status.mcpJson.message ?? "unparseable";
    return {
      ok: false,
      state: "CONFIG_UNPARSEABLE",
      message: detail.includes(path) ? detail : `${path}: ${detail}`,
    };
  }

  // File-only read of the Pi-global layer — never the adapter merge.
  const existing = service.readServerEntry(DASHBOARD_MCP_KEY, scope);

  if (existing !== undefined && !isDashboardHttpEntry(existing)) {
    return {
      ok: false,
      state: "FOREIGN_ENTRY",
      message: `${path}: mcpServers["${DASHBOARD_MCP_KEY}"] exists but is not a dashboard HTTP entry; refusing to overwrite it`,
    };
  }

  const entry = buildDashboardEntry(opts.url);
  if (existing !== undefined && JSON.stringify(existing) === JSON.stringify(entry)) {
    return { ok: true, action: "unchanged" };
  }

  // Merge-only: an operator-added `disabled`/`headers`/unknown key on our entry
  // survives the refresh; `ensureServerEntry` only sets url + protocolVersion.
  const write = service.ensureServerEntry(DASHBOARD_MCP_KEY, entry, scope);
  if (!write.ok) {
    return {
      ok: false,
      state: write.refusal.code === "write-failed" ? "CONFIG_WRITE_FAILED" : "CONFIG_UNPARSEABLE",
      message: write.refusal.message,
    };
  }
  return { ok: true, action: existing === undefined ? "created" : "updated" };
}
