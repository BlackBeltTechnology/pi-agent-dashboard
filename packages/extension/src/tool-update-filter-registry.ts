/**
 * Per-tool `tool_execution_update` filter registry: a plugin bridge declares, as
 * DATA, which dot paths to drop from the updates of a tool its manifest claims,
 * so payload reduction for a plugin's tool lives in that plugin, not in core.
 *
 * Protocol: a plugin emits `dashboard:register-tool-update-filter` with
 * `{ pluginId, toolName, dropPaths, when? }`. Declarations are untrusted input:
 * validated field-by-field (toolName string, 1..16 safe dot paths, optional
 * `{ path, in }` condition) and accepted ONLY from the plugin the server's
 * `plugin_ownership.toolClaims` names for that tool. Declarations are held until
 * the table arrives. One filter per tool; the claiming plugin re-declaring it
 * is idempotent (replaces). `apply` copies along the dropped paths and never
 * mutates the object the producer emitted.
 *
 * `when.path` names a string value; for each drop path it is read first as the
 * SIBLING of the dropped key (same last segment, in the drop path's parent), so
 * one condition covers `partialResult.details.entries` and `details.entries`;
 * if no such sibling exists the absolute path is read.
 * See change: move-subagents-to-plugin (D5).
 */

import {
  REGISTER_TOOL_UPDATE_FILTER_CHANNEL,
  type ToolUpdateFilterCondition,
} from "@blackbelt-technology/pi-dashboard-shared/event-forward-declaration.js";

interface BusLike {
  on: (channel: string, handler: (data: unknown) => void) => (() => void) | void;
}

export const MAX_DROP_PATHS = 16;
const MAX_HELD = 32;
const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TOOL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const SEGMENT_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const UNSAFE_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_WHEN_VALUES = 16;
const MAX_WHEN_VALUE_LEN = 64;

interface Filter {
  pluginId: string;
  dropPaths: string[][];
  when?: { path: string[]; in: Set<string> };
}

export interface ToolUpdateFilterStats {
  declared: number;
  refused: number;
  applied: number;
}

function own(obj: object, k: string): unknown {
  return Object.prototype.hasOwnProperty.call(obj, k) ? (obj as Record<string, unknown>)[k] : undefined;
}

function parsePath(v: unknown): string[] | undefined {
  if (typeof v !== "string") return undefined;
  const segs = v.split(".");
  if (segs.length === 0 || segs.length > 8) return undefined;
  for (const seg of segs) if (!SEGMENT_RE.test(seg) || UNSAFE_SEGMENTS.has(seg)) return undefined;
  return segs;
}

function parseWhen(v: unknown): Filter["when"] | undefined | false {
  if (v === undefined) return undefined;
  if (!v || typeof v !== "object") return false;
  const path = parsePath(own(v, "path"));
  const list = own(v, "in") as ToolUpdateFilterCondition["in"] | undefined;
  if (!path || !Array.isArray(list) || list.length === 0 || list.length > MAX_WHEN_VALUES) return false;
  for (const x of list) if (typeof x !== "string" || x.length > MAX_WHEN_VALUE_LEN) return false;
  return { path, in: new Set(list) };
}

function read(obj: unknown, path: readonly string[]): unknown {
  let cur: unknown = obj;
  for (const seg of path) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, seg)) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** Return a copy of `obj` without `path`, copying only the objects on the path; `obj` itself when absent. */
function dropPath(obj: Record<string, unknown>, path: readonly string[]): Record<string, unknown> {
  const [head, ...rest] = path;
  if (!Object.prototype.hasOwnProperty.call(obj, head)) return obj;
  if (rest.length === 0) {
    const { [head]: _dropped, ...remaining } = obj;
    return remaining;
  }
  const child = obj[head];
  if (!child || typeof child !== "object" || Array.isArray(child)) return obj;
  const next = dropPath(child as Record<string, unknown>, rest);
  return next === child ? obj : { ...obj, [head]: next };
}

export class ToolUpdateFilterRegistry {
  private readonly filters = new Map<string, Filter>();
  private claims: Map<string, string> | undefined;
  private held: unknown[] = [];
  private readonly unsubscribers: Array<() => void> = [];
  private disposed = false;
  readonly stats: ToolUpdateFilterStats = { declared: 0, refused: 0, applied: 0 };

  private readonly events: BusLike | undefined;

  constructor(events: BusLike | undefined) {
    this.events = events;
  }

  /** Subscribe the declaration channel. Call BEFORE the bridge-ready announcement. */
  attach(): void {
    if (!this.events || this.disposed) return;
    const off = this.events.on(REGISTER_TOOL_UPDATE_FILTER_CHANNEL, (raw) => this.declare(raw));
    if (typeof off === "function") this.unsubscribers.push(off);
  }

  /** Apply the server's `toolClaims` (tool name → claiming pluginId) and evaluate held declarations. */
  setClaims(toolClaims: Record<string, string> | undefined): void {
    if (this.disposed) return;
    const claims = new Map<string, string>();
    if (toolClaims && typeof toolClaims === "object") {
      for (const tool of Object.keys(toolClaims)) {
        const owner = toolClaims[tool];
        if (typeof owner === "string") claims.set(tool, owner);
      }
    }
    this.claims = claims;
    // A claim the table no longer grants drops its filter.
    for (const [tool, f] of [...this.filters]) {
      if (claims.get(tool) !== f.pluginId) this.filters.delete(tool);
    }
    this.stats.declared = this.filters.size;
    const held = this.held;
    this.held = [];
    for (const raw of held) this.declare(raw);
  }

  /** Validate + register one declaration. Never throws. */
  declare(raw: unknown): void {
    if (this.disposed) return;
    if (!this.claims) {
      if (this.held.length < MAX_HELD) this.held.push(raw);
      else this.stats.refused++;
      return;
    }
    try {
      if (!raw || typeof raw !== "object") { this.stats.refused++; return; }
      const pluginId = own(raw, "pluginId");
      const toolName = own(raw, "toolName");
      const dropRaw = own(raw, "dropPaths");
      if (typeof pluginId !== "string" || !PLUGIN_ID_RE.test(pluginId)) { this.stats.refused++; return; }
      if (typeof toolName !== "string" || !TOOL_NAME_RE.test(toolName)) { this.stats.refused++; return; }
      if (!Array.isArray(dropRaw) || dropRaw.length < 1 || dropRaw.length > MAX_DROP_PATHS) {
        this.stats.refused++;
        return;
      }
      const dropPaths: string[][] = [];
      for (const p of dropRaw) {
        const parsed = parsePath(p);
        if (!parsed) { this.stats.refused++; return; }
        dropPaths.push(parsed);
      }
      const when = parseWhen(own(raw, "when"));
      if (when === false) { this.stats.refused++; return; }
      // Only the plugin whose manifest claims the tool may filter it.
      if (this.claims.get(toolName) !== pluginId) { this.stats.refused++; return; }
      this.filters.set(toolName, { pluginId, dropPaths, ...(when ? { when } : {}) });
      this.stats.declared = this.filters.size;
    } catch {
      this.stats.refused++;
    }
  }

  /**
   * Payload to forward for a `tool_execution_update` of `toolName`: the SAME
   * object when no filter applies / nothing is dropped, else a copy.
   */
  apply(toolName: unknown, data: Record<string, unknown>): Record<string, unknown> {
    if (typeof toolName !== "string") return data;
    const filter = this.filters.get(toolName);
    if (!filter) return data;
    let out = data;
    for (const path of filter.dropPaths) {
      if (filter.when) {
        const sibling = read(out, [...path.slice(0, -1), filter.when.path[filter.when.path.length - 1]]);
        const value = typeof sibling === "string" ? sibling : read(out, filter.when.path);
        if (typeof value !== "string" || !filter.when.in.has(value)) continue;
      }
      out = dropPath(out, path);
    }
    if (out !== data) this.stats.applied++;
    return out;
  }

  dispose(): void {
    this.disposed = true;
    for (const off of this.unsubscribers) {
      try {
        off();
      } catch {
        /* keep releasing */
      }
    }
    this.unsubscribers.length = 0;
    this.filters.clear();
    this.held = [];
  }
}
