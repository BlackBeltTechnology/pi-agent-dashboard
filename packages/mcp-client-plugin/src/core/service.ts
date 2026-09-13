/**
 * mcp-client-plugin · `mcp-client.config` service factory.
 *
 * Composes the merge-only writer, the effective-view reader, and the adapter
 * verdict probe behind the in-process service contract other plugins consume.
 * The scratch directory used for global-scope adapter merges is created once
 * per service and always empty.
 *
 * See change: extract-mcp-client-plugin (design D4).
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAdapterVerdictProbe } from "./adapter-verdict.js";
import { createDefaultAdapterPort } from "./adapter-worker.js";
import { createConfigWriter } from "./config-writer.js";
import { createEffectiveViewReader, type EffectiveView } from "./effective-view.js";
import type {
  AdapterPort,
  ConfigIO,
  McpClientConfigService,
  Scope,
  ServerEntry,
} from "./types.js";

export interface McpClientConfigServiceDeps {
  configIO: ConfigIO;
  knownCwds: () => string[];
  /** Defaults to the worker-thread port over the real `pi-mcp-adapter/config`. */
  adapter?: AdapterPort;
  /** Always-empty scratch dir for global merges. Defaults to a fresh mkdtemp. */
  scratchCwd?: string;
  verdictTtlMs?: number;
}

/** The provided service plus the effective-view reader the HTTP layer needs. */
export interface McpClientRuntime extends McpClientConfigService {
  getEffectiveView(scope: Scope, opts?: { timeoutMs?: number }): Promise<EffectiveView>;
}

export function createMcpClientConfigService(deps: McpClientConfigServiceDeps): McpClientRuntime {
  const scratchCwd = deps.scratchCwd ?? mkdtempSync(join(tmpdir(), "pi-mcp-client-"));
  const adapter = deps.adapter ?? createDefaultAdapterPort();
  const writer = createConfigWriter({
    configIO: deps.configIO,
    adapter,
    knownCwds: deps.knownCwds,
    scratchCwd,
  });
  const viewReader = createEffectiveViewReader({ configIO: deps.configIO, adapter, scratchCwd });
  const probe = createAdapterVerdictProbe({
    configIO: deps.configIO,
    adapter,
    ...(deps.verdictTtlMs !== undefined ? { ttlMs: deps.verdictTtlMs } : {}),
  });

  return {
    adapterVerdict: (opts) => probe.adapterVerdict(opts),

    readServerEntry(name: string, scope: Scope): ServerEntry | undefined {
      const r = writer.readServerEntry(name, scope);
      return r.ok ? r.entry : undefined;
    },

    ensureServerEntry(name, fields, scope) {
      return writer.ensureServerEntry(name, fields, scope);
    },

    setServerDisabled(name, disabled, scope, opts) {
      return writer.setServerDisabled(name, disabled, scope, opts);
    },

    setDirectTools(name, tools, scope) {
      return writer.setDirectTools(name, tools, scope);
    },

    removeServer(name, scope) {
      return writer.removeServer(name, scope);
    },

    ensureAdapterPackage() {
      return writer.ensureAdapterPackage();
    },

    checkConfigFiles(opts) {
      const mcpPath = adapter.getPiGlobalConfigPath();
      const settingsJson = writer.readParseStatus(writer.settingsJsonPath());
      let mcpJson = writer.readParseStatus(mcpPath);
      // A dry run of the ensure the caller is about to perform, so check mode
      // and write mode agree on the refusal (E39).
      if (mcpJson.ok && opts?.serverName !== undefined) {
        const refusal = writer.previewEnsure(opts.serverName, opts.fields ?? {}, { kind: "global" });
        if (refusal) mcpJson = { path: mcpPath, ok: false, message: refusal.message };
      }
      return { mcpJson, settingsJson };
    },

    getEffectiveView(scope, opts) {
      return viewReader.getEffectiveView(scope, { timeoutMs: opts?.timeoutMs ?? 10_000 });
    },
  };
}
