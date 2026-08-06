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
import type { CanonicalSessionStore } from "./canonical-session-store.js";

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
    /** Resume an existing session's transcript (`--continue <sessionFile>`)
     *  instead of spawning a fresh one. See change: make-invoice-session-canonical (§6). */
    resumeSessionFile?: string;
  }) => Promise<{ success: boolean; message?: string; spawnToken?: string }>;
  emitEventToSession: (sessionId: string, eventType: string, data?: Record<string, unknown>) => boolean;
  getSession: (id: string) => unknown;
  listAll: () => unknown[];
  onEvent: (handler: (sessionId: string, event: unknown) => void) => () => void;
  /** Invoice-specific recorded session ids, newest first (engine view:"runs"). */
  resolveRecordedSessionIds?: (cwd: string, invoiceId: string) => Promise<string[]>;
  /** Durable canonical invoice→session store (Decision 1, Option B). When
   *  absent (older callers / unit fakes), resolution degrades to the in-memory
   *  cache + live scans only — no durable identity across restart/resume. */
  canonicalStore?: CanonicalSessionStore;
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
  /** §5.4: the bound scope env (IB_TOOLSET/IB_INVOICE_ID) to re-apply when a
   *  resumed canonical session's continue-spawn boots, or undefined when the id
   *  is not a canonical invoice session. Consumed by the host's auto-resume. */
  resumeScopeEnv(sessionId: string): Record<string, string> | undefined;
  /** Test/observability: the recorded invoice_id → sessionId links. */
  links(): ReadonlyMap<string, string>;
  dispose(): void;
}

const DEFAULT_SPAWN_BIND_TIMEOUT_MS = 15_000;
/** How long a pending resume re-point waits for its successor to register (§1b). */
const RESUME_REPOINT_TTL_MS = 60_000;
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

/**
 * The CARD's gate (§1c) — stricter than `isInvoicebotSession`. A session may be
 * adopted as an invoice's canonical CHAT session only when it is that invoice's
 * OWN scoped session.
 *
 * Why the loose prefix gate is wrong here: the shared `invoicebot-intake`
 * automation records itself into the invoice's `invoice_runs`, and its name
 * starts with "invoicebot", so it passed. But intake spawns with no bound
 * invoice ⇒ no `IB_TOOLSET`/`IB_INVOICE_ID` ⇒ the session boots the GLOBAL "ask"
 * profile and greets with the Ask opener instead of the invoice opener.
 *
 * Deliberately narrower than task 1c.3, which also wanted an `invoicebot:process`
 * run "bound to the invoice" accepted: a bound and an intake-spawned process run
 * are BOTH stamped `automationRun.name === "invoicebot:process"`, so they are
 * indistinguishable from the session record — and the intake-spawned one is
 * unscoped. Accepting the name would reinstate the very bug. Falling through
 * costs one scoped spawn and always yields the correct surface.
 *
 * Scope-only: `reuseTarget`/`dispatchFlow` keep the loose gate (1c.4) — emitting
 * `flow:run` into a live intake session is still correct.
 */
function isScopedInvoiceSession(
  s: SessionShape | undefined,
  cwd: string,
  invoiceId: string,
): s is SessionShape {
  return isInvoicebotSession(s, cwd) && s.automationRun?.name === scopedAutomationName(invoiceId);
}

export function createSessionLink(deps: SessionLinkDeps): SessionLink {
  const invoiceToSession = new Map<string, string>();
  const scopedInvoiceToSession = new Map<string, string>();
  const pendingByRunId = new Map<
    string,
    { cwd: string; flow?: FlowRunSpec; invoiceId?: string; delivered: boolean; resolve: (sid: string | undefined) => void }
  >();
  const timeoutMs = deps.spawnBindTimeoutMs ?? DEFAULT_SPAWN_BIND_TIMEOUT_MS;
  // Sessions this seam has bound (spawn-correlated or resume-re-pointed). A bound
  // session is "owned" and is never a re-point candidate for another invoice.
  const boundSessionIds = new Set<string>();
  // Pending resume re-points, keyed by cwd (§1b). Armed when resolution hands
  // back an ended-but-restorable canonical id; consumed when the resume
  // successor registers. Mirrors the pendingAutomationRunRegistry per-cwd shape.
  const pendingRepointByCwd = new Map<string, { invoiceId: string; at: number }[]>();

  // Correlate a registering run session to its pending spawn by the host-stamped
  // automationRun.runId (authoritative), then deliver flow:run + link. A session
  // that is NOT a pending spawn may be a resume successor to re-point (§1b).
  const unsub = deps.onEvent((sessionId, _event) => {
    const s = deps.getSession(sessionId) as SessionShape | undefined;
    const runId = s?.automationRun?.runId;
    const pend = runId ? pendingByRunId.get(runId) : undefined;
    if (pend && !pend.delivered) {
      pend.delivered = true;
      pendingByRunId.delete(runId!);
      boundSessionIds.add(sessionId);
      try {
        if (pend.flow) {
          deps.emitEventToSession(sessionId, "flow:run", pend.flow as unknown as Record<string, unknown>);
        }
        if (pend.invoiceId) {
          invoiceToSession.set(pend.invoiceId, sessionId);
          scopedInvoiceToSession.set(scopedLinkKey(pend.cwd, pend.invoiceId), sessionId);
          // Record the durable canonical link on the spawn that established it.
          deps.canonicalStore?.set(pend.cwd, pend.invoiceId, sessionId);
        }
      } catch (err) {
        deps.logger.warn(`invoicebot dispatch delivery failed for runId=${runId}: ${err instanceof Error ? err.message : String(err)}`);
      }
      pend.resolve(sessionId);
      return;
    }
    // Not a pending spawn → maybe the successor of a resumed canonical session.
    maybeRepointResumeSuccessor(sessionId, s?.cwd);
  });

  function hasPendingSpawnForCwd(cwd: string): boolean {
    for (const p of pendingByRunId.values()) if (p.cwd === cwd && !p.delivered) return true;
    return false;
  }

  /** Arm a pending re-point: the next non-spawn session to register in `cwd` is
   *  the resume successor of this invoice's canonical session (§1b). */
  function enqueueResumeRepoint(cwd: string, invoiceId: string): void {
    const q = pendingRepointByCwd.get(cwd) ?? [];
    if (q.some((e) => e.invoiceId === invoiceId)) return; // already awaiting a successor
    q.push({ invoiceId, at: Date.now() });
    pendingRepointByCwd.set(cwd, q);
  }

  function consumePendingRepoint(cwd: string): string | undefined {
    const q = pendingRepointByCwd.get(cwd);
    if (!q || q.length === 0) return undefined;
    const cutoff = Date.now() - RESUME_REPOINT_TTL_MS;
    while (q.length > 0 && q[0]!.at < cutoff) q.shift();
    const head = q.shift();
    if (q.length === 0) pendingRepointByCwd.delete(cwd);
    else pendingRepointByCwd.set(cwd, q);
    return head?.invoiceId;
  }

  /** §1b: a session registering in a cwd with a pending re-point is the resume
   *  successor — re-point the store to it (the successor id, not the stale ended
   *  id, is now canonical). Skipped while a spawn is in flight for the cwd so a
   *  new-invoice spawn cannot consume a sibling's pending re-point. The store
   *  binding is the authority; the successor carries no automationRun stamp. */
  function maybeRepointResumeSuccessor(sessionId: string, cwd?: string): void {
    if (!cwd || boundSessionIds.has(sessionId)) return;
    if (hasPendingSpawnForCwd(cwd)) return;
    const invoiceId = consumePendingRepoint(cwd);
    if (!invoiceId) return;
    deps.canonicalStore?.set(cwd, invoiceId, sessionId);
    scopedInvoiceToSession.set(scopedLinkKey(cwd, invoiceId), sessionId);
    boundSessionIds.add(sessionId);
    deps.logger.info(`invoicebot canonical repoint: invoice ${invoiceId} → resumed session ${sessionId}`);
  }

  function reuseTarget(cwd: string, sessionId?: string, invoiceId?: string): string | undefined {
    const candidate = sessionId ?? (invoiceId ? invoiceToSession.get(invoiceId) : undefined);
    if (!candidate) return undefined;
    const s = deps.getSession(candidate) as SessionShape | undefined;
    return isInvoicebotSession(s, cwd) ? candidate : undefined;
  }

  /** Spawn (or, when `resumeSessionFile` is set, RESUME) a run session, correlate
   *  by runId (deliver-on-register), return the bound sessionId. A resume
   *  continues the canonical transcript rather than starting a fresh one-shot. */
  async function spawnAndBind(cwd: string, flow: FlowRunSpec, invoiceId?: string, resumeSessionFile?: string): Promise<string | undefined> {
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
        ...(resumeSessionFile ? { resumeSessionFile } : {}),
        // §1c.5: a spawn that carries a bound invoice IS the invoice's scoped
        // session (it gets the scope env above), so STAMP it as one. Without the
        // stamp a bound run and a shared intake run are both "invoicebot:process"
        // and indistinguishable later, which is what forced the card to re-spawn.
        automationRun: {
          name: invoiceId ? scopedAutomationName(invoiceId) : flow.flowName,
          runId,
          visibility: "shown",
        },
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
    // §1c: scoped-gated — never keep a global/intake id as the card's session.
    if (isScopedInvoiceSession(session, cwd, invoiceId) && session.status !== "ended") return linked;
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
    deps.canonicalStore?.set(cwd, invoiceId, session.id);
    return session.id;
  }

  /** Durable-store canonical resolution (Decision 1, Option B). The store binding
   *  is the authority — a restart/resume session carries no automationRun stamp,
   *  so this does NOT gate on isInvoicebotSession. Returns a live or
   *  ended-but-restorable id; drops an unrecoverable entry (ended + missing file)
   *  so resolution falls through to a single re-spawn + re-link. */
  function storeResolvedScopedSession(cwd: string, invoiceId: string): string | undefined {
    const stored = deps.canonicalStore?.get(cwd, invoiceId);
    if (!stored) return undefined;
    const session = deps.getSession(stored) as SessionShape | undefined;
    if (!session || session.cwd !== cwd) {
      // The stored id points at nothing / a different workspace — stale.
      deps.canonicalStore?.delete(cwd, invoiceId);
      scopedInvoiceToSession.delete(scopedLinkKey(cwd, invoiceId));
      return undefined;
    }
    if (session.status !== "ended") {
      scopedInvoiceToSession.set(scopedLinkKey(cwd, invoiceId), stored);
      return stored;
    }
    if (session.sessionFile && existsSync(session.sessionFile)) {
      scopedInvoiceToSession.set(scopedLinkKey(cwd, invoiceId), stored);
      enqueueResumeRepoint(cwd, invoiceId); // a resume is imminent → follow it (§1b)
      return stored;
    }
    // ended + missing file → unrecoverable; drop so resolution re-spawns.
    deps.canonicalStore?.delete(cwd, invoiceId);
    scopedInvoiceToSession.delete(scopedLinkKey(cwd, invoiceId));
    return undefined;
  }

  async function lookupRecordedIds(cwd: string, invoiceId: string): Promise<string[]> {
    try {
      return (await deps.resolveRecordedSessionIds?.(cwd, invoiceId)) ?? [];
    } catch (err) {
      deps.logger.warn(`invoicebot recorded-session lookup failed: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  // §1c: gated on the invoice's OWN scoped session. `invoice_runs` records every
  // session that touched the invoice — including the shared intake automation —
  // so the loose invoicebot-prefix gate adopted a global-profile session here.
  function isUsableRecordedSession(
    session: SessionShape | undefined,
    cwd: string,
    invoiceId: string,
  ): session is SessionShape {
    if (!isScopedInvoiceSession(session, cwd, invoiceId)) return false;
    if (session.status !== "ended") return true;
    return !!session.sessionFile && existsSync(session.sessionFile);
  }

  async function recordedUsableSession(cwd: string, invoiceId: string): Promise<string | undefined> {
    for (const id of await lookupRecordedIds(cwd, invoiceId)) {
      const session = deps.getSession(id) as SessionShape | undefined;
      if (!isUsableRecordedSession(session, cwd, invoiceId)) continue;
      scopedInvoiceToSession.set(scopedLinkKey(cwd, invoiceId), id);
      deps.canonicalStore?.set(cwd, invoiceId, id);
      if (session.status === "ended") enqueueResumeRepoint(cwd, invoiceId);
      return id;
    }
    return undefined;
  }

  async function ensureScopedSessionUnsafe(cwd: string, invoiceId: string): Promise<string | undefined> {
    return (
      linkedLiveScopedSession(cwd, invoiceId) ??
      storeResolvedScopedSession(cwd, invoiceId) ??
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

  /** Durable-store canonical id for an invoice, validated to the cwd (the store
   *  binding — not the automationRun stamp — is the authority; a resumed/restart
   *  session is stampless). Drops a stale entry pointing nowhere / elsewhere. */
  function storeCanonicalId(cwd: string, invoiceId: string): string | undefined {
    const id = deps.canonicalStore?.get(cwd, invoiceId);
    if (!id) return undefined;
    const s = deps.getSession(id) as SessionShape | undefined;
    if (!s || s.cwd !== cwd) {
      deps.canonicalStore?.delete(cwd, invoiceId);
      return undefined;
    }
    return id;
  }

  async function dispatchFlow(args: DispatchArgs): Promise<string | undefined> {
    const { cwd, flow, sessionId, invoiceId } = args;

    // Resolve the invoice's canonical target: an explicit sessionId or in-mem
    // link (stamp-gated for security), else the durable store (authority — a
    // resumed/restart session is stampless). See change:
    // make-invoice-session-canonical (§6).
    const canonicalId =
      reuseTarget(cwd, sessionId, invoiceId) ??
      (invoiceId ? storeCanonicalId(cwd, invoiceId) : undefined);

    if (canonicalId) {
      // REUSE — deliver flow:run to a live bridge.
      const ok = deps.emitEventToSession(canonicalId, "flow:run", flow as unknown as Record<string, unknown>);
      if (ok) {
        if (invoiceId) {
          invoiceToSession.set(invoiceId, canonicalId);
          // §1c.5: delivery may reuse a shared intake session (1c.4), but only the
          // invoice's OWN scoped session may become the CARD's canonical one.
          // Recording an intake id here is what defeated the §1c read gates: the
          // card reads the store back through `storeResolvedScopedSession`, which
          // is deliberately ungated, so the intake id came straight back and the
          // card opened on the global Ask greeting. A stampless session that is
          // ALREADY the stored canonical stays canonical (§1b resume successor).
          const target = deps.getSession(canonicalId) as SessionShape | undefined;
          if (isScopedInvoiceSession(target, cwd, invoiceId) || storeCanonicalId(cwd, invoiceId) === canonicalId) {
            scopedInvoiceToSession.set(scopedLinkKey(cwd, invoiceId), canonicalId);
            deps.canonicalStore?.set(cwd, invoiceId, canonicalId);
          }
        }
        return canonicalId;
      }
      // No live bridge → RESUME the canonical transcript (--continue) and deliver
      // flow:run on the resumed successor's register. NOT a fresh one-shot.
      const s = deps.getSession(canonicalId) as SessionShape | undefined;
      if (s?.sessionFile && existsSync(s.sessionFile)) {
        return spawnAndBind(cwd, flow, invoiceId, s.sessionFile);
      }
      // Canonical transcript is gone → unrecoverable; drop the stale link and
      // spawn a fresh replacement (re-linked as canonical on bind).
      if (invoiceId) {
        deps.canonicalStore?.delete(cwd, invoiceId);
        scopedInvoiceToSession.delete(scopedLinkKey(cwd, invoiceId));
      }
    }

    // SPAWN — new invoice (or unrecoverable canonical). Records canonical on bind.
    return spawnAndBind(cwd, flow, invoiceId);
  }

  /** §5.4: derive the scope env for a resumed canonical session from the durable
   *  store's reverse lookup. A resumed session carries no stamp, so without this
   *  its continue-spawn boots on the full "ask" surface with no bound invoice. */
  function resumeScopeEnv(sessionId: string): Record<string, string> | undefined {
    const scope = deps.canonicalStore?.scopeFor(sessionId);
    if (!scope) return undefined;
    return { IB_TOOLSET: "scoped-invoice", IB_INVOICE_ID: scope.invoiceId };
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
    resumeScopeEnv,
    links: () => invoiceToSession,
    dispose: () => unsub(),
  };
}
