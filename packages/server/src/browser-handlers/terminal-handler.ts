/**
 * Terminal message handlers: create, kill, rename.
 */
import { isAbsolute } from "node:path";
import type { BrowserToServerMessage, TerminalErrorMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { admissionAllows, releaseAdmission } from "@blackbelt-technology/pi-dashboard-shared/cwd-guard.js";
import { canAccessSession } from "../identity/session-access.js";
import { admitRouteCwd } from "../lib/route-admission.js";
import { TerminalLimitError } from "../terminal/terminal-manager.js";
import type { BrowserHandlerContext } from "./handler-context.js";

type Owner = { iss: string; sub: string };

/** The socket's bound principal (set at the WS upgrade); null in the inert era. */
const principalOf = (ctx: BrowserHandlerContext): Owner | null =>
  (ctx.ws as { principal?: Owner } | undefined)?.principal ?? null;

/** Owner to stamp on a new terminal: the creating principal, only while enforced. */
function ownerForSpawn(ctx: BrowserHandlerContext): Owner | undefined {
  return ctx.isResolverActive?.() ? (principalOf(ctx) ?? undefined) : undefined;
}

/**
 * Session owner gate (review r5 B1). The inline-terminal commands carry a `sessionId`
 * and WRITE `inline_terminal_open|close` events into that session's transcript, so —
 * unlike the other terminal commands, where a session id is only context — they are
 * session mutations: exact owner equality on the supplied session, or the command is
 * dropped before any PTY is spawned or killed and before any event is written.
 * Unknown / ownerless sessions are unreachable to humans (same rule as every session
 * road); the break-glass operator passes; inert plane ⇒ unchanged.
 */
function mayWriteSession(ctx: BrowserHandlerContext, sessionId: unknown): boolean {
  if (!ctx.isResolverActive?.()) return true;
  const owner = typeof sessionId === "string" ? ctx.sessionManager.get(sessionId)?.principalOwner : undefined;
  return canAccessSession({ active: true, principal: principalOf(ctx), owner });
}

/**
 * Owner gate (18.13): a terminal command from anyone but the owner (or the
 * break-glass operator) is dropped before it touches the PTY. Inert plane ⇒ allow.
 * An ownerless terminal is unreachable to humans (same rule as sessions).
 */
function mayUseTerminal(ctx: BrowserHandlerContext, terminalId: string): boolean {
  if (!ctx.isResolverActive?.()) return true;
  const t = ctx.terminalManager?.get(terminalId);
  if (!t) return true; // nothing to protect; the manager no-ops on an unknown id
  return canAccessSession({ active: true, principal: principalOf(ctx), owner: t.principalOwner });
}

/**
 * A cap refusal starts nothing and is told ONLY to the requesting socket: no
 * broadcast, no session-order insert, no inline event. Anything else rethrows
 * (the gateway logs it). See change: harden-server-capability-bounds (D3).
 */
function refuseAtCap(err: unknown, cwd: string, inline: boolean, ctx: BrowserHandlerContext): void {
  if (!(err instanceof TerminalLimitError)) throw err;
  console.warn(`[terminal] new terminal refused: ${err.scope} limit ${err.limit} reached (inline=${inline})`);
  ctx.sendTo(ctx.ws, { type: "terminal_limit_reached", scope: err.scope, limit: err.limit, cwd, inline });
}

const REFUSAL_TEXT: Record<TerminalErrorMessage["code"], string> = {
  cwd_not_admitted:
    "A terminal was not opened: this folder is not one the dashboard knows about. Open a session in it or pin it first.",
  cwd_admission_unavailable:
    "A terminal was not opened: the folder could not be verified right now. Try again in a moment.",
  session_not_found: "A terminal was not opened: the session for it no longer exists.",
};
const NO_SESSION_CWD_TEXT = "A terminal was not opened: this session has no recorded folder.";

/** `terminal_error` goes to the requesting socket ONLY; a failing send never escapes. */
function sendTerminalError(
  ctx: BrowserHandlerContext,
  code: TerminalErrorMessage["code"],
  cwd: unknown,
  inline: boolean,
  message: string = REFUSAL_TEXT[code],
): void {
  try {
    ctx.sendTo(ctx.ws, { type: "terminal_error", code, cwd: typeof cwd === "string" ? cwd : "", inline, message });
  } catch (err) {
    console.error(`[terminal] could not deliver terminal_error (${code}): ${errText(err)}`);
  }
}

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The requesting socket is closing/closed (`ws` readyState CLOSING=2 / CLOSED=3). Absent ⇒ open. */
function requesterClosed(ctx: BrowserHandlerContext): boolean {
  const state = (ctx.ws as { readyState?: number } | undefined)?.readyState;
  return state === 2 || state === 3;
}

/**
 * Standalone terminal. The cwd is admitted (shared tri-state `admitCwd`: known
 * folders = session cwds ∪ pinned dirs ∪ workspace folders, plus a worktree of one)
 * BEFORE any spawn; the cap is checked by `spawn` AFTER the await, in the same tick
 * as the spawn, so concurrent requests cannot exceed it. Never rejects: every
 * failure becomes `terminal_error{cwd_admission_unavailable}` and one log line.
 * See change: harden-git-terminal-plugin-boundaries (D14).
 */
export async function handleCreateTerminal(
  msg: Extract<BrowserToServerMessage, { type: "create_terminal" }>,
  ctx: BrowserHandlerContext,
): Promise<void> {
  const { terminalManager, sessionOrderManager, broadcast } = ctx;
  if (!terminalManager || !sessionOrderManager) return;
  const cwd: unknown = msg.cwd;
  if (typeof cwd !== "string" || cwd === "" || !isAbsolute(cwd)) {
    return sendTerminalError(ctx, "cwd_not_admitted", cwd, false);
  }
  try {
    const admission = await admitRouteCwd(cwd, ctx.terminalAdmission);
    try {
      if (admission.kind === "indeterminate") {
        console.warn(`[terminal] cwd admission undecidable for new terminal (${admission.failedProbes.join(",")})`);
        return sendTerminalError(ctx, "cwd_admission_unavailable", cwd, false);
      }
      if (!admissionAllows(admission, cwd)) return sendTerminalError(ctx, "cwd_not_admitted", cwd, false);
      if (requesterClosed(ctx)) return; // requester went away while admission was pending
      let terminal: ReturnType<typeof terminalManager.spawn>;
      try {
        terminal = terminalManager.spawn(cwd, { owner: ownerForSpawn(ctx) });
      } catch (err) {
        return refuseAtCap(err, cwd, false, ctx);
      }
      sessionOrderManager.insert(cwd, terminal.id);
      broadcast({ type: "terminal_added", terminal });
      broadcast({ type: "sessions_reordered", cwd, sessionIds: sessionOrderManager.getOrder(cwd) });
    } finally {
      if (admission.kind === "admit") releaseAdmission(admission.token);
    }
  } catch (err) {
    console.error(`[terminal] create_terminal failed: ${errText(err)}`);
    sendTerminalError(ctx, "cwd_admission_unavailable", cwd, false);
  }
}

/**
 * Open an inline interactive terminal card: spawn an ephemeral PTY, broadcast
 * terminal_added (TerminalsView filters ephemeral from tabs), then insert and
 * broadcast an `inline_terminal_open` event into the session's chat stream so
 * the card is event-sourced and replays on reload.
 * The PTY spawns at the SESSION's own recorded cwd; `msg.cwd` (kept in the
 * protocol for old clients) is ignored. Unknown session → `session_not_found`.
 * See change: add-inline-terminal-card, harden-git-terminal-plugin-boundaries (D14).
 */
export function handleOpenInlineTerminal(
  msg: Extract<BrowserToServerMessage, { type: "open_inline_terminal" }>,
  ctx: BrowserHandlerContext,
): void {
  const { terminalManager, eventStore, broadcast, broadcastEvent } = ctx;
  if (!terminalManager) return;
  if (!mayWriteSession(ctx, msg.sessionId)) return;
  let terminal: ReturnType<typeof terminalManager.spawn>;
  try {
    const sessionId: unknown = msg.sessionId;
    const session = typeof sessionId === "string" && sessionId !== "" ? ctx.sessionManager.get(sessionId) : undefined;
    if (!session) return sendTerminalError(ctx, "session_not_found", msg.cwd, true);
    const cwd: unknown = session.cwd;
    if (typeof cwd !== "string" || cwd === "") {
      return sendTerminalError(ctx, "cwd_not_admitted", msg.cwd, true, NO_SESSION_CWD_TEXT);
    }
    try {
      terminal = terminalManager.spawn(cwd, { ephemeral: true, owner: ownerForSpawn(ctx) });
    } catch (err) {
      return refuseAtCap(err, cwd, true, ctx);
    }
  } catch (err) {
    console.error(`[terminal] open_inline_terminal failed: ${errText(err)}`);
    return sendTerminalError(ctx, "cwd_admission_unavailable", msg.cwd, true);
  }
  broadcast({ type: "terminal_added", terminal });
  const seq = eventStore.insertEvent(msg.sessionId, {
    eventType: "inline_terminal_open",
    timestamp: Date.now(),
    data: { terminalId: terminal.id },
  });
  const stored = eventStore.getEvent(msg.sessionId, seq);
  broadcastEvent?.(msg.sessionId, seq, stored);
}

/**
 * Close a live inline terminal card. Captures the final transcript (from the
 * live PTY buffer or a retained tombstone if the shell already exited), kills
 * the PTY, then inserts and broadcasts an `inline_terminal_close` event.
 *
 * - Idempotent: a released id is a no-op (checked FIRST, before any liveness
 *   or tombstone lookup), so a double close cannot resurrect or destroy a
 *   frozen card even under two-browser concurrency. See D1c.
 * - A close for an id the session never opened emits nothing (no stray empty
 *   close). An opened-but-evicted terminal emits `transcript:""` so the client
 *   removes the card gracefully. See D1c / X10 / X11.
 * - Emits `transcript:""` when the user never interacted (server-side
 *   `sawInput`), else the capped transcript. The client removes empty rows.
 * See change: preserve-inline-terminal-transcript.
 */
export function handleCloseInlineTerminal(
  msg: Extract<BrowserToServerMessage, { type: "close_inline_terminal" }>,
  ctx: BrowserHandlerContext,
): void {
  const { terminalManager, eventStore, broadcastEvent } = ctx;
  if (!terminalManager) return;
  // Both gates: the SESSION the event is written into AND the terminal being closed.
  if (!mayWriteSession(ctx, msg.sessionId) || !mayUseTerminal(ctx, msg.terminalId)) return;
  // Idempotency guard FIRST — a released card never emits again.
  if (terminalManager.isReleased(msg.terminalId)) return;

  const record = terminalManager.getTerminalRecord(msg.terminalId);
  // Distinguish "never existed" (emit nothing) from "opened but tombstone
  // evicted" (emit empty so the client removes the card). The durable proof a
  // terminal existed in this session is its `inline_terminal_open` event, which
  // survives per-session trim (essential type).
  if (!record) {
    const opened = eventStore
      .getEvents(msg.sessionId, 0)
      .some(
        (e) =>
          e.event.eventType === "inline_terminal_open" &&
          (e.event.data as { terminalId?: string } | undefined)?.terminalId === msg.terminalId,
      );
    if (!opened) return;
  }

  try { terminalManager.kill(msg.terminalId); } catch { /* already gone */ }
  const transcript = record?.sawInput ? record.transcript : "";
  const seq = eventStore.insertEvent(msg.sessionId, {
    eventType: "inline_terminal_close",
    timestamp: Date.now(),
    data: { terminalId: msg.terminalId, transcript },
  });
  const stored = eventStore.getEvent(msg.sessionId, seq);
  broadcastEvent?.(msg.sessionId, seq, stored);
  terminalManager.releaseTranscript(msg.terminalId);
}

export function handleKillTerminal(
  msg: Extract<BrowserToServerMessage, { type: "kill_terminal" }>,
  ctx: BrowserHandlerContext,
): void {
  if (ctx.terminalManager) {
    if (!mayUseTerminal(ctx, msg.terminalId)) return;
    try { ctx.terminalManager.kill(msg.terminalId); } catch { /* ignore */ }
  }
}

export function handleRenameTerminal(
  msg: Extract<BrowserToServerMessage, { type: "rename_terminal" }>,
  ctx: BrowserHandlerContext,
): void {
  if (ctx.terminalManager) {
    if (!mayUseTerminal(ctx, msg.terminalId)) return;
    ctx.terminalManager.updateTitle(msg.terminalId, msg.title);
    ctx.broadcast({ type: "terminal_updated", terminalId: msg.terminalId, updates: { title: msg.title } });
  }
}
