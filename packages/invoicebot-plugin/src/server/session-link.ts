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
import type { FlowRunSpec } from "./engine/port.js";

/** Minimal session shape we read from the host session manager. */
interface SessionShape {
  id: string;
  cwd?: string;
  automationRun?: { runId?: string; name?: string };
}

export interface SessionLinkDeps {
  spawnSession: (opts: {
    cwd: string;
    model?: string;
    /** Mark the spawn guarded (built-in tools disabled + cwd registered). See change: constrain-agent-tool-surface. */
    guard?: boolean;
    automationRun?: { name: string; runId: string; visibility?: "hidden" | "shown" };
  }) => Promise<{ success: boolean; message?: string; spawnToken?: string }>;
  emitEventToSession: (sessionId: string, eventType: string, data?: Record<string, unknown>) => boolean;
  getSession: (id: string) => unknown;
  listAll: () => unknown[];
  onEvent: (handler: (sessionId: string, event: unknown) => void) => () => void;
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
  resolveSessionId(invoiceId: string, cwd?: string): string | null;
  /** Test/observability: the recorded invoice_id → sessionId links. */
  links(): ReadonlyMap<string, string>;
  dispose(): void;
}

const DEFAULT_SPAWN_BIND_TIMEOUT_MS = 15_000;

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
  const pendingByRunId = new Map<
    string,
    { cwd: string; flow: FlowRunSpec; invoiceId?: string; delivered: boolean; resolve: (sid: string | undefined) => void }
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
      deps.emitEventToSession(sessionId, "flow:run", pend.flow as unknown as Record<string, unknown>);
      if (pend.invoiceId) invoiceToSession.set(pend.invoiceId, sessionId);
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

    let spawn: { success: boolean; message?: string; spawnToken?: string };
    try {
      spawn = await deps.spawnSession({ cwd, guard: true, automationRun: { name: flow.flowName, runId, visibility: "shown" } });
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
    resolveSessionId,
    links: () => invoiceToSession,
    dispose: () => unsub(),
  };
}
