/**
 * Flows edit mode: resolver, guarded routes, per-project action and the
 * one-time legacy migration. The dashboard NEVER writes a repo's
 * `.pi/settings.json` on its own; only the explicit per-project action sends
 * `flow:set-edit-mode` (pi-flows then writes that repo's file).
 *
 *   - `resolveEditMode(cwd)` mirrors pi-flows `isEditFlowEnabled`
 *     (`edit-flow-config.ts`): project ?? global ?? false; each file holds
 *     `flows.editFlow` (boolean) or the legacy top-level `flowsEditFlow`;
 *     an absent / unparseable file counts as unset. READ-ONLY.
 *   - Global file = `<os.homedir()>/.pi/agent/settings.json`, deliberately
 *     ignoring `PI_CODING_AGENT_DIR` (pi-flows reads `homedir()` only).
 *   - `GET|PUT /api/plugins/flows/edit-mode-default` and
 *     `GET /api/plugins/flows/edit-mode-state?sessionId` sit in an
 *     encapsulated scope behind `networkGuard` + `@fastify/rate-limit`.
 *     PUT accepts `{ enabled: boolean }` only and writes `flows.editFlow` only,
 *     under pi's settings lock (merge-preserving).
 *   - Push frame `{ type: "flows_edit_mode_state", sessionId, enabled, error? }`,
 *     one per active session in each affected cwd.
 *
 * See change: stop-flows-edit-mode-project-writes (D2, D4, D5, D6).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import {
  asObject,
  type FsDeps,
  formatJson,
  readPiSettings,
  withPiSettingsLock,
} from "@blackbelt-technology/pi-dashboard-shared/pi-agent-settings-lock.js";
import rateLimit from "@fastify/rate-limit";

const EDIT_MODE_STATE_FRAME = "flows_edit_mode_state";
const SET_EDIT_MODE_EVENT = "flow:set-edit-mode";
/** Per-project action: poll the project file until pi-flows has written it. */
export const SET_EDIT_MODE_POLL = { attempts: 10, intervalMs: 200 } as const;

export type EditModeError = "not-delivered" | "timeout";

interface EditModeStateFrame {
  type: typeof EDIT_MODE_STATE_FRAME;
  sessionId: string;
  enabled: boolean;
  error?: EditModeError;
}

// ── Resolver (mirror of pi-flows `edit-flow-config.ts`) ──────────────

/** The global file pi-flows reads: `<home>/.pi/agent/settings.json` (env ignored). */
export function globalSettingsPath(home: string = os.homedir()): string {
  return path.join(home, ".pi", "agent", "settings.json");
}

function projectSettingsPath(cwd: string): string {
  return path.join(cwd, ".pi", "settings.json");
}

/** pi-flows `readEditFlowFlag`: `flows.editFlow` first, then `flowsEditFlow`; booleans only. */
function readEditFlowFlag(settings: unknown): boolean | undefined {
  if (!settings || typeof settings !== "object") return undefined;
  const s = settings as Record<string, unknown>;
  const flows = s.flows;
  if (flows && typeof flows === "object" && "editFlow" in flows) {
    const v = (flows as Record<string, unknown>).editFlow;
    if (typeof v === "boolean") return v;
  }
  if (typeof s.flowsEditFlow === "boolean") return s.flowsEditFlow;
  return undefined;
}

/** Absent / unreadable / unparseable → undefined (pi-flows `readSettingsFile`). */
function readFlagFile(file: string): boolean | undefined {
  try {
    return readEditFlowFlag(JSON.parse(fs.readFileSync(file, "utf-8")));
  } catch {
    return undefined;
  }
}

export interface ResolveOptions {
  /** Defaults to `os.homedir()`. */
  home?: string;
}

/** Effective edit mode for `cwd`: project ?? global ?? false. Never writes. */
export function resolveEditMode(cwd: string, opts: ResolveOptions = {}): boolean {
  const project = readFlagFile(projectSettingsPath(cwd));
  if (project !== undefined) return project;
  return readFlagFile(globalSettingsPath(opts.home)) ?? false;
}

/** Resolve many cwds reading the global file once and each project file once. */
function resolveEditModeMany(cwds: Iterable<string>, opts: ResolveOptions): Map<string, boolean> {
  const global = readFlagFile(globalSettingsPath(opts.home)) ?? false;
  const out = new Map<string, boolean>();
  for (const cwd of cwds) {
    if (!out.has(cwd)) out.set(cwd, readFlagFile(projectSettingsPath(cwd)) ?? global);
  }
  return out;
}

// ── Session registry helpers ─────────────────────────────────────────

interface ActiveSession {
  id: string;
  cwd: string;
}

function activeSessions(sm: { listActive(): unknown[] }): ActiveSession[] {
  const out: ActiveSession[] = [];
  for (const s of sm.listActive()) {
    const r = s as { id?: unknown; cwd?: unknown; status?: unknown } | null;
    if (r && typeof r.id === "string" && typeof r.cwd === "string" && r.status !== "ended") {
      out.push({ id: r.id, cwd: r.cwd });
    }
  }
  return out;
}

export interface EditModeDeps {
  sessionManager: { listActive(): unknown[] };
  broadcastToSubscribers: (msg: unknown) => void;
  /** Test seam for `os.homedir()`. */
  home?: string;
  /** Test seam for the locked write's fs calls. */
  lockFs?: FsDeps["fs"];
}

const lockDeps = (deps: Pick<EditModeDeps, "home" | "lockFs">): FsDeps => ({
  settingsPath: globalSettingsPath(deps.home),
  ...(deps.lockFs ? { fs: deps.lockFs } : {}),
});

/**
 * Push the effective state to every active session whose cwd is in `cwds`
 * (all active sessions when omitted). One read per distinct cwd.
 */
export function broadcastEditModeState(
  deps: EditModeDeps,
  cwds?: ReadonlySet<string>,
  extra?: { sessionId: string; error: EditModeError },
): void {
  const sessions = activeSessions(deps.sessionManager).filter((s) => !cwds || cwds.has(s.cwd));
  const resolved = resolveEditModeMany(
    sessions.map((s) => s.cwd),
    { home: deps.home },
  );
  for (const s of sessions) {
    const frame: EditModeStateFrame = { type: EDIT_MODE_STATE_FRAME, sessionId: s.id, enabled: resolved.get(s.cwd) ?? false };
    if (extra && extra.sessionId === s.id) frame.error = extra.error;
    deps.broadcastToSubscribers(frame);
  }
}

// ── Routes (D2, D4) ──────────────────────────────────────────────────

export interface EditModeRouteDeps extends EditModeDeps {
  fastify: ServerPluginContext["fastify"];
  networkGuard: ServerPluginContext["networkGuard"];
}

/** Write `flows.editFlow` to the global file under pi's lock. */
async function writeGlobalEditMode(
  enabled: boolean,
  deps: Pick<EditModeDeps, "home" | "lockFs">,
): Promise<{ ok: true } | { ok: false; status: number; parseError?: string; error: string }> {
  const r = await withPiSettingsLock<null, { parseError: string }>(
    (state) => {
      if (state.parseError) return { fail: { parseError: state.parseError } };
      const next = { ...state.settings, flows: { ...asObject(state.settings.flows), editFlow: enabled } };
      return { value: null, write: formatJson(next) };
    },
    {},
    lockDeps(deps),
  );
  if (r.ok) return { ok: true };
  if (r.error === "fn") return { ok: false, status: 400, error: "unparseable settings", parseError: r.fail.parseError };
  if (r.error === "busy") return { ok: false, status: 503, error: "settings locked" };
  return { ok: false, status: 500, error: "write failed" };
}

export async function registerEditModeRoutes(deps: EditModeRouteDeps): Promise<void> {
  await deps.fastify.register(async (scope) => {
    await scope.register(rateLimit, { global: true, max: 600, timeWindow: "1 minute", allowList: ["127.0.0.1", "::1"] });

    scope.get("/api/plugins/flows/edit-mode-default", { preHandler: deps.networkGuard }, async () => {
      const state = readPiSettings(lockDeps(deps));
      return {
        enabled: readEditFlowFlag(state.settings) ?? false,
        ...(state.parseError ? { parseError: state.parseError } : {}),
      };
    });

    scope.put("/api/plugins/flows/edit-mode-default", { preHandler: deps.networkGuard }, async (req, reply) => {
      const enabled = (req.body as { enabled?: unknown } | null)?.enabled;
      if (typeof enabled !== "boolean") return reply.code(400).send({ error: "body must be { enabled: boolean }" });
      const r = await writeGlobalEditMode(enabled, deps);
      if (!r.ok) {
        return reply.code(r.status).send({ error: r.error, ...(r.parseError ? { parseError: r.parseError } : {}) });
      }
      broadcastEditModeState(deps);
      return { enabled };
    });

    scope.get("/api/plugins/flows/edit-mode-state", { preHandler: deps.networkGuard }, async (req, reply) => {
      const id = (req.query as { sessionId?: unknown } | null)?.sessionId;
      const session = typeof id === "string" && id ? activeSessions(deps.sessionManager).find((s) => s.id === id) : undefined;
      if (!session) return reply.code(404).send({ error: "session not found" });
      return { enabled: resolveEditMode(session.cwd, { home: deps.home }) };
    });
  });
}

// ── Per-project action (D5) ──────────────────────────────────────────

export interface SetEditModeDeps extends EditModeDeps {
  emitEventToSession: (sessionId: string, eventType: string, data: Record<string, unknown>) => boolean;
  logger?: { info(m: string): void; warn(m: string): void };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * `flow.set-edit-mode { enabled }` — `enabled` is the DESIRED value (the
 * label the user clicked). Emits `flow:set-edit-mode` only when it differs
 * from the current effective value, then waits for pi-flows' project write
 * and pushes the result to every session in the cwd.
 */
export async function handleSetEditMode(deps: SetEditModeDeps, sessionId: string, payload: Record<string, unknown>): Promise<void> {
  const enabled = payload.enabled;
  if (typeof enabled !== "boolean") {
    deps.logger?.warn(`flow.set-edit-mode session=${sessionId}: enabled must be boolean`);
    return;
  }
  const session = activeSessions(deps.sessionManager).find((s) => s.id === sessionId);
  if (!session) {
    deps.logger?.warn(`flow.set-edit-mode session=${sessionId}: session not active`);
    return;
  }
  const cwds = new Set([session.cwd]);
  const current = () => resolveEditMode(session.cwd, { home: deps.home });

  if (current() === enabled) {
    broadcastEditModeState(deps, cwds);
    return;
  }
  const delivered = deps.emitEventToSession(sessionId, SET_EDIT_MODE_EVENT, { enabled });
  deps.logger?.info(`flow.set-edit-mode enabled=${enabled} session=${sessionId} delivered=${delivered}`);
  if (!delivered) {
    broadcastEditModeState(deps, cwds, { sessionId, error: "not-delivered" });
    return;
  }
  for (let i = 0; i < SET_EDIT_MODE_POLL.attempts; i++) {
    await sleep(SET_EDIT_MODE_POLL.intervalMs);
    if (current() === enabled) {
      broadcastEditModeState(deps, cwds);
      return;
    }
  }
  broadcastEditModeState(deps, cwds, { sessionId, error: "timeout" });
}

// ── Legacy migration (D6) ────────────────────────────────────────────

export interface MigrationCtx {
  getPluginConfig<T = Record<string, unknown>>(): T;
  updatePluginConfig<T = Record<string, unknown>>(partial: Partial<T>): Promise<void>;
}

/**
 * One-time: a legacy plugin-config `editFlow: true` becomes the global
 * `flows.editFlow: true` when the global file has no edit-mode value (checked
 * inside the lock). The key is then dropped. Failure keeps the key so the
 * next start retries. Never writes a project file.
 */
export async function migrateLegacyEditFlow(
  ctx: MigrationCtx,
  deps: Pick<EditModeDeps, "home" | "lockFs"> & { logger?: { info(m: string): void; warn(m: string): void } } = {},
): Promise<"none" | "migrated" | "cleared" | "deferred"> {
  const config = ctx.getPluginConfig<{ editFlow?: unknown }>() ?? {};
  if (!("editFlow" in config) || config.editFlow === undefined) return "none";
  let outcome: "migrated" | "cleared" = "cleared";
  if (config.editFlow === true) {
    const r = await withPiSettingsLock<boolean, { parseError: string }>(
      (state) => {
        if (state.parseError) return { fail: { parseError: state.parseError } };
        if (readEditFlowFlag(state.settings) !== undefined) return { value: false };
        const next = { ...state.settings, flows: { ...asObject(state.settings.flows), editFlow: true } };
        return { value: true, write: formatJson(next) };
      },
      {},
      lockDeps(deps),
    );
    if (!r.ok) {
      deps.logger?.warn(`flows: legacy editFlow migration deferred (${r.error})`);
      return "deferred";
    }
    if (r.value) outcome = "migrated";
  }
  await ctx.updatePluginConfig({ editFlow: undefined });
  deps.logger?.info(`flows: legacy editFlow ${outcome}`);
  return outcome;
}
