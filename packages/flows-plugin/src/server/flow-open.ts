/**
 * `flow/open` request lane — the server half of the agent `flow_open` tool.
 *
 *   - `flow` → catalog lookup (polled rediscovery, retried while the ask
 *     cooldown suppresses it) → runnable catalog attachment.
 *   - `path` → admission (D2): resolve against the session cwd, realpath,
 *     directory → direct `flow.yaml|flow.yml`, regular file ≤ MAX_FILE_BYTES,
 *     confinement to `realpath(cwd)`; only THEN a guarded read + parse. A path
 *     equal to a catalog definition collapses to that catalog flow (D4);
 *     otherwise the flow's own files are admitted into the shared
 *     `FlowFileRegistry` (D3) and the attachment is view-only.
 *   - Delivery (D5): `flows_open` broadcast with a server-stamped baseline,
 *     `flows_open_ack` counted per socket for a fixed 1.5 s window.
 *   - Rate limit 10 / 10 s per session, one log line per call (D8).
 *
 * Never logs file content. See change: add-flow-open-tool.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { FlowCatalogEntry } from "../flow-catalog-contract.js";
import { isValidFlowName } from "./flow-control.js";
import { type FlowFileRegistry, handlerPathsFromDoc, isInside, MAX_FILE_BYTES } from "./flow-files.js";

const FLOW_OPEN_REQUEST = "flow/open";
const FLOWS_OPEN_FRAME = "flows_open";
export const FLOWS_OPEN_ACK = "flows_open_ack";

/** Fixed acknowledgement window after the broadcast. */
const ACK_WINDOW_MS = 1_500;
/** Catalog poll period while waiting for a rediscovered catalog. */
const CATALOG_POLL_MS = 100;
/** Bounded pending-ack map (oldest dropped). */
const MAX_PENDING_ACKS = 64;
const RATE_MAX_CALLS = 10;
const RATE_WINDOW_MS = 10_000;
/** Candidate walk bounds for a directory without a direct flow file. */
const MAX_CANDIDATES = 20;
const MAX_CANDIDATE_DEPTH = 6;
const MAX_PATH_CHARS = 4096;
/** Most directories the candidate walk visits (caps the scan, not just the answer). */
const MAX_VISITED_DIRS = 2_000;
const FLOW_FILE = /^flow\.ya?ml$/;
const SKIP_DIRS = new Set(["node_modules", ".git"]);

type FlowOpenReason =
  | "invalid-arguments"
  | "unknown-flow"
  | "not-a-flow"
  | "path-not-allowed"
  | "flow-running"
  | "rate-limited"
  | "unavailable";

export type FlowOpenResult =
  | { status: "shown"; acks: number; name: string; path: string; viewOnly: boolean }
  | { status: "no-viewer"; name: string; path: string; viewOnly: boolean; message: string }
  | { status: "refused"; reason: FlowOpenReason; candidates?: string[] };

type Located = { ok: true; def: string } | { ok: false; reason: FlowOpenReason; candidates?: string[] };

function realpathOrNull(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

function statOrNull(p: string): fs.Stats | null {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

/** Non-symlink subdirectories of `d` (sorted), skipping `node_modules` / `.git`. */
function childDirs(d: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(d).sort();
  } catch {
    return [];
  }
  return names
    .filter((name) => !SKIP_DIRS.has(name))
    .map((name) => path.join(d, name))
    .filter((child) => {
      try {
        return fs.lstatSync(child).isDirectory();
      } catch {
        return false;
      }
    });
}

/** Regular (non-symlink) `flow.yaml` / `flow.yml` files directly in `dir`. */
function flowFilesIn(dir: string): string[] {
  return ["flow.yaml", "flow.yml"]
    .map((f) => path.join(dir, f))
    .filter((file) => {
      try {
        return fs.lstatSync(file).isFile();
      } catch {
        return false;
      }
    });
}

/**
 * Up to {@link MAX_CANDIDATES} `flow.yaml|flow.yml` files beneath `dir`,
 * cwd-relative, breadth-first, `lstat` only (no symlink followed), at most
 * {@link MAX_CANDIDATE_DEPTH} directory levels down, skipping `node_modules`
 * and `.git`.
 */
function findFlowCandidates(dir: string, cwdReal: string): string[] {
  const out: string[] = [];
  let level: string[] = [dir];
  let visited = 0;
  for (let depth = 1; depth <= MAX_CANDIDATE_DEPTH && level.length > 0; depth++) {
    const next: string[] = [];
    for (const d of level) {
      if (++visited > MAX_VISITED_DIRS) return out;
      next.push(...childDirs(d));
    }
    level = next;
    for (const child of level) {
      out.push(...flowFilesIn(child).map((file) => path.relative(cwdReal, file)));
      if (out.length >= MAX_CANDIDATES) return out.slice(0, MAX_CANDIDATES);
    }
  }
  return out;
}

/** A directory's direct flow file, canonical and confined; or the refusal. */
function directFlowFile(dir: string, cwdReal: string): Located {
  const direct = ["flow.yaml", "flow.yml"].map((f) => path.join(dir, f)).find((f) => statOrNull(f)?.isFile() === true);
  if (!direct) return { ok: false, reason: "not-a-flow", candidates: findFlowCandidates(dir, cwdReal) };
  const real = realpathOrNull(direct);
  if (real === null) return { ok: false, reason: "not-a-flow" };
  if (!isInside(real, cwdReal)) return { ok: false, reason: "path-not-allowed" };
  return { ok: true, def: real };
}

/**
 * Admission without reading content (D2): canonical location, confinement,
 * name, type, size. `cwdReal` is the realpath of the session cwd.
 */
function locateFlowPath(input: string, cwd: string, cwdReal: string): Located {
  const abs = path.resolve(cwd, input);
  const real = realpathOrNull(abs);
  if (real === null) {
    // Nonexistent: refuse by where it lexically points.
    const inside = isInside(abs, cwdReal) || isInside(abs, path.resolve(cwd));
    return { ok: false, reason: inside ? "not-a-flow" : "path-not-allowed" };
  }
  if (!isInside(real, cwdReal)) return { ok: false, reason: "path-not-allowed" };
  const st = statOrNull(real);
  if (!st) return { ok: false, reason: "not-a-flow" };
  const located = st.isDirectory() ? directFlowFile(real, cwdReal) : ({ ok: true, def: real } as const);
  if (!located.ok) return located;
  if (!FLOW_FILE.test(path.basename(located.def))) return { ok: false, reason: "not-a-flow" };
  const fst = statOrNull(located.def);
  if (!fst?.isFile() || fst.size > MAX_FILE_BYTES) return { ok: false, reason: "not-a-flow" };
  return located;
}

function isValidPathArg(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= MAX_PATH_CHARS && !v.includes("\0");
}

/** Agent names the definition's steps reference (`agent:`). */
function agentNames(doc: unknown): string[] {
  const steps = (doc as { steps?: unknown } | null)?.steps;
  if (!Array.isArray(steps)) return [];
  const out: string[] = [];
  for (const s of steps) {
    const a = (s as { agent?: unknown } | null)?.agent;
    if (typeof a === "string" && a) out.push(a);
  }
  return out;
}

export interface FlowOpenDeps {
  registerPiRequestHandler?: (
    type: string,
    h: (payload: unknown, meta: { sessionId: string }) => unknown,
    opts?: { hubLocalOnly?: boolean },
  ) => void;
  registerBrowserHandler: (type: string, h: (msg: unknown, ws: unknown) => void) => void;
  broadcastToSubscribers: (msg: unknown) => void;
  sessionManager: { getSession(id: string): unknown };
  onSessionEnded?: (h: (sessionId: string) => void) => () => void;
  store: { getState(id: string): { flows?: FlowCatalogEntry[] } | undefined };
  requestCatalog: (sessionId: string, opts?: { rediscover?: boolean }) => boolean;
  registry: FlowFileRegistry;
  readFileGuarded?: (absPath: string) => Promise<string | null>;
  logger: { info(m: string): void };
}

export interface FlowOpenController {
  handle(payload: unknown, meta: { sessionId: string }): Promise<FlowOpenResult>;
  /** Test seams. */
  pendingSize(): number;
  limiterSize(): number;
  dispose(): void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function registerFlowOpen(deps: FlowOpenDeps): FlowOpenController {
  const pending = new Map<string, { sessionId: string; acks: Set<unknown> }>();
  const calls = new Map<string, number[]>();

  const offEnded = deps.onSessionEnded?.((sessionId) => calls.delete(sessionId));

  deps.registerBrowserHandler(FLOWS_OPEN_ACK, (msg, ws) => {
    const m = msg as { sessionId?: unknown; requestId?: unknown } | null;
    if (typeof m?.requestId !== "string") return;
    const p = pending.get(m.requestId);
    if (!p || p.sessionId !== m.sessionId) return;
    p.acks.add(ws);
  });

  const rateLimited = (sessionId: string): boolean => {
    const now = Date.now();
    const recent = (calls.get(sessionId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    if (recent.length >= RATE_MAX_CALLS) {
      calls.set(sessionId, recent);
      return true;
    }
    recent.push(now);
    calls.set(sessionId, recent);
    return false;
  };

  const catalogEntry = (sessionId: string, name: string) =>
    deps.store.getState(sessionId)?.flows?.find((f) => f.name === name);

  /** Catalog hit, or rediscover and poll up to the window (retrying a suppressed ask). */
  const findCatalogFlow = async (sessionId: string, name: string): Promise<FlowCatalogEntry | undefined> => {
    let hit = catalogEntry(sessionId, name);
    if (hit) return hit;
    let asked = false;
    const deadline = Date.now() + ACK_WINDOW_MS;
    while (Date.now() < deadline) {
      if (!asked) asked = deps.requestCatalog(sessionId, { rediscover: true });
      await sleep(CATALOG_POLL_MS);
      hit = catalogEntry(sessionId, name);
      if (hit) return hit;
    }
    return undefined;
  };

  const deliver = async (
    sessionId: string,
    att: { name: string; source: string; viewOnly: boolean },
    relPath: string,
    acceptedAt: number,
  ): Promise<FlowOpenResult> => {
    const requestId = randomUUID();
    const acks = new Set<unknown>();
    // Never evict a pending ack whose window is still open: refuse instead.
    if (pending.size >= MAX_PENDING_ACKS) return refused("rate-limited");
    pending.set(requestId, { sessionId, acks });
    deps.broadcastToSubscribers({
      type: FLOWS_OPEN_FRAME,
      sessionId,
      requestId,
      attachment: { ...att, baselineStartedAt: acceptedAt },
    });
    await sleep(ACK_WINDOW_MS);
    pending.delete(requestId);
    return acks.size > 0
      ? { status: "shown", acks: acks.size, name: att.name, path: relPath, viewOnly: att.viewOnly }
      : {
          status: "no-viewer",
          name: att.name,
          path: relPath,
          viewOnly: att.viewOnly,
          message: "no viewer confirmed the pin (no dashboard browser showed this session)",
        };
  };

  const refused = (reason: FlowOpenReason, candidates?: string[]): FlowOpenResult =>
    candidates ? { status: "refused", reason, candidates } : { status: "refused", reason };

  const cwdOf = (sessionId: string): string | undefined => {
    const session = deps.sessionManager.getSession(sessionId) as { cwd?: unknown } | undefined;
    return typeof session?.cwd === "string" && session.cwd ? session.cwd : undefined;
  };
  const relTo = (cwd: string | undefined, source: string) =>
    cwd && source ? path.relative(cwd, path.resolve(cwd, source)) : source;

  const openCatalogFlow = async (sessionId: string, flow: unknown, acceptedAt: number): Promise<FlowOpenResult> => {
    if (!isValidFlowName(flow)) return refused("invalid-arguments");
    const entry = await findCatalogFlow(sessionId, flow);
    if (!entry) return refused("unknown-flow");
    const cwd = cwdOf(sessionId);
    return deliver(sessionId, { name: entry.name, source: entry.source, viewOnly: false }, relTo(cwd, entry.source), acceptedAt);
  };

  /** Guarded read + parse of an admitted definition; a refusal on failure. */
  const readFlowDoc = async (def: string, read: (p: string) => Promise<string | null>): Promise<{ doc: object } | FlowOpenResult> => {
    let doc: unknown;
    try {
      const content = await read(def);
      if (content === null) return refused("path-not-allowed");
      doc = parseYaml(content);
    } catch {
      return refused("not-a-flow");
    }
    if (!doc || typeof doc !== "object" || !Array.isArray((doc as { steps?: unknown }).steps)) return refused("not-a-flow");
    return { doc };
  };

  const openPathFlow = async (sessionId: string, input: unknown, acceptedAt: number): Promise<FlowOpenResult> => {
    if (!isValidPathArg(input)) return refused("invalid-arguments");
    const cwd = cwdOf(sessionId);
    const read = deps.readFileGuarded;
    const cwdReal = cwd ? realpathOrNull(cwd) : null;
    if (!read || !cwd || cwdReal === null) return refused("unavailable");
    const located = locateFlowPath(input, cwd, cwdReal);
    if (!located.ok) return refused(located.reason, located.candidates);
    const def = located.def;

    // Same file as a catalog definition → the catalog flow (runnable). D4.
    const catalog = deps.store.getState(sessionId)?.flows?.find((f) => f.source && realpathOrNull(path.resolve(cwd, f.source)) === def);
    if (catalog) return deliver(sessionId, { name: catalog.name, source: catalog.source, viewOnly: false }, relTo(cwd, catalog.source), acceptedAt);

    const parsed = await readFlowDoc(def, read);
    if (!("doc" in parsed)) return parsed;
    const name = path.relative(cwdReal, def);
    admitOpened(sessionId, name, def, parsed.doc, cwd, cwdReal);
    return deliver(sessionId, { name, source: def, viewOnly: true }, name, acceptedAt);
  };

  /** Register a path-opened flow's own files (D3); agents only those the session's report resolves. */
  const admitOpened = (sessionId: string, name: string, def: string, doc: object, cwd: string, cwdReal: string) => {
    const reported = deps.registry.files(sessionId)?.agents ?? {};
    const agents: Record<string, string> = Object.create(null);
    for (const a of agentNames(doc)) {
      const file = Object.hasOwn(reported, a) ? reported[a] : undefined;
      if (typeof file === "string") agents[a] = file;
    }
    deps.registry.open(sessionId, name, { def, handlers: handlerPathsFromDoc(doc, def, cwd), agents }, cwdReal);
  };

  const run = async (sessionId: string, payload: unknown): Promise<FlowOpenResult> => {
    const p = (payload ?? {}) as { flow?: unknown; path?: unknown };
    if (rateLimited(sessionId)) return refused("rate-limited");
    if ((p.flow !== undefined) === (p.path !== undefined)) return refused("invalid-arguments");
    // Baseline = call time, before any catalog wait: a flow started after the
    // call consumes the pin. See change: add-flow-open-tool (D6).
    const acceptedAt = Date.now();
    return p.flow !== undefined ? openCatalogFlow(sessionId, p.flow, acceptedAt) : openPathFlow(sessionId, p.path, acceptedAt);
  };

  const handle = async (payload: unknown, meta: { sessionId: string }): Promise<FlowOpenResult> => {
    const sessionId = meta.sessionId;
    const p = (payload ?? {}) as { flow?: unknown; path?: unknown };
    const kind = p.flow !== undefined ? "flow" : p.path !== undefined ? "path" : "none";
    let result: FlowOpenResult;
    try {
      result = await run(sessionId, payload);
    } catch {
      result = refused("unavailable");
    }
    const reason = result.status === "refused" ? result.reason : "-";
    const acks = result.status === "shown" ? result.acks : 0;
    deps.logger.info(`flow_open session=${sessionId} kind=${kind} outcome=${result.status} reason=${reason} acks=${acks}`);
    return result;
  };

  deps.registerPiRequestHandler?.(FLOW_OPEN_REQUEST, handle, { hubLocalOnly: true });

  return {
    handle,
    pendingSize: () => pending.size,
    limiterSize: () => calls.size,
    dispose: () => offEnded?.(),
  };
}
