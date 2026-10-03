/**
 * mcp-client-plugin · CORE config writer over pi's built-in MCP layers.
 *
 * Every write targets exactly one layer (`global` → the Pi-global `mcp.json`,
 * `project` → `<cwd>/.pi/mcp.json`), replaces or deletes exactly one
 * `mcpServers.<name>` entry, preserves every other entry and top-level key,
 * writes atomically, and refuses to write over a file pi cannot parse
 * (strict JSON). Before any byte is written the resulting entry is checked
 * against the mirrored pi rules (`pi-rules.ts`), the dashboard's transport
 * rule, project-scope `auth`, and `-`/`_` namespace collisions, so the
 * writer never persists an entry pi would reject or drop.
 *
 * Refusals are the closed {@link ConfigRefusalCode} set, shared with
 * `checkConfigFiles` (same `planEnsure` function), so check mode can never
 * report a healthy file that write mode would refuse.
 *
 * See change: migrate-mcp-to-pi-builtin (D3); earlier: extract-mcp-client-plugin.
 */

import { isAllowedCwd } from "@blackbelt-technology/pi-dashboard-shared/cwd-guard.js";
import { type LayerPaths, type LayerRead, nullProto, readLayer } from "./layers.js";
import { isPlainObject } from "./path-utils.js";
import { ADAPTER_ONLY_KEYS, isValidServerName, mcpNamespace, transportOf, validatePiEntry } from "./pi-rules.js";
import type {
  ConfigIO,
  ConfigRefusal,
  ConfigWriteResult,
  ParseStatus,
  RemoveResult,
  Scope,
  ServerEntry,
  SetEnabledResult,
} from "./types.js";

/** Thrown when a project scope names a cwd outside the known-folder set. */
export class NotAllowedCwdError extends Error {
  constructor(public readonly cwd: string) {
    super(`cwd not allowed: ${cwd}`);
    this.name = "NotAllowedCwdError";
  }
}

/** Secret-bearing fields never copied silently from the global entry into a folder copy. */
export const FOLDER_COPY_OMITTED = ["headers", "env", "oauth.clientSecret", "auth"] as const;

export interface ConfigWriterDeps {
  configIO: ConfigIO;
  paths: LayerPaths;
  knownCwds: () => string[];
  /** pi's project-trust rule. Absent → every project is untrusted. */
  isProjectTrusted?: (cwd: string) => boolean;
}

export interface ConfigWriter {
  targetPath(scope: Scope): string;
  readServerEntry(name: string, scope: Scope): ServerEntry | undefined;
  ensureServerEntry(name: string, fields: Partial<ServerEntry>, scope: Scope): ConfigWriteResult;
  saveServer(
    name: string,
    entry: ServerEntry,
    scope: Scope,
    opts?: { previousName?: string; create?: boolean },
  ): ConfigWriteResult;
  removeServer(name: string, scope: Scope): RemoveResult;
  setEnabled(name: string, enabled: boolean, scope: Scope): SetEnabledResult;
  convertAdapterLeftovers(name: string, scope: Scope): ConfigWriteResult;
  /** Dry run of `ensureServerEntry`: the refusal it would return, or null. */
  previewEnsure(name: string, fields: Partial<ServerEntry>, scope: Scope): ConfigRefusal | null;
  readParseStatus(path: string): ParseStatus;
}

type Prepared =
  | { ok: true; path: string; layer: Extract<LayerRead, { ok: true }> }
  | { ok: false; refusal: ConfigRefusal };

/** A copy of a global entry for a folder layer, without secret values or `auth`. */
export function folderCopyOf(entry: Record<string, unknown>): { copy: Record<string, unknown>; omitted: string[] } {
  const copy = nullProto({ ...entry });
  const omitted: string[] = [];
  for (const k of ["headers", "env", "auth"] as const) {
    if (copy[k] !== undefined) {
      delete copy[k];
      omitted.push(k);
    }
  }
  if (isPlainObject(copy.oauth) && copy.oauth.clientSecret !== undefined) {
    const { clientSecret: _drop, ...rest } = copy.oauth;
    copy.oauth = rest;
    omitted.push("oauth.clientSecret");
  }
  return { copy, omitted };
}

export function createConfigWriter(deps: ConfigWriterDeps): ConfigWriter {
  const { configIO, paths, knownCwds } = deps;
  const trusted = (cwd: string): boolean => deps.isProjectTrusted?.(cwd) === true;

  function targetPath(scope: Scope): string {
    if (scope.kind === "global") return paths.globalPath();
    if (!isAllowedCwd(scope.cwd, knownCwds)) throw new NotAllowedCwdError(scope.cwd);
    return paths.projectPath(scope.cwd);
  }

  function nameRefusal(name: string): ConfigRefusal | null {
    if (isValidServerName(name)) return null;
    return {
      code: "invalid-name",
      message: `invalid server name ${JSON.stringify(name)} (use letters, digits, "_" and "-")`,
    };
  }

  function prepare(name: string, scope: Scope): Prepared {
    const bad = nameRefusal(name);
    if (bad) return { ok: false, refusal: bad };
    const path = targetPath(scope);
    const layer = readLayer(configIO, path);
    if (!layer.ok) {
      return {
        ok: false,
        refusal: { code: "unparseable", message: `${layer.message} (pi skips this file; fix it by hand)`, path },
      };
    }
    return { ok: true, path, layer };
  }

  /** Every entry a write could collide with, and the file it lives in. */
  function collisionCandidates(scope: Scope): Array<{ name: string; path: string }> {
    const out: Array<{ name: string; path: string }> = [];
    const add = (path: string): void => {
      const l = readLayer(configIO, path);
      if (l.ok) for (const n of Object.keys(l.servers)) out.push({ name: n, path });
    };
    add(paths.globalPath());
    if (scope.kind === "project") {
      add(paths.projectPath(scope.cwd));
    } else {
      // pi loads the global layer first, then the trusted project layer, and
      // DROPS the project entry on a collision — so a global write must not
      // collide with any known trusted folder's entry.
      for (const cwd of knownCwds()) if (trusted(cwd)) add(paths.projectPath(cwd));
    }
    return out;
  }

  /**
   * Validation shared by every write that sets an entry's content. `replacing`
   * names the entry a rename removes; it is excluded from the collision check
   * only in the TARGET layer — a same-named entry in another layer still
   * collides (pi would drop it).
   */
  function validateEntry(
    name: string,
    entry: Record<string, unknown>,
    scope: Scope,
    replacing?: string,
  ): ConfigRefusal | null {
    if (typeof entry.command === "string" && typeof entry.url === "string") {
      return {
        code: "transport-conflict",
        message: `server "${name}" carries both command and url; keep exactly one transport`,
        fields: ["command", "url"],
      };
    }
    const piError = validatePiEntry(name, entry);
    if (piError) return { code: "invalid-entry", message: piError };
    if (scope.kind === "project" && entry.auth !== undefined && transportOf(entry) === "http") {
      return {
        code: "invalid-entry",
        message: `server "${name}": auth is only allowed in the global mcp.json (provider auth is global-only)`,
      };
    }
    const ns = mcpNamespace(name);
    const target = targetPath(scope);
    const clash = collisionCandidates(scope).find(
      (c) =>
        c.name !== name && !(c.name === replacing && c.path === target) && mcpNamespace(c.name) === ns,
    );
    if (clash) {
      return {
        code: "name-collision",
        message: `server "${name}" conflicts with "${clash.name}" in ${clash.path} (pi maps "-" and "_" to one namespace)`,
        conflict: { name: clash.name, path: clash.path },
      };
    }
    return null;
  }

  function write(path: string, config: Record<string, unknown>, servers: Record<string, unknown>): ConfigWriteResult {
    const next = nullProto({ ...config });
    next.mcpServers = servers;
    if (JSON.stringify(next) === JSON.stringify(config)) return { ok: true };
    try {
      configIO.writeFileAtomic(path, `${JSON.stringify(next, null, 2)}\n`);
      return { ok: true };
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      return {
        ok: false,
        refusal: {
          code: "write-failed",
          message: `failed to write ${path}: ${err.message}`,
          path,
          ...(err.code ? { ioCode: err.code } : {}),
        },
      };
    }
  }

  function existingObject(
    p: Extract<Prepared, { ok: true }>,
    name: string,
  ): { ok: true; entry: Record<string, unknown> | undefined } | { ok: false; refusal: ConfigRefusal } {
    const raw = p.layer.servers[name];
    if (raw === undefined) return { ok: true, entry: undefined };
    if (!isPlainObject(raw)) {
      return {
        ok: false,
        refusal: { code: "entry-not-object", message: `${p.path}: server "${name}" is not an object`, path: p.path },
      };
    }
    return { ok: true, entry: nullProto({ ...raw }) };
  }

  function planEnsure(
    name: string,
    fields: Partial<ServerEntry>,
    scope: Scope,
  ): { ok: true; p: Extract<Prepared, { ok: true }>; next: Record<string, unknown> } | { ok: false; refusal: ConfigRefusal } {
    const p = prepare(name, scope);
    if (!p.ok) return p;
    const existing = existingObject(p, name);
    if (!existing.ok) return existing;
    const next = nullProto({ ...(existing.entry ?? {}) });
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) delete next[k];
      else next[k] = v;
    }
    const refusal = validateEntry(name, next, scope);
    if (refusal) return { ok: false, refusal };
    return { ok: true, p, next };
  }

  function ensureServerEntry(name: string, fields: Partial<ServerEntry>, scope: Scope): ConfigWriteResult {
    const plan = planEnsure(name, fields, scope);
    if (!plan.ok) return plan;
    const servers = nullProto({ ...plan.p.layer.servers });
    servers[name] = plan.next;
    return write(plan.p.path, plan.p.layer.config, servers);
  }

  function previewEnsure(name: string, fields: Partial<ServerEntry>, scope: Scope): ConfigRefusal | null {
    const plan = planEnsure(name, fields, scope);
    return plan.ok ? null : plan.refusal;
  }

  function saveServer(
    name: string,
    entry: ServerEntry,
    scope: Scope,
    opts?: { previousName?: string; create?: boolean },
  ): ConfigWriteResult {
    const p = prepare(name, scope);
    if (!p.ok) return p;
    if (!isPlainObject(entry)) {
      return { ok: false, refusal: { code: "invalid-entry", message: `server "${name}" must be an object` } };
    }
    const prev = opts?.previousName;
    const renaming = prev !== undefined && prev !== name;
    if (renaming) {
      const bad = nameRefusal(prev);
      if (bad) return { ok: false, refusal: bad };
    }
    // A rename or a create never replaces another entry: one write, one entry.
    if ((renaming || opts?.create === true) && p.layer.servers[name] !== undefined) {
      return {
        ok: false,
        refusal: {
          code: "name-collision",
          message: `${p.path} already defines "${name}"${renaming ? ` (cannot rename "${prev}" onto it)` : ""}`,
          conflict: { name, path: p.path },
        },
      };
    }
    const next = nullProto({ ...(entry as Record<string, unknown>) });
    const refusal = validateEntry(name, next, scope, prev);
    if (refusal) return { ok: false, refusal };
    const servers = nullProto({ ...p.layer.servers });
    if (renaming) delete servers[prev];
    servers[name] = next;
    return write(p.path, p.layer.config, servers);
  }

  function removeServer(name: string, scope: Scope): RemoveResult {
    const p = prepare(name, scope);
    if (!p.ok) return p;
    const removed = p.layer.servers[name] as ServerEntry | undefined;
    if (removed === undefined) return { ok: true, removed: undefined };
    const servers = nullProto({ ...p.layer.servers });
    delete servers[name];
    const w = write(p.path, p.layer.config, servers);
    return w.ok ? { ok: true, removed } : w;
  }

  function setEnabled(name: string, enabled: boolean, scope: Scope): SetEnabledResult {
    const p = prepare(name, scope);
    if (!p.ok) return p;
    const existing = existingObject(p, name);
    if (!existing.ok) return existing;

    // The global entry a folder entry replaces (project scope only).
    let globalEntry: Record<string, unknown> | undefined;
    if (scope.kind === "project") {
      const g = readLayer(configIO, paths.globalPath());
      const raw = g.ok ? g.servers[name] : undefined;
      globalEntry = isPlainObject(raw) ? raw : undefined;
    }

    if (existing.entry !== undefined) {
      const next = existing.entry;
      if (enabled) {
        // Enabling a folder copy that lacks the global entry's secrets would
        // connect without credentials: let the caller choose instead.
        if (globalEntry !== undefined && next.enabled === false) {
          const missing = folderCopyOf(globalEntry).omitted.filter((f) => !hasPath(next, f));
          if (missing.length > 0) return { ok: true, action: "needs-choice", omitted: missing };
        }
        delete next.enabled;
      } else {
        next.enabled = false;
      }
      const servers = nullProto({ ...p.layer.servers });
      servers[name] = next;
      const w = write(p.path, p.layer.config, servers);
      return w.ok ? { ok: true, action: "written" } : w;
    }

    if (scope.kind === "project" && globalEntry !== undefined) {
      if (enabled) return { ok: true, action: "written" }; // the global entry already applies
      // pi replaces entries as a whole: disabling here needs a complete copy.
      const { copy, omitted } = folderCopyOf(globalEntry);
      copy.enabled = false;
      const servers = nullProto({ ...p.layer.servers });
      servers[name] = copy;
      const w = write(p.path, p.layer.config, servers);
      return w.ok ? { ok: true, action: "written", ...(omitted.length ? { omitted } : {}) } : w;
    }

    return {
      ok: false,
      refusal: { code: "invalid-entry", message: `no MCP server named "${name}" in ${p.path}`, path: p.path },
    };
  }

  function convertAdapterLeftovers(name: string, scope: Scope): ConfigWriteResult {
    const p = prepare(name, scope);
    if (!p.ok) return p;
    const existing = existingObject(p, name);
    if (!existing.ok) return existing;
    const next = existing.entry;
    if (next === undefined) {
      return {
        ok: false,
        refusal: { code: "invalid-entry", message: `no MCP server named "${name}" in ${p.path}`, path: p.path },
      };
    }
    if (next.disabled === true && next.enabled === undefined) next.enabled = false;
    for (const k of ADAPTER_ONLY_KEYS) delete next[k];
    if (next.auth !== undefined && !isPlainObject(next.auth)) delete next.auth;
    if (next.oauth === false) delete next.oauth;
    const servers = nullProto({ ...p.layer.servers });
    servers[name] = next;
    return write(p.path, p.layer.config, servers);
  }

  function readServerEntry(name: string, scope: Scope): ServerEntry | undefined {
    if (!isValidServerName(name)) return undefined;
    const l = readLayer(configIO, targetPath(scope));
    if (!l.ok) return undefined;
    const raw = l.servers[name];
    return raw === undefined ? undefined : (raw as ServerEntry);
  }

  function readParseStatus(path: string): ParseStatus {
    const l = readLayer(configIO, path);
    return l.ok ? { path, ok: true } : { path, ok: false, message: l.message };
  }

  return {
    targetPath,
    readServerEntry,
    ensureServerEntry,
    saveServer,
    removeServer,
    setEnabled,
    convertAdapterLeftovers,
    previewEnsure,
    readParseStatus,
  };
}

function hasPath(entry: Record<string, unknown>, dotted: string): boolean {
  const [head, tail] = dotted.split(".");
  const v = entry[head];
  if (tail === undefined) return v !== undefined;
  return isPlainObject(v) && v[tail] !== undefined;
}

