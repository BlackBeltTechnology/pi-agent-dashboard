/**
 * Session-linkage seam for the flow-triggering ops (§5, §6).
 *
 * Two paths advance an invoice through a pi-flows flow in a pi SESSION:
 *   - REUSE  — a live, cwd-matched invoicebot session (supplied `sessionId` or a
 *     recorded `invoice_id ↔ sessionId` link) receives the `flow:run` via
 *     `emitEventToSession`. No spawn.
 *   - SPAWN  — else `spawnSession({ cwd, automationRun:{ runId } })`; the run
 *     session is correlated back by matching the host-stamped `automationRun.runId`
 *     (NEVER by cwd — a cwd-FIFO bind targets the wrong session, the documented
 *     automation-plugin footgun). The `flow:run` is delivered inside the
 *     correlation handler (deliver-on-register), then the `sessionId` is linked.
 *
 * Every op returns the `sessionId` (or the `spawnToken`/`runId` to resolve it).
 * `resolveSessionId` returns the linked session, falling back to a `listAll`
 * scan for intake-spawned sessions, and `null` (never throws) when none matches.
 *
 * See change: add-invoicebot-rest-plugin (Decision 3).
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { FlowRunSpec } from "./engine/port.js";

/** Minimal session shape we read from the host session manager. */
interface SessionShape {
  id: string;
  cwd?: string;
  status?: "active" | "idle" | "streaming" | "ended";
  sessionFile?: string;
  automationRun?: { runId?: string; name?: string };
}

export interface SessionLinkDeps {
  spawnSession: (opts: {
    cwd: string;
    model?: string;
    /** Mark the spawn guarded (built-in tools disabled + cwd registered). See change: constrain-agent-tool-surface. */
    guard?: boolean;
    /** Caller-supplied spawn env; scopes the per-invoice session's tool surface. See change: scope-session-toolset-by-profile. */
    env?: Record<string, string>;
    automationRun?: { name: string; runId: string; visibility?: "hidden" | "shown" };
  }) => Promise<{ success: boolean; message?: string; spawnToken?: string }>;
  emitEventToSession: (sessionId: string, eventType: string, data?: Record<string, unknown>) => boolean;
  getSession: (id: string) => unknown;
  listAll: () => unknown[];
  onEvent: (handler: (sessionId: string, event: unknown) => void) => () => void;
  /** Invoice-specific recorded session ids, newest first (engine view:"runs"). */
  resolveRecordedSessionIds?: (cwd: string, invoiceId: string) => Promise<string[]>;
  logger: { info: (m: string) => void; warn: (m: string) => void };
  /** Max wait (ms) for a spawned run session to register + correlate. */
  spawnBindTimeoutMs?: number;
}

export interface DispatchArgs {
  cwd: string;
  flow: FlowRunSpec;
  /** Caller-supplied reuse target (api-contract §5). */
  sessionId?: string;
  /** Invoice this flow advances — recorded once a session binds. */
  invoiceId?: string;
}

export interface SessionLink {
  dispatchFlow(args: DispatchArgs): Promise<string | undefined>;
  ensureScopedSession(cwd: string, invoiceId: string): Promise<string | undefined>;
  resolveSessionId(invoiceId: string, cwd?: string): string | null;
  /** Test/observability: the recorded invoice_id → sessionId links. */
  links(): ReadonlyMap<string, string>;
  dispose(): void;
}

const DEFAULT_SPAWN_BIND_TIMEOUT_MS = 15_000;
const SCOPED_AUTOMATION_PREFIX = "invoicebot-scoped:";

function scopedAutomationName(invoiceId: string): string {
  return `${SCOPED_AUTOMATION_PREFIX}${encodeURIComponent(invoiceId)}`;
}

function scopedLinkKey(cwd: string, invoiceId: string): string {
  return `${cwd}\0${invoiceId}`;
}

/** Parse engine view:"runs" details into valid session ids, newest first. */
export function recordedSessionIdsFromDetails(details: Record<string, unknown>): string[] {
  if (!Array.isArray(details.runs)) return [];
  return details.runs
    .map((run, idx) => {
      if (!run || typeof run !== "object") return undefined;
      const row = run as Record<string, unknown>;
      if (typeof row.session_id !== "string" || !row.session_id) return undefined;
      const parsed = Date.parse(String(row.started_at ?? ""));
      return { id: row.session_id, ts: Number.isFinite(parsed) ? parsed : 0, idx };
    })
    .filter((row): row is { id: string; ts: number; idx: number } => row !== undefined)
    .sort((a, b) => b.ts - a.ts || b.idx - a.idx)
    .map((row) => row.id);
}

/** A session is a reuse/scan target only when it is live, in `cwd`, AND an
 *  invoicebot session (an automationRun stamped by us or by intake). Never emit
 *  `flow:run` into an unrelated user session — the security gate. */
function isInvoicebotSession(s: SessionShape | undefined, cwd: string): s is SessionShape {
  return (
    !!s &&
    typeof s.id === "string" &&
    s.cwd === cwd &&
    typeof s.automationRun?.name === "string" &&
    s.automationRun.name.startsWith("invoicebot")
  );
}

export function createSessionLink(deps: SessionLinkDeps): SessionLink {
  const invoiceToSession = new Map<string, string>();
  const scopedInvoiceToSession = new Map<string, string>();
  const pendingByRunId = new Map<
    string,
    { cwd: string; flow?: FlowRunSpec; invoiceId?: string; delivered: boolean; resolve: (sid: string | undefined) => void }
  >();
  const timeoutMs = deps.spawnBindTimeoutMs ?? DEFAULT_SPAWN_BIND_TIMEOUT_MS;

  // Correlate a registering run session to its pending spawn by the host-stamped
  // automationRun.runId (authoritative), then deliver flow:run + link.
  const unsub = deps.onEvent((sessionId, _event) => {
    const s = deps.getSession(sessionId) as SessionShape | undefined;
    const runId = s?.automationRun?.runId;
    if (!runId) return;
    const pend = pendingByRunId.get(runId);
    if (!pend || pend.delivered) return;
    pend.delivered = true;
    pendingByRunId.delete(runId);
    try {
      if (pend.flow) {
        deps.emitEventToSession(sessionId, "flow:run", pend.flow as unknown as Record<string, unknown>);
      }
      if (pend.invoiceId) {
        invoiceToSession.set(pend.invoiceId, sessionId);
        scopedInvoiceToSession.set(scopedLinkKey(pend.cwd, pend.invoiceId), sessionId);
      }
    } catch (err) {
      deps.logger.warn(`invoicebot dispatch delivery failed for runId=${runId}: ${err instanceof Error ? err.message : String(err)}`);
    }
    pend.resolve(sessionId);
  });

  function reuseTarget(cwd: string, sessionId?: string, invoiceId?: string): string | undefined {
    const candidate = sessionId ?? (invoiceId ? invoiceToSession.get(invoiceId) : undefined);
    if (!candidate) return undefined;
    const s = deps.getSession(candidate) as SessionShape | undefined;
    return isInvoicebotSession(s, cwd) ? candidate : undefined;
  }

  /** Spawn a run session, correlate by runId (deliver-on-register), return the bound sessionId. */
  async function spawnAndBind(cwd: string, flow: FlowRunSpec, invoiceId?: string): Promise<string | undefined> {
    const runId = randomUUID();
    const bound = new Promise<string | undefined>((resolve) => {
      pendingByRunId.set(runId, { cwd, flow, invoiceId, delivered: false, resolve });
      const t = setTimeout(() => {
        const p = pendingByRunId.get(runId);
        if (p && !p.delivered) {
          pendingByRunId.delete(runId);
          resolve(undefined);
        }
      }, timeoutMs);
      if (typeof t.unref === "function") t.unref();
    });

    // Scope the tool surface to this one invoice — only when an invoice id is
    // bound. An unbound spawn (the persistent "Ask"/Kérdezz session) carries no
    // scope env and keeps the full surface. See change: scope-session-toolset-by-profile.
    const scopeEnv = invoiceId ? { IB_TOOLSET: "scoped-invoice", IB_INVOICE_ID: invoiceId } : undefined;

    let spawn: { success: boolean; message?: string; spawnToken?: string };
    try {
      spawn = await deps.spawnSession({
        cwd,
        guard: true,
        ...(scopeEnv ? { env: scopeEnv } : {}),
        automationRun: { name: flow.flowName, runId, visibility: "shown" },
      });
    } catch (err) {
      pendingByRunId.delete(runId);
      deps.logger.warn(`invoicebot spawnSession threw for ${flow.flowName}: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
    if (!spawn.success) {
      pendingByRunId.delete(runId);
      deps.logger.warn(`invoicebot spawnSession rejected for ${flow.flowName}: ${spawn.message ?? "not trusted / no capacity"}`);
      return undefined;
    }

    const sid = await bound;
    // Fall back to the spawnToken (the client can resolve it) if the bind timed out.
    return sid ?? spawn.spawnToken;
  }

  /** Spawn a flow-less scoped chat and return only its registered session id. */
  async function spawnScopedAndBind(cwd: string, invoiceId: string): Promise<string | undefined> {
    const runId = randomUUID();
    const bound = new Promise<string | undefined>((resolve) => {
      pendingByRunId.set(runId, { cwd, invoiceId, delivered: false, resolve });
      const t = setTimeout(() => {
        const p = pendingByRunId.get(runId);
        if (p && !p.delivered) {
          pendingByRunId.delete(runId);
          resolve(undefined);
        }
      }, timeoutMs);
      if (typeof t.unref === "function") t.unref();
    });

    try {
      const spawn = await deps.spawnSession({
        cwd,
        guard: true,
        env: { IB_TOOLSET: "scoped-invoice", IB_INVOICE_ID: invoiceId },
        automationRun: {
          name: scopedAutomationName(invoiceId),
          runId,
          visibility: "shown",
        },
      });
      if (!spawn.success) {
        pendingByRunId.delete(runId);
        deps.logger.warn(`invoicebot scoped spawn rejected: ${spawn.message ?? "not trusted / no capacity"}`);
        return undefined;
      }
    } catch (err) {
      pendingByRunId.delete(runId);
      deps.logger.warn(`invoicebot scoped spawn threw: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }

    // Unlike dispatchFlow, this contract never masquerades spawnToken as sessionId.
    return bound;
  }

  function linkedLiveScopedSession(cwd: string, invoiceId: string): string | undefined {
    const key = scopedLinkKey(cwd, invoiceId);
    const linked = scopedInvoiceToSession.get(key);
    if (!linked) return undefined;
    const session = deps.getSession(linked) as SessionShape | undefined;
    if (isInvoicebotSession(session, cwd) && session.status !== "ended") return linked;
    scopedInvoiceToSession.delete(key);
    return undefined;
  }

  function restoredLiveScopedSession(cwd: string, invoiceId: string): string | undefined {
    const expectedName = scopedAutomationName(invoiceId);
    const session = (deps.listAll() as SessionShape[]).find(
      (candidate) =>
        isInvoicebotSession(candidate, cwd) &&
        candidate.status !== "ended" &&
        candidate.automationRun?.name === expectedName,
    );
    if (!session) return undefined;
    scopedInvoiceToSession.set(scopedLinkKey(cwd, invoiceId), session.id);
    return session.id;
  }

  async function lookupRecordedIds(cwd: string, invoiceId: string): Promise<string[]> {
    try {
      return (await deps.resolveRecordedSessionIds?.(cwd, invoiceId)) ?? [];
    } catch (err) {
      deps.logger.warn(`invoicebot recorded-session lookup failed: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  function isUsableRecordedSession(session: SessionShape | undefined, cwd: string): session is SessionShape {
    if (!isInvoicebotSession(session, cwd)) return false;
    if (session.status !== "ended") return true;
    return !!session.sessionFile && existsSync(session.sessionFile);
  }

  async function recordedUsableSession(cwd: string, invoiceId: string): Promise<string | undefined> {
    for (const id of await lookupRecordedIds(cwd, invoiceId)) {
      const session = deps.getSession(id) as SessionShape | undefined;
      if (!isUsableRecordedSession(session, cwd)) continue;
      scopedInvoiceToSession.set(scopedLinkKey(cwd, invoiceId), id);
      return id;
    }
    return undefined;
  }

  async function ensureScopedSessionUnsafe(cwd: string, invoiceId: string): Promise<string | undefined> {
    return (
      linkedLiveScopedSession(cwd, invoiceId) ??
      restoredLiveScopedSession(cwd, invoiceId) ??
      (await recordedUsableSession(cwd, invoiceId)) ??
      (await spawnScopedAndBind(cwd, invoiceId))
    );
  }

  async function ensureScopedSession(cwd: string, invoiceId: string): Promise<string | undefined> {
    try {
      return await ensureScopedSessionUnsafe(cwd, invoiceId);
    } catch (err) {
      deps.logger.warn(`invoicebot scoped-session bootstrap failed: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }

  async function dispatchFlow(args: DispatchArgs): Promise<string | undefined> {
    const { cwd, flow, sessionId, invoiceId } = args;

    // REUSE — a validated live session receives flow:run directly.
    const reuse = reuseTarget(cwd, sessionId, invoiceId);
    if (reuse) {
      const ok = deps.emitEventToSession(reuse, "flow:run", flow as unknown as Record<string, unknown>);
      if (ok) {
        if (invoiceId) invoiceToSession.set(invoiceId, reuse);
        return reuse;
      }
      // emit failed (session died between validate + emit) → fall through to spawn
    }

    // SPAWN
    return spawnAndBind(cwd, flow, invoiceId);
  }

  function resolveSessionId(invoiceId: string, cwd?: string): string | null {
    const linked = invoiceToSession.get(invoiceId);
    if (linked) {
      const s = deps.getSession(linked) as SessionShape | undefined;
      if (!cwd || isInvoicebotSession(s, cwd)) return linked;
    }
    if (!cwd) return null;
    // Fallback: an intake-spawned session running invoicebot:* in this workspace.
    const all = deps.listAll() as SessionShape[];
    const hit = all.find((s) => isInvoicebotSession(s, cwd));
    return hit ? hit.id : null;
  }

  return {
    dispatchFlow,
    ensureScopedSession,
    resolveSessionId,
    links: () => invoiceToSession,
    dispose: () => unsub(),
  };
}
