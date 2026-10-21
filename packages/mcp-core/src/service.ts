/**
 * mcp-client-plugin · `mcp-client.config` service factory.
 *
 * Composes the writer, the effective-view reader and (optionally) the
 * `pi mcp list` live-state reader behind the in-process service contract
 * other plugins consume. A hostless caller (the apple-tools CLI) gets the
 * identical implementation from this factory; without an `isProjectTrusted`
 * predicate every project counts as untrusted.
 *
 * See change: migrate-mcp-to-pi-builtin (D3); earlier: extract-mcp-client-plugin (D4).
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfigWriter } from "./config-writer.js";
import { createEffectiveViewReader } from "./effective-view.js";
import { defaultLayerPaths, type LayerPaths } from "./layers.js";
import { createLiveStateReader } from "./live-state.js";
import type { ConfigIO, LiveState, McpClientConfigService, PiMcpListRunner, ProjectTrustSource, Scope } from "./types.js";

export interface McpClientConfigServiceDeps {
  configIO: ConfigIO;
  knownCwds: () => string[];
  /** pi's project-trust rule (`host.isProjectTrusted`). Absent → untrusted. */
  isProjectTrusted?: (cwd: string) => boolean;
  /**
   * Who decided the trust (`host.projectTrustSource`). Absent → the view omits the
   * source and a dashboard-only trust cannot be told apart (no "not checked by pi").
   */
  projectTrustSource?: (cwd: string) => ProjectTrustSource | undefined;
  /** `piTrustMirror.coverInteractive` (for the folder page's scope sentence). */
  coverInteractive?: () => boolean;
  /**
   * Trust by pi alone (ignores dashboard trust) — decides which GLOBAL writes
   * collide with a folder entry, so dashboard trust never changes that set.
   * Absent → derived from `isProjectTrusted` + `projectTrustSource`.
   */
  isProjectTrustedByPi?: (cwd: string) => boolean;
  /** Layer paths. Defaults to `$PI_CODING_AGENT_DIR/mcp.json` + `<cwd>/.pi/mcp.json`. */
  paths?: LayerPaths;
  /** Runs `pi mcp list --json`. Absent → live state reports `spawn-failed`. */
  runner?: PiMcpListRunner;
  /** Always-empty dir the global live-state list runs in. Defaults to a fresh mkdtemp. */
  scratchCwd?: string;
  liveTimeoutMs?: number;
  liveCacheTtlMs?: number;
}

/** The provided service plus the live-state reader the HTTP layer needs. */
export interface McpClientRuntime extends McpClientConfigService {
  getLiveState(scope: Scope, opts?: { fresh?: boolean }): Promise<LiveState>;
}

/** Live state of a folder server trusted only by the dashboard. */
export const NOT_CHECKED_BY_PI = "not-checked-by-pi";
export const DASHBOARD_ONLY_NOTE =
  "This folder is trusted by the dashboard only: running `pi mcp list` here (outside the dashboard) reports its servers as not loaded, because that command reads only pi's own trust store.";

/** A source that is not pi's own decision (dashboard trust is not pi trust). */
function trustedByPiOnly(deps: McpClientConfigServiceDeps): ((cwd: string) => boolean) | undefined {
  if (deps.isProjectTrustedByPi) return deps.isProjectTrustedByPi;
  const trusted = deps.isProjectTrusted;
  if (!trusted) return undefined;
  const source = deps.projectTrustSource;
  return (cwd) => trusted(cwd) && source?.(cwd)?.kind !== "dashboard";
}

export function createMcpClientConfigService(deps: McpClientConfigServiceDeps): McpClientRuntime {
  const paths = deps.paths ?? defaultLayerPaths();
  const piOnly = trustedByPiOnly(deps);
  const writer = createConfigWriter({
    configIO: deps.configIO,
    paths,
    knownCwds: deps.knownCwds,
    // Global-write collisions keep pi-only trust: dashboard trust never changes them.
    ...(piOnly ? { isProjectTrusted: piOnly } : {}),
  });
  const viewReader = createEffectiveViewReader({
    configIO: deps.configIO,
    paths,
    ...(deps.isProjectTrusted ? { isProjectTrusted: deps.isProjectTrusted } : {}),
    ...(deps.projectTrustSource ? { projectTrustSource: deps.projectTrustSource } : {}),
    ...(deps.coverInteractive ? { coverInteractive: deps.coverInteractive } : {}),
  });
  const runner: PiMcpListRunner =
    deps.runner ?? (() => Promise.reject(new Error("no pi mcp list runner configured")));
  const live = createLiveStateReader({
    runner,
    ...(deps.liveTimeoutMs !== undefined ? { timeoutMs: deps.liveTimeoutMs } : {}),
    ...(deps.liveCacheTtlMs !== undefined ? { cacheTtlMs: deps.liveCacheTtlMs } : {}),
  });
  let scratch = deps.scratchCwd;
  const scratchCwd = (): string => {
    scratch ??= mkdtempSync(join(tmpdir(), "pi-mcp-client-"));
    return scratch;
  };

  return {
    targetPath: (scope) => writer.targetPath(scope),
    readServerEntry: (name, scope) => writer.readServerEntry(name, scope),
    getEffectiveView: (scope) => viewReader.getEffectiveView(scope),
    ensureServerEntry: (name, fields, scope) => writer.ensureServerEntry(name, fields, scope),
    saveServer: (name, entry, scope, opts) => writer.saveServer(name, entry, scope, opts),
    removeServer: (name, scope) => writer.removeServer(name, scope),
    setEnabled: (name, enabled, scope) => writer.setEnabled(name, enabled, scope),
    setProjectOverride: (name, patch, scope) => writer.setProjectOverride(name, patch, scope),
    convertLegacyCopy: (name, scope) => writer.convertLegacyCopy(name, scope),
    convertAdapterLeftovers: (name, scope) => writer.convertAdapterLeftovers(name, scope),

    checkConfigFiles(opts) {
      const path = paths.globalPath();
      let mcpJson = writer.readParseStatus(path);
      // A dry run of the ensure the caller is about to perform, so check mode
      // and write mode agree on the refusal.
      if (mcpJson.ok && opts?.serverName !== undefined) {
        const refusal = writer.previewEnsure(opts.serverName, opts.fields ?? {}, { kind: "global" });
        if (refusal) mcpJson = { path, ok: false, message: refusal.message };
      }
      return { mcpJson };
    },

    getLiveState(scope, opts) {
      const cwd = scope.kind === "project" ? scope.cwd : scratchCwd();
      if (scope.kind === "project") writer.targetPath(scope); // admission
      const read = live.read(cwd, opts);
      if (scope.kind !== "project" || deps.projectTrustSource?.(cwd)?.kind !== "dashboard") return read;
      // Trusted ONLY by the dashboard: `pi mcp list` reads just pi's own trust store
      // (no approve flag), so it reports the folder's servers as not loaded. Report
      // them as "not checked by pi" instead of disconnected.
      return read.then((r) => {
        if (!r.ok) return r;
        const servers = { ...r.servers };
        for (const s of viewReader.getEffectiveView(scope).servers) {
          if (s.provenance === "pi-folder" && s.active) servers[s.name] = { state: NOT_CHECKED_BY_PI, tools: 0 };
        }
        return { ...r, servers, note: DASHBOARD_ONLY_NOTE };
      });
    },
  };
}
