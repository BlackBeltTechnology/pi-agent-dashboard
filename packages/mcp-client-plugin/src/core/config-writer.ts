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

import { isAllowedCwd, tokenAllows } from "@blackbelt-technology/pi-dashboard-shared/cwd-guard.js";
import { type LayerPaths, type LayerRead, nullProto, readLayer } from "./layers.js";
import { deepEqual, isPlainObject } from "./path-utils.js";
import {
  ADAPTER_ONLY_KEYS,
  classifyProjectEntry,
  displayExposure,
  isFullEntry,
  isProjectOverride,
  isValidServerName,
  keptGlobalOf,
  mcpNamespace,
  OVERRIDE_KEYS,
  transportOf,
  validatePiEntry,
} from "./pi-rules.js";
import { validateServerEntry } from "./schema-validation.js";
import type {
  ConfigIO,
  ConfigRefusal,
  ConfigWriteResult,
  ConvertLegacyResult,
  ParseStatus,
  ProjectOverridePatch,
  ProjectOverrideResult,
  RemoveResult,
  Scope,
  ServerEntry,
  SetEnabledResult,
} from "./types.js";

/** Thrown when a project scope names a cwd outside the known-folder set. */
export class NotAllowedCwdError extends Error {
  public readonly cwd: string;

  constructor(cwd: string) {
    super(`cwd not allowed: ${cwd}`);
    this.cwd = cwd;
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
  setProjectOverride(name: string, patch: ProjectOverridePatch, scope: Scope): ProjectOverrideResult;
  convertLegacyCopy(name: string, scope: Scope): ConvertLegacyResult;
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

const OVERRIDE_ROUTE_HINT = "use the project-override operation to change a global server for one folder";

function omitKeys(entry: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(entry).filter(([k]) => !keys.includes(k)));
}

/**
 * A whole-entry folder copy of `globalRaw` made by the old disable path: both
 * are full entries, the folder entry carries none of the secret-bearing fields
 * (a re-entered secret vetoes), and apart from the override keys it equals the
 * global entry without those fields. See change: mcp-client-project-overrides (D7).
 */
export function isLegacyFolderCopy(folderRaw: unknown, globalRaw: unknown): boolean {
  if (!isFullEntry(folderRaw) || !isFullEntry(globalRaw)) return false;
  if (folderRaw.headers !== undefined || folderRaw.env !== undefined || folderRaw.auth !== undefined) return false;
  if (isPlainObject(folderRaw.oauth) && folderRaw.oauth.clientSecret !== undefined) return false;
  return deepEqual(omitKeys(folderRaw, OVERRIDE_KEYS), omitKeys(folderCopyOf(globalRaw).copy, OVERRIDE_KEYS));
}

/** `existing` override with `patch` applied: absent key = unchanged, `null` = delete the key. */
function patchedOverride(existing: Record<string, unknown> | undefined, patch: ProjectOverridePatch): Record<string, unknown> {
  const next = nullProto({ ...(existing ?? {}) });
  for (const k of OVERRIDE_KEYS) {
    const v = (patch as Record<string, unknown>)[k];
    if (v === undefined) continue;
    if (v === null) delete next[k];
    else next[k] = v;
  }
  return next;
}

/** A legacy copy rewritten to only the override keys whose value differs from the global entry. */
function convertedOverride(folder: Record<string, unknown>, base: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = nullProto({});
  if (folder.enabled !== undefined && (folder.enabled !== false) !== (base.enabled !== false)) next.enabled = folder.enabled;
  if (folder.exposure !== undefined && displayExposure(folder.exposure) !== displayExposure(base.exposure)) {
    next.exposure = folder.exposure;
  }
  if (folder.toolExposure !== undefined && !deepEqual(folder.toolExposure, base.toolExposure)) {
    next.toolExposure = folder.toolExposure;
  }
  return next;
}

/** Shape-check a patch BEFORE any IO: only override keys, correctly typed (`null` = delete). */
function patchShapeRefusal(name: string, patch: unknown): ConfigRefusal | null {
  if (!isPlainObject(patch)) {
    return { code: "invalid-entry", message: `server "${name}": override patch must be an object` };
  }
  const present = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== null && v !== undefined));
  const shape = validateServerEntry(present, { kind: "override" });
  if (shape.ok) return null;
  const f = shape.errors.map((e) => e.instancePath.replace(/^\//, "") || String(e.params.additionalProperty ?? "")).filter(Boolean);
  return { code: "invalid-entry", message: `server "${name}": invalid project override${f.length ? ` (${f.join(", ")})` : ""}` };
}

function wholeEntryRefusal(name: string, path: string): { ok: false; refusal: ConfigRefusal } {
  return {
    ok: false,
    refusal: {
      code: "invalid-entry",
      message: `server "${name}" is a whole-entry folder entry, not an override (${OVERRIDE_ROUTE_HINT})`,
      path,
    },
  };
}

/** The refusal when `next` merged onto its kept global base is not a valid pi override. */
function mergedOverrideRefusal(
  name: string,
  next: Record<string, unknown>,
  kept: ReadonlyMap<string, Record<string, unknown>>,
  path: string,
): ConfigRefusal | null {
  const cls = classifyProjectEntry(name, next, kept);
  if (cls.kind === "override") return null;
  return { code: "invalid-entry", message: cls.kind === "replace" ? OVERRIDE_ROUTE_HINT : cls.message, path };
}

export function createConfigWriter(deps: ConfigWriterDeps): ConfigWriter {
  const { configIO, paths, knownCwds } = deps;
  const trusted = (cwd: string): boolean => deps.isProjectTrusted?.(cwd) === true;

  function targetPath(scope: Scope): string {
    if (scope.kind === "global") return paths.globalPath();
    // A live request-scoped token means the route already admitted this exact cwd
    // (async, once): accept it without a second, synchronous git probe. Any other
    // scope (non-route callers, a released token) is decided by the sync guard.
    if (tokenAllows(scope.admission, scope.cwd)) return paths.projectPath(scope.cwd);
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
    const add = (path: string, skipOverrides: boolean): void => {
      const l = readLayer(configIO, path);
      if (!l.ok) return;
      for (const [n, raw] of Object.entries(l.servers)) {
        // pi never clash-checks a project override (it reuses the global entry's name).
        if (skipOverrides && isProjectOverride(raw)) continue;
        out.push({ name: n, path });
      }
    };
    add(paths.globalPath(), false);
    if (scope.kind === "project") {
      add(paths.projectPath(scope.cwd), true);
    } else {
      // pi loads the global layer first, then the trusted project layer, and
      // DROPS the project entry on a collision — so a global write must not
      // collide with any known trusted folder's entry.
      for (const cwd of knownCwds()) if (trusted(cwd)) add(paths.projectPath(cwd), true);
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
    if (scope.kind === "project") {
      // Overrides have exactly one write path (`setProjectOverride`).
      const prevEntry = renaming ? p.layer.servers[prev] : undefined;
      if (isProjectOverride(entry) || isProjectOverride(prevEntry)) {
        return { ok: false, refusal: { code: "invalid-entry", message: `server "${name}": ${OVERRIDE_ROUTE_HINT}`, path: p.path } };
      }
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

  /** The kept Pi-global base for `name`, or a refusal (unparseable global wins over `no-global-server`). */
  function keptBase(name: string): { ok: true; base: Record<string, unknown>; kept: ReadonlyMap<string, Record<string, unknown>> } | { ok: false; refusal: ConfigRefusal } {
    const gpath = paths.globalPath();
    const g = readLayer(configIO, gpath);
    if (!g.ok) {
      return { ok: false, refusal: { code: "unparseable", message: `${g.message} (pi skips this file; fix it by hand)`, path: gpath } };
    }
    const { kept } = keptGlobalOf(g.servers);
    const base = kept.get(name);
    if (!base) {
      return {
        ok: false,
        refusal: {
          code: "no-global-server",
          message: `server "${name}" needs "command" or "url", or a global server to override`,
          path: gpath,
        },
      };
    }
    return { ok: true, base, kept };
  }

  /** Everything an override write needs, or the refusal: scope, patch shape, target file, base. */
  function planOverride(
    name: string,
    patch: ProjectOverridePatch,
    scope: Scope,
  ):
    | { ok: true; p: Extract<Prepared, { ok: true }>; existing: Record<string, unknown> | undefined; kept: ReadonlyMap<string, Record<string, unknown>> }
    | { ok: false; refusal: ConfigRefusal } {
    if (scope.kind !== "project") {
      return { ok: false, refusal: { code: "invalid-entry", message: "a project override can only be written at project scope" } };
    }
    const bad = patchShapeRefusal(name, patch);
    if (bad) return { ok: false, refusal: bad };
    const p = prepare(name, scope);
    if (!p.ok) return p;
    const existing = existingObject(p, name);
    if (!existing.ok) return existing;
    if (existing.entry !== undefined && !isProjectOverride(existing.entry)) return wholeEntryRefusal(name, p.path);
    const kb = keptBase(name); // an unparseable global file wins over no-global-server
    if (!kb.ok) return kb;
    return { ok: true, p, existing: existing.entry, kept: kb.kept };
  }

  /** Validate `next` as a pi override of its kept base, then write it (or delete the emptied entry). */
  function commitOverride(
    name: string,
    p: Extract<Prepared, { ok: true }>,
    next: Record<string, unknown>,
    kept: ReadonlyMap<string, Record<string, unknown>>,
  ): ProjectOverrideResult {
    const empty = Object.keys(next).length === 0;
    const invalid = empty ? null : mergedOverrideRefusal(name, next, kept, p.path);
    if (invalid) return { ok: false, refusal: invalid };
    const servers = nullProto({ ...p.layer.servers });
    if (empty) delete servers[name];
    else servers[name] = next;
    const w = write(p.path, p.layer.config, servers);
    return w.ok ? { ok: true, override: empty ? undefined : { ...next } } : w;
  }

  function setProjectOverride(name: string, patch: ProjectOverridePatch, scope: Scope): ProjectOverrideResult {
    const plan = planOverride(name, patch, scope);
    if (!plan.ok) return plan;
    const next = patchedOverride(plan.existing, patch);
    // No key change touches no file (and creates none).
    if (deepEqual({ ...(plan.existing ?? {}) }, { ...next })) {
      return { ok: true, override: plan.existing === undefined ? undefined : { ...next } };
    }
    return commitOverride(name, plan.p, next, plan.kept);
  }

  function setEnabled(name: string, enabled: boolean, scope: Scope): SetEnabledResult {
    const p = prepare(name, scope);
    if (!p.ok) return p;
    const existing = existingObject(p, name);
    if (!existing.ok) return existing;

    // The global entry the folder layer shadows or overrides (project scope only).
    let globalRaw: unknown;
    if (scope.kind === "project") {
      const g = readLayer(configIO, paths.globalPath());
      globalRaw = g.ok ? g.servers[name] : undefined;
    }

    // A whole-entry layer entry (any scope): toggle its own `enabled` key.
    if (existing.entry !== undefined && !(scope.kind === "project" && isProjectOverride(existing.entry))) {
      const next = existing.entry;
      if (enabled) {
        // Enabling a folder copy that lacks the global entry's secrets would
        // connect without credentials: let the caller choose instead.
        if (isPlainObject(globalRaw) && next.enabled === false) {
          const missing = folderCopyOf(globalRaw).omitted.filter((f) => !hasPath(next, f));
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

    if (scope.kind === "project" && (existing.entry !== undefined || globalRaw !== undefined)) {
      // A global server (with or without an override): write only the smallest override.
      const kb = keptBase(name);
      if (!kb.ok) return kb;
      const globalOn = kb.base.enabled !== false;
      const r = setProjectOverride(name, { enabled: enabled === globalOn ? null : enabled }, scope);
      return r.ok ? { ok: true, action: "written" } : r;
    }

    return {
      ok: false,
      refusal: { code: "invalid-entry", message: `no MCP server named "${name}" in ${p.path}`, path: p.path },
    };
  }

  function convertLegacyCopy(name: string, scope: Scope): ConvertLegacyResult {
    if (scope.kind !== "project") {
      return { ok: false, refusal: { code: "invalid-entry", message: "a legacy folder copy can only be converted at project scope" } };
    }
    const p = prepare(name, scope);
    if (!p.ok) return p;
    const existing = existingObject(p, name);
    if (!existing.ok) return existing;
    const kb = keptBase(name);
    if (!kb.ok) return kb;
    const raw = p.layer.servers[name];
    if (existing.entry === undefined || !isLegacyFolderCopy(raw, kb.base)) {
      return {
        ok: false,
        refusal: { code: "invalid-entry", message: `server "${name}" in ${p.path} is not a legacy copy of the global entry`, path: p.path },
      };
    }
    const next = convertedOverride(existing.entry, kb.base);
    const servers = nullProto({ ...p.layer.servers });
    if (Object.keys(next).length === 0) delete servers[name];
    else servers[name] = next;
    const w = write(p.path, p.layer.config, servers);
    return w.ok ? { ok: true, previous: raw as ServerEntry } : w;
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
    setProjectOverride,
    convertLegacyCopy,
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

