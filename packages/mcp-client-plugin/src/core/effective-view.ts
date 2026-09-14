/**
 * mcp-client-plugin · CORE effective-view reader.
 *
 * Reads the adapter's full layer stack through the adapter port (never a
 * hand-rolled discovery walk), classifies every server's provenance by the
 * adapter's `kind` + Pi-path equality, and REDACT SERVER-SIDE every secret
 * value that is not defined in the requested scope's writable Pi-owned layer —
 * so the client never receives an inherited credential.
 *
 * See change: extract-mcp-client-plugin (design D1, D2).
 */

import { parseJsonc } from "./config-writer.js";
import { getByName, isPlainObject, setByName } from "./path-utils.js";
import type { AdapterPort, ConfigDiscoveryPath, ConfigIO, Scope } from "./types.js";

export type LayerKind = "pi-global" | "pi-folder" | "shared" | "other";

export interface ProvenanceLayer {
  layer: LayerKind;
  path: string | null;
  label: string;
  importKind?: string;
  /** Pi-owned layers are writable; shared/other are read-only. */
  writable: boolean;
}

export interface EffectiveServerView {
  name: string;
  entry: Record<string, unknown>;
  provenance: ProvenanceLayer[];
  /**
   * The requested scope's WRITABLE layer's own entry, unmerged. The folder
   * surface needs it to tell an override from an inheritance (the merged
   * `entry` cannot: a non-secret inherited key looks identical to an own one).
   * Undefined when the writable layer does not define the server. Own-layer
   * credentials are therefore present — same exposure as `entry`, which keeps
   * its own-layer secrets unredacted by design (the route is networkGuard-gated).
   */
  own?: Record<string, unknown>;
}

export interface SettingSource {
  value: unknown;
  source: "pi-global" | "shared" | "default";
  path?: string;
}

export interface LayerParseError {
  path: string;
  message: string;
}

export interface EffectiveView {
  cwd: string;
  servers: EffectiveServerView[];
  settings: Record<string, SettingSource>;
  layerErrors: LayerParseError[];
}

export interface EffectiveViewReader {
  getEffectiveView(scope: Scope, opts: { timeoutMs: number }): Promise<EffectiveView>;
}

export interface EffectiveViewDeps {
  configIO: ConfigIO;
  adapter: AdapterPort;
  scratchCwd: string;
}

/** Scalar secret fields (dotted path). */
const SCALAR_SECRET_PATHS: string[][] = [["bearerToken"], ["oauth", "clientSecret"]];
/** Record-valued secret fields (dotted path) — replaced by a key-name marker. */
const RECORD_SECRET_PATHS: string[][] = [["env"], ["headers"], ["requestHeadersCommand", "env"]];

/** Credential-name pattern for record keys (key NAMES are never secret). */
export function isSecretKey(name: string): boolean {
  return /authorization|token|key|secret/i.test(name);
}

interface LayerRead {
  path: string;
  label: string;
  exists: boolean;
  servers: Record<string, unknown> | null;
  settings: Record<string, unknown> | null;
  error?: string;
}

function readLayer(io: ConfigIO, discovery: ConfigDiscoveryPath): LayerRead {
  const base: LayerRead = {
    path: discovery.path,
    label: discovery.label,
    exists: discovery.exists,
    servers: null,
    settings: null,
  };
  const raw = io.readFile(discovery.path);
  if (raw === null || raw.trim() === "") return { ...base, servers: {}, settings: {} };
  try {
    const parsed = parseJsonc(raw);
    if (!isPlainObject(parsed)) return { ...base, error: `${discovery.path} is not a JSON object` };
    const rawServers = isPlainObject(parsed.mcpServers)
      ? (parsed.mcpServers as Record<string, unknown>)
      : isPlainObject(parsed["mcp-servers"])
        ? (parsed["mcp-servers"] as Record<string, unknown>)
        : {};
    const settings = isPlainObject(parsed.settings) ? (parsed.settings as Record<string, unknown>) : {};
    return { ...base, servers: rawServers, settings };
  } catch (e) {
    return { ...base, error: (e as Error).message };
  }
}

function redactSecrets(
  merged: Record<string, unknown>,
  own: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const entry = { ...merged } as Record<string, unknown>;
  for (const path of SCALAR_SECRET_PATHS) {
    if (getByName(merged, path) !== undefined && getByName(own, path) === undefined) {
      setByName(entry, path, { redacted: true });
    }
  }
  for (const path of RECORD_SECRET_PATHS) {
    const value = getByName(merged, path);
    if (isPlainObject(value) && getByName(own, path) === undefined) {
      setByName(entry, path, {
        redacted: true,
        keys: Object.keys(value).map((k) => ({ name: k, secret: isSecretKey(k) })),
      });
    }
  }
  return entry;
}

function classify(
  name: string,
  layers: LayerRead[],
  cwd: string,
  adapter: Pick<AdapterPort, "getPiGlobalConfigPath" | "getProjectPiConfigPath">,
  provenance: Map<string, { kind: string; path: string; importKind?: string }>,
): ProvenanceLayer[] {
  const piGlobal = adapter.getPiGlobalConfigPath();
  const piFolder = adapter.getProjectPiConfigPath(cwd);
  const defining = layers.filter((l) => l.servers !== null && Object.hasOwn(l.servers, name));
  if (defining.length === 0) {
    const p = provenance.get(name);
    return [
      {
        layer: "other",
        path: p?.path ?? null,
        label: p?.importKind ?? "package or plugin",
        writable: false,
      },
    ];
  }
  const adapterProv = provenance.get(name);
  return defining.map((l) => {
    if (l.path === piGlobal) return { layer: "pi-global" as const, path: l.path, label: l.label, writable: true };
    if (l.path === piFolder) return { layer: "pi-folder" as const, path: l.path, label: l.label, writable: true };
    const importKind = adapterProv?.kind === "import" ? adapterProv.importKind : undefined;
    return {
      layer: "shared" as const,
      path: l.path,
      label: importKind ?? l.label,
      ...(importKind ? { importKind } : {}),
      writable: false,
    };
  });
}

function deriveSettings(
  effective: Record<string, unknown> | undefined,
  layers: LayerRead[],
  adapter: Pick<AdapterPort, "getPiGlobalConfigPath">,
): Record<string, SettingSource> {
  const piGlobal = adapter.getPiGlobalConfigPath();
  const out: Record<string, SettingSource> = {};
  for (const [key, value] of Object.entries(effective ?? {})) {
    const globalLayer = layers.find(
      (l) => l.path === piGlobal && l.settings !== null && Object.hasOwn(l.settings, key),
    );
    if (globalLayer) {
      out[key] = { value, source: "pi-global", path: piGlobal };
      continue;
    }
    const sharedLayer = layers.find(
      (l) => l.path !== piGlobal && l.settings !== null && Object.hasOwn(l.settings, key),
    );
    if (sharedLayer) {
      out[key] = { value, source: "shared", path: sharedLayer.path };
      continue;
    }
    out[key] = { value, source: "default" };
  }
  return out;
}

export function createEffectiveViewReader(deps: EffectiveViewDeps): EffectiveViewReader {
  const { configIO, adapter, scratchCwd } = deps;

  async function getEffectiveView(scope: Scope, opts: { timeoutMs: number }): Promise<EffectiveView> {
    const cwd = scope.kind === "project" ? scope.cwd : scratchCwd;
    const config = await adapter.loadMcpConfig(undefined, cwd, { timeoutMs: opts.timeoutMs });
    const provenance = await adapter.getServerProvenance(undefined, cwd, { timeoutMs: opts.timeoutMs });
    const discovered = adapter.getConfigDiscoveryPaths(undefined, cwd);
    const layers = discovered.map((d) => readLayer(configIO, d));
    const layerErrors: LayerParseError[] = layers
      .filter((l) => l.error !== undefined)
      .map((l) => ({ path: l.path, message: l.error as string }));

    const writablePath =
      scope.kind === "project" ? adapter.getProjectPiConfigPath(cwd) : adapter.getPiGlobalConfigPath();
    const writableServers = layers.find((l) => l.path === writablePath)?.servers ?? null;

    const servers: EffectiveServerView[] = Object.entries(config.mcpServers ?? {}).map(([name, entry]) => {
      const merged = entry as unknown as Record<string, unknown>;
      const ownRaw =
        writableServers !== null && Object.hasOwn(writableServers, name) ? writableServers[name] : undefined;
      const own = isPlainObject(ownRaw) ? (ownRaw as Record<string, unknown>) : undefined;
      return {
        name,
        entry: redactSecrets(merged, own),
        provenance: classify(name, layers, cwd, adapter, provenance),
        ...(own ? { own } : {}),
      };
    });

    return {
      cwd,
      servers,
      settings: deriveSettings(config.settings as Record<string, unknown> | undefined, layers, adapter),
      layerErrors,
    };
  }

  return { getEffectiveView };
}
