/**
 * Per-session registry of the flow files a live session's pi-flows engine
 * actually uses, reported by this plugin's own bridge (`flow:list-flows` +
 * `flow:get-agents`) over the private plugin request lane. Lets the flows UI
 * open a flow's YAML, its agent `.md` files and its code-node handlers even
 * when they live in runtime-registered dirs (`flow:register-flows-dir` /
 * `flow:register-agents-dir`, e.g. InvoiceBot / RackInspect) outside the host's
 * `/api/pi-resource-file` allow-list — without any host-core change.
 *
 * Allowed = EXACT files only (realpath-canonicalized):
 *   - each reported flow `source` (`.yaml`/`.yml`)
 *   - each reported agent `source` (`.md`)
 *   - each code / code-decision handler the engine would run for a reported
 *     flow: `target:` → `resolve(sessionCwd, target)`, else
 *     `<dirname(flow.source)>/<step id>.ts` (pi-flows 0.5.0 execute-code-step)
 * No sibling, parent dir, or helper file becomes readable.
 * See change: attach-flow-before-run.
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import rateLimit from "@fastify/rate-limit";
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { FLOW_FILES_REPORT, FLOW_FILES_REQUEST_EVENT, type FlowFilesReport, type ReportedFile } from "../flow-files-contract.js";

interface SessionFiles {
  allowed: Map<string, string>;
  /** agent name → absolute agent file. */
  agents: Record<string, string>;
  /** flow name → step id → absolute handler file. */
  handlers: Record<string, Record<string, string>>;
}

const YAML = /\.ya?ml$/i;
const MARKDOWN = /\.md$/i;
const HANDLER = /\.[cm]?[jt]s$/i;
/** Largest file served / parsed (flow files are small text). */
const MAX_FILE_BYTES = 1024 * 1024;
/** Largest number of flows / agents accepted per report. */
const MAX_REPORT_ITEMS = 2000;
/** Minimum gap between asks to one session's bridge to (re)report. */
const REPORT_REQUEST_COOLDOWN_MS = 2_000;

/** A regular file no larger than {@link MAX_FILE_BYTES}. */
function isSmallFile(p: string): boolean {
  try {
    const st = fs.statSync(p);
    return st.isFile() && st.size <= MAX_FILE_BYTES;
  } catch {
    return false;
  }
}

function canonical(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function sanitize(list: unknown, ext: RegExp): ReportedFile[] {
  if (!Array.isArray(list)) return [];
  const out: ReportedFile[] = [];
  for (const item of list.slice(0, MAX_REPORT_ITEMS)) {
    const name = (item as ReportedFile | null)?.name;
    const source = (item as ReportedFile | null)?.source;
    if (typeof name !== "string" || typeof source !== "string") continue;
    if (!path.isAbsolute(source) || !ext.test(source)) continue;
    out.push({ name, source });
  }
  return out;
}

/** Handler files pi-flows would run for one flow.yaml (read from disk). */
export function codeHandlerPaths(flowSource: string, cwd: string | undefined): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  if (!isSmallFile(flowSource)) return out;
  let doc: unknown;
  try {
    doc = parseYaml(fs.readFileSync(flowSource, "utf8"));
  } catch {
    return out;
  }
  const steps = (doc as { steps?: unknown } | null)?.steps;
  if (!Array.isArray(steps)) return out;
  for (const raw of steps) {
    const s = raw as { id?: unknown; type?: unknown; target?: unknown } | null;
    if (!s || typeof s.id !== "string" || s.id === "__proto__") continue;
    if (s.type !== "code" && s.type !== "code-decision") continue;
    let file: string | undefined;
    if (s.target !== undefined && s.target !== null && s.target !== "") {
      if (cwd) file = path.resolve(cwd, String(s.target));
    } else {
      file = path.join(path.dirname(flowSource), `${s.id}.ts`);
    }
    if (file && HANDLER.test(file)) out[s.id] = file;
  }
  return out;
}

export class FlowFileRegistry {
  private readonly bySession = new Map<string, SessionFiles>();

  /** Replace a session's report. `cwd` resolves explicit code `target:`s. */
  report(sessionId: string, report: FlowFilesReport | null | undefined, cwd?: string): void {
    const flows = sanitize(report?.flows, YAML);
    const agents = sanitize(report?.agents, MARKDOWN);
    // lookup key (as reported / resolved, and its realpath) → canonical file.
    const allowed = new Map<string, string>();
    const allow = (file: string) => {
      const real = canonical(file);
      allowed.set(path.resolve(file), real);
      allowed.set(real, real);
    };
    const agentMap: Record<string, string> = Object.create(null);
    const handlers: Record<string, Record<string, string>> = Object.create(null);
    for (const f of flows) {
      allow(f.source);
      const h = codeHandlerPaths(f.source, cwd);
      handlers[f.name] = h;
      for (const file of Object.values(h)) allow(file);
    }
    for (const a of agents) {
      agentMap[a.name] = a.source;
      allow(a.source);
    }
    this.bySession.set(sessionId, { allowed, agents: agentMap, handlers });
  }

  has(sessionId: string): boolean {
    return this.bySession.has(sessionId);
  }

  remove(sessionId: string): void {
    this.bySession.delete(sessionId);
  }

  /**
   * The stored canonical path when `filePath` is exactly one of the session's
   * reported files, else null. Pure string lookup — the request path never
   * touches the filesystem; callers read only the returned stored path.
   */
  resolveAllowed(sessionId: string, filePath: string): string | null {
    if (!path.isAbsolute(filePath)) return null;
    return this.bySession.get(sessionId)?.allowed.get(path.resolve(filePath)) ?? null;
  }

  /** True when `filePath` is exactly one of the session's reported files. */
  isAllowed(sessionId: string, filePath: string): boolean {
    return this.resolveAllowed(sessionId, filePath) !== null;
  }

  /** Agent sources + per-flow code handler paths for one session. */
  files(sessionId: string): { agents: Record<string, string>; handlers: Record<string, Record<string, string>> } | null {
    const s = this.bySession.get(sessionId);
    return s ? { agents: { ...s.agents }, handlers: { ...s.handlers } } : null;
  }

  /** Drop sessions no longer live. */
  retainOnly(liveIds: ReadonlySet<string>): void {
    for (const id of this.bySession.keys()) if (!liveIds.has(id)) this.bySession.delete(id);
  }
}


const flowFileRegistry = new FlowFileRegistry();

interface RouteDeps {
  fastify: ServerPluginContext["fastify"];
  networkGuard: ServerPluginContext["networkGuard"];
  registerPiRequestHandler?: (type: string, h: (payload: unknown, meta: { sessionId: string }) => unknown) => void;
  sessionManager: { listActive(): unknown[]; getSession(id: string): unknown };
  emitEventToSession: (sessionId: string, eventType: string, data: Record<string, unknown>) => boolean;
  registry?: FlowFileRegistry;
}

function liveIds(sm: RouteDeps["sessionManager"]): Set<string> {
  const ids = new Set<string>();
  for (const s of sm.listActive()) {
    const r = s as { id?: unknown; status?: unknown } | null;
    if (r && typeof r.id === "string" && r.status !== "ended") ids.add(r.id);
  }
  return ids;
}

/**
 * Wire the report lane + `GET /api/plugins/flows/files?sessionId` (agent
 * sources + code handler paths) and `GET /api/plugins/flows/file?sessionId&path`
 * (content of an exact reported file). Both behind the host `networkGuard`.
 * A lookup for a live session with no report yet asks its bridge to report
 * and answers `reported: false` (the client retries).
 */
export async function registerFlowFileRoutes(deps: RouteDeps): Promise<void> {
  const registry = deps.registry ?? flowFileRegistry;
  const lastAsk = new Map<string, number>();
  const requestReport = (sessionId: string) => {
    const now = Date.now();
    if (now - (lastAsk.get(sessionId) ?? 0) < REPORT_REQUEST_COOLDOWN_MS) return;
    lastAsk.set(sessionId, now);
    try {
      deps.emitEventToSession(sessionId, FLOW_FILES_REQUEST_EVENT, {});
    } catch {
      /* best-effort */
    }
  };
  const liveSession = (q: unknown): string | null => {
    const id = (q as { sessionId?: unknown } | null)?.sessionId;
    if (typeof id !== "string" || !id) return null;
    const live = liveIds(deps.sessionManager);
    registry.retainOnly(live);
    for (const sid of lastAsk.keys()) if (!live.has(sid)) lastAsk.delete(sid);
    return live.has(id) ? id : null;
  };

  deps.registerPiRequestHandler?.(FLOW_FILES_REPORT, (payload, meta) => {
    const session = deps.sessionManager.getSession(meta.sessionId) as { cwd?: unknown } | undefined;
    const cwd = typeof session?.cwd === "string" ? session.cwd : undefined;
    registry.report(meta.sessionId, payload as FlowFilesReport, cwd);
    return { ok: true };
  });

  // Routes live in an encapsulated scope carrying a request rate limit
  // (recognized by CodeQL js/missing-rate-limiting; same pattern as
  // system-one / gmail). Loopback is allow-listed.
  await deps.fastify.register(async (scope) => {
  await scope.register(rateLimit, { global: true, max: 600, timeWindow: "1 minute", allowList: ["127.0.0.1", "::1"] });

  scope.get("/api/plugins/flows/files", { preHandler: deps.networkGuard }, async (req, reply) => {
    const sessionId = liveSession(req.query);
    if (!sessionId) return reply.code(404).send({ success: false, error: "session not found" });
    const files = registry.files(sessionId);
    if (!files) {
      requestReport(sessionId);
      return { success: true, data: { reported: false, agents: {}, handlers: {} } };
    }
    return { success: true, data: { reported: true, ...files } };
  });

  scope.get("/api/plugins/flows/file", { preHandler: deps.networkGuard }, async (req, reply) => {
    const sessionId = liveSession(req.query);
    const filePath = (req.query as { path?: unknown } | null)?.path;
    if (!sessionId) return reply.code(404).send({ success: false, error: "session not found" });
    if (typeof filePath !== "string" || !filePath) {
      return reply.code(400).send({ success: false, error: "path parameter required" });
    }
    if (!registry.has(sessionId)) {
      requestReport(sessionId);
      return reply.code(409).send({ success: false, error: "not reported yet", retry: true });
    }
    const target = registry.resolveAllowed(sessionId, filePath);
    if (!target) {
      return reply.code(403).send({ success: false, error: "not a flow file of this session" });
    }
    if (!isSmallFile(target)) return reply.code(404).send({ success: false, error: "not found" });
    try {
      const content = await fs.promises.readFile(target, "utf8");
      return { success: true, data: { type: "file", content } };
    } catch {
      return reply.code(404).send({ success: false, error: "not found" });
    }
  });
  });
}
