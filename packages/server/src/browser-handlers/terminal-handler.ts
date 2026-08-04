/**
 * Terminal message handlers: create, kill, rename.
 */
import type { BrowserToServerMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { BrowserHandlerContext } from "./handler-context.js";

export function handleCreateTerminal(
  msg: Extract<BrowserToServerMessage, { type: "create_terminal" }>,
  ctx: BrowserHandlerContext,
): void {
  const { terminalManager, sessionOrderManager, broadcast } = ctx;
  if (terminalManager && sessionOrderManager) {
    const terminal = terminalManager.spawn(msg.cwd);
    sessionOrderManager.insert(msg.cwd, terminal.id);
    broadcast({ type: "terminal_added", terminal });
    broadcast({ type: "sessions_reordered", cwd: msg.cwd, sessionIds: sessionOrderManager.getOrder(msg.cwd) });
  }
}

/**
 * Open an inline interactive terminal card: spawn an ephemeral PTY, broadcast
 * terminal_added (TerminalsView filters ephemeral from tabs), then insert and
 * broadcast an `inline_terminal_open` event into the session's chat stream so
 * the card is event-sourced and replays on reload.
 * See change: add-inline-terminal-card.
 */
export function handleOpenInlineTerminal(
  msg: Extract<BrowserToServerMessage, { type: "open_inline_terminal" }>,
  ctx: BrowserHandlerContext,
): void {
  const { terminalManager, eventStore, broadcast, broadcastEvent } = ctx;
  if (!terminalManager) return;
  const terminal = terminalManager.spawn(msg.cwd, { ephemeral: true });
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
    try { ctx.terminalManager.kill(msg.terminalId); } catch { /* ignore */ }
  }
}

export function handleRenameTerminal(
  msg: Extract<BrowserToServerMessage, { type: "rename_terminal" }>,
  ctx: BrowserHandlerContext,
): void {
  if (ctx.terminalManager) {
    ctx.terminalManager.updateTitle(msg.terminalId, msg.title);
    ctx.broadcast({ type: "terminal_updated", terminalId: msg.terminalId, updates: { title: msg.title } });
  }
}
