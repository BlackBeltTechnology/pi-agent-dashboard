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
 * Close a live inline terminal card: capture the final ring-buffer transcript,
 * kill the PTY, then insert and broadcast an `inline_terminal_close` event so
 * the card freezes to a read-only transcript and replays frozen on reload.
 * See change: add-inline-terminal-card.
 */
export function handleCloseInlineTerminal(
  msg: Extract<BrowserToServerMessage, { type: "close_inline_terminal" }>,
  ctx: BrowserHandlerContext,
): void {
  const { terminalManager, eventStore, broadcastEvent } = ctx;
  if (!terminalManager) return;
  const transcript = terminalManager.getTranscript(msg.terminalId);
  try { terminalManager.kill(msg.terminalId); } catch { /* already gone */ }
  const seq = eventStore.insertEvent(msg.sessionId, {
    eventType: "inline_terminal_close",
    timestamp: Date.now(),
    data: { terminalId: msg.terminalId, transcript },
  });
  const stored = eventStore.getEvent(msg.sessionId, seq);
  broadcastEvent?.(msg.sessionId, seq, stored);
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
