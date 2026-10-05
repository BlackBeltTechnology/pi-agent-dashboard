/**
 * One-time removal of the `pi-dashboard` entry earlier builds provisioned into
 * the Pi-global `mcp.json` (migrate-mcp-to-pi-builtin D2).
 *
 * Why it must go: pi's built-in MCP gives an `mcp.json` entry PRECEDENCE over
 * a `pi.registerMcpServer()` registration of the same name, and the old entry
 * carries no `Authorization` header (its credential came from the
 * adapter-only `requestHeadersCommand`), so pi would treat it as an OAuth
 * server and the bridge's per-session registration would never apply.
 *
 * Only the dashboard-owned shape is removed — `requestHeadersCommand.command
 * === "node"` with `args[0]` ending in `header-command.mjs`. An operator entry
 * of the same name is kept and reported (it shadows the registration). The
 * write goes through the `mcp-client` writer factory (a package dependency,
 * not a manifest `dependsOn`): merge-only, atomic, and it never writes over a
 * file pi cannot parse. Idempotent; no marker file.
 *
 * See change: migrate-mcp-to-pi-builtin (D2).
 */

import {
  type ConfigIO,
  createMcpClientConfigService,
  type LayerPaths,
} from "@blackbelt-technology/pi-dashboard-mcp-client-plugin/core";

/** The reserved key; also the name the bridge registers with pi. */
export const DASHBOARD_MCP_KEY = "pi-dashboard";

export type MigrationResult =
  | { action: "absent"; path: string }
  | { action: "removed"; path: string }
  | { action: "kept-operator-entry"; path: string }
  | { action: "skipped-unparseable"; path: string; message: string }
  | { action: "failed"; path: string; message: string; ioCode?: string };

/** The signature of the entry earlier dashboard builds wrote. */
export function isProvisionedDashboardEntry(entry: unknown): boolean {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
  const rhc = (entry as { requestHeadersCommand?: unknown }).requestHeadersCommand;
  if (typeof rhc !== "object" || rhc === null) return false;
  const { command, args } = rhc as { command?: unknown; args?: unknown };
  return (
    command === "node" &&
    Array.isArray(args) &&
    typeof args[0] === "string" &&
    /(^|[\\/])header-command\.mjs$/.test(args[0])
  );
}

export function migrateProvisionedEntry(configIO: ConfigIO, opts: { paths?: LayerPaths } = {}): MigrationResult {
  const service = createMcpClientConfigService({
    configIO,
    knownCwds: () => [],
    ...(opts.paths ? { paths: opts.paths } : {}),
  });
  const scope = { kind: "global" } as const;
  const path = service.targetPath(scope);
  const status = service.checkConfigFiles().mcpJson;
  if (!status.ok) {
    return { action: "skipped-unparseable", path, message: status.message ?? "not strict JSON" };
  }
  const entry = service.readServerEntry(DASHBOARD_MCP_KEY, scope);
  if (entry === undefined) return { action: "absent", path };
  if (!isProvisionedDashboardEntry(entry)) return { action: "kept-operator-entry", path };
  const r = service.removeServer(DASHBOARD_MCP_KEY, scope);
  if (r.ok) return { action: "removed", path };
  return {
    action: "failed",
    path,
    message: r.refusal.message,
    ...(r.refusal.ioCode ? { ioCode: r.refusal.ioCode } : {}),
  };
}

/** One log line per outcome; never throws. */
export function logMigration(
  result: MigrationResult,
  logger: { info: (m: string) => void; warn: (m: string) => void },
): void {
  switch (result.action) {
    case "absent":
      return;
    case "removed":
      logger.info(`mcp-server: removed the legacy provisioned "${DASHBOARD_MCP_KEY}" entry from ${result.path}`);
      return;
    case "kept-operator-entry":
      logger.warn(
        `mcp-server: ${result.path} defines its own "${DASHBOARD_MCP_KEY}" MCP server; pi prefers it over the dashboard's per-session registration, so dashboard MCP tools use that entry instead`,
      );
      return;
    case "skipped-unparseable":
      logger.warn(
        `mcp-server: ${result.path} is not strict JSON (pi skips the whole file); the legacy "${DASHBOARD_MCP_KEY}" entry was not checked: ${result.message}`,
      );
      return;
    case "failed":
      logger.warn(
        `mcp-server: could not remove the legacy "${DASHBOARD_MCP_KEY}" entry from ${result.path} (${result.ioCode ?? "write-failed"}): ${result.message}`,
      );
      return;
  }
}
