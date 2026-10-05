/**
 * mcp-client-plugin · CORE effective-view reader over pi's two MCP layers.
 *
 * Mirrors pi 1.0.0 `loadMcpConfig`: the Pi-global layer loads first, then —
 * only when pi trusts the project — `<cwd>/.pi/mcp.json`, whose entries
 * REPLACE global entries of the same name as a whole. Each entry is checked
 * with the mirrored pi rules; an entry pi would reject or drop (invalid,
 * `-`/`_` collision, project `auth`) is shown inactive with pi's message. An
 * untrusted project's entries are shown inactive ("project not trusted").
 *
 * Secrets: in a project view, a GLOBAL entry's secret values are redacted
 * server-side (`headers`/`env` → `{redacted, keys}`, `oauth.clientSecret` →
 * `{redacted}`) — the folder surface must never receive an inherited
 * credential. Own-layer entries are returned verbatim (the client masks them).
 *
 * See change: migrate-mcp-to-pi-builtin (D3); earlier: extract-mcp-client-plugin.
 */

import { type LayerPaths, readLayer } from "./layers.js";
import { getByName, isPlainObject, setByName } from "./path-utils.js";
import {
  adapterLeftovers,
  authModeOf,
  displayExposure,
  ignoredKeys,
  mcpNamespace,
  transportOf,
  validatePiEntry,
} from "./pi-rules.js";
import type { ConfigIO, EffectiveServerView, EffectiveView, LayerStatus, Provenance, Scope } from "./types.js";

/** Credential-name pattern for record keys (key NAMES are never secret). */
export function isSecretKey(name: string): boolean {
  return /authorization|token|key|secret/i.test(name);
}

// Adapter-era leftovers (`bearerToken`, `requestHeadersCommand.env`) are
// ignored by pi but can still hold a credential, so they are redacted too.
const RECORD_SECRET_PATHS: string[][] = [["env"], ["headers"], ["requestHeadersCommand", "env"]];
const SCALAR_SECRET_PATHS: string[][] = [["oauth", "clientSecret"], ["bearerToken"]];

/** Replace secret values with markers (key names kept). */
export function redactEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const out = { ...entry };
  for (const path of RECORD_SECRET_PATHS) {
    const v = getByName(entry, path);
    if (isPlainObject(v)) {
      // Copy the parent first: the shallow copy shares nested objects with the raw entry.
      const parent = path.slice(0, -1);
      if (parent.length > 0) setByName(out, parent, { ...(getByName(entry, parent) as Record<string, unknown>) });
      setByName(out, path, { redacted: true, keys: Object.keys(v).map((k) => ({ name: k, secret: isSecretKey(k) })) });
    }
  }
  for (const path of SCALAR_SECRET_PATHS) {
    if (getByName(entry, path) === undefined) continue;
    // Copy the parent object first: `setByName` mutates in place and the
    // shallow copy above still shares nested objects with the raw entry.
    const parent = path.slice(0, -1);
    if (parent.length > 0) setByName(out, parent, { ...(getByName(entry, parent) as Record<string, unknown>) });
    setByName(out, path, { redacted: true });
  }
  return out;
}

export interface EffectiveViewDeps {
  configIO: ConfigIO;
  paths: LayerPaths;
  isProjectTrusted?: (cwd: string) => boolean;
}

export interface EffectiveViewReader {
  getEffectiveView(scope: Scope): EffectiveView;
}

function describe(
  name: string,
  raw: unknown,
  provenance: Provenance,
  redact: boolean,
): EffectiveServerView {
  const entry = isPlainObject(raw) ? (raw as Record<string, unknown>) : {};
  const piError = validatePiEntry(name, raw);
  const enabled = entry.enabled !== false;
  const view: EffectiveServerView = {
    name,
    provenance,
    entry: redact ? redactEntry(entry) : { ...entry },
    transport: transportOf(entry),
    enabled,
    exposure: displayExposure(entry.exposure),
    active: piError === null && enabled,
    ignoredKeys: ignoredKeys(entry),
    adapterLeftovers: adapterLeftovers(entry),
  };
  const auth = authModeOf(entry);
  if (auth) view.authMode = auth;
  if (piError) {
    view.piError = piError;
    view.inactiveReason = "invalid-entry";
  } else if (!enabled) {
    view.inactiveReason = "disabled";
  }
  return view;
}

function deactivate(v: EffectiveServerView, reason: EffectiveServerView["inactiveReason"], message?: string): void {
  v.active = false;
  v.inactiveReason = reason;
  if (message) v.piError = message;
}

export function createEffectiveViewReader(deps: EffectiveViewDeps): EffectiveViewReader {
  const { configIO, paths } = deps;

  function getEffectiveView(scope: Scope): EffectiveView {
    const globalPath = paths.globalPath();
    const g = readLayer(configIO, globalPath);
    const layers: LayerStatus[] = [
      { layer: "pi-global", path: globalPath, exists: g.exists, ok: g.ok, ...(g.ok ? {} : { message: g.message }) },
    ];
    const isProject = scope.kind === "project";

    // Global layer, in pi's load order (collisions within the file: first wins).
    const byName = new Map<string, EffectiveServerView>();
    const loadedNs = new Map<string, string>(); // namespace → loaded name
    if (g.ok) {
      for (const [name, raw] of Object.entries(g.servers)) {
        const v = describe(name, raw, "pi-global", isProject);
        if (!v.piError) {
          const clash = loadedNs.get(mcpNamespace(name));
          if (clash) deactivate(v, "name-collision", `server "${name}" conflicts with "${clash}"`);
          else loadedNs.set(mcpNamespace(name), name);
        }
        byName.set(name, v);
      }
    }

    if (scope.kind === "global") {
      return { scope: "global", servers: sortByName([...byName.values()]), layers };
    }

    const cwd = scope.cwd;
    const trusted = deps.isProjectTrusted?.(cwd) === true;
    const projectPath = paths.projectPath(cwd);
    const pl = readLayer(configIO, projectPath);
    layers.push({ layer: "pi-folder", path: projectPath, exists: pl.exists, ok: pl.ok, ...(pl.ok ? {} : { message: pl.message }) });

    const folderRows: EffectiveServerView[] = [];
    if (pl.ok) {
      for (const [name, raw] of Object.entries(pl.servers)) {
        const v = describe(name, raw, "pi-folder", false);
        const global = byName.get(name);
        if (!trusted) {
          // pi never reads this file: the global entry (if any) stays in effect.
          deactivate(v, "project-not-trusted");
          folderRows.push(v);
          continue;
        }
        if (v.piError) {
          // pi drops an invalid project entry; the global one stays in effect.
          folderRows.push(v);
          continue;
        }
        {
          const clash = loadedNs.get(mcpNamespace(name));
          if (clash && clash !== name) {
            deactivate(v, "name-collision", `server "${name}" conflicts with "${clash}"`);
            folderRows.push(v);
            continue;
          }
          if (isPlainObject(raw) && raw.auth !== undefined && v.transport === "http") {
            deactivate(v, "global-only-auth", `server "${name}": auth is only allowed in the global mcp.json`);
            folderRows.push(v);
            continue;
          }
        }
        if (global) v.overridesGlobal = true;
        loadedNs.set(mcpNamespace(name), name);
        byName.set(name, v); // whole-entry replace
      }
    }

    return {
      scope: "project",
      cwd,
      trusted,
      servers: sortByName([...byName.values(), ...folderRows]),
      layers,
    };
  }

  return { getEffectiveView };
}

function sortByName(rows: EffectiveServerView[]): EffectiveServerView[] {
  return rows.sort((a, b) => (a.name === b.name ? a.provenance.localeCompare(b.provenance) : a.name < b.name ? -1 : 1));
}
