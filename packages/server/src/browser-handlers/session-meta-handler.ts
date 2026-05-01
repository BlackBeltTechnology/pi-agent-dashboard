/**
 * Session metadata handlers: rename, hide, unhide, attach/detach proposal, fetch_content, list_sessions.
 */
import type { BrowserToServerMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { BrowserHandlerContext } from "./handler-context.js";
import { attachRenameTarget, detachShouldClearName } from "../proposal-attach-naming.js";

export function handleRenameSession(
  msg: Extract<BrowserToServerMessage, { type: "rename_session" }>,
  ctx: BrowserHandlerContext,
): void {
  const { sessionManager, piGateway, broadcast } = ctx;
  const nameUpdates = { name: msg.name || undefined };
  sessionManager.update(msg.sessionId, nameUpdates);
  broadcast({ type: "session_updated", sessionId: msg.sessionId, updates: nameUpdates });
  piGateway.sendToSession(msg.sessionId, { type: "rename_session", sessionId: msg.sessionId, name: msg.name });
}

export function handleHideSession(
  msg: Extract<BrowserToServerMessage, { type: "hide_session" }>,
  ctx: BrowserHandlerContext,
): void {
  const updates = { hidden: true };
  ctx.sessionManager.update(msg.sessionId, updates);
  ctx.broadcast({ type: "session_updated", sessionId: msg.sessionId, updates });
}

export function handleUnhideSession(
  msg: Extract<BrowserToServerMessage, { type: "unhide_session" }>,
  ctx: BrowserHandlerContext,
): void {
  const updates = { hidden: false };
  ctx.sessionManager.update(msg.sessionId, updates);
  ctx.broadcast({ type: "session_updated", sessionId: msg.sessionId, updates });
}

/**
 * Shared attach-proposal apply logic. Used by both:
 *   - the browser-initiated `handleAttachProposal` flow, and
 *   - the spawn-with-attach pop-on-register flow in `pi-gateway.ts`
 *     (see change: add-folder-task-checker-and-spawn-attach).
 *
 * Idempotent: calling twice with the same `changeName` is safe — the auto-rename
 * is gated by `attachRenameTarget` which short-circuits when the witness equality
 * already holds (see ./proposal-attach-naming.ts).
 */
export function applyAttachProposal(
  sessionId: string,
  changeName: string,
  ctx: Pick<BrowserHandlerContext, "sessionManager" | "piGateway" | "broadcast">,
): void {
  const { sessionManager, piGateway, broadcast } = ctx;
  const session = sessionManager.get(sessionId);
  const updates: Record<string, unknown> = { attachedProposal: changeName };

  const newName = attachRenameTarget(session, changeName);
  if (newName !== undefined) {
    updates.name = newName;
    piGateway.sendToSession(sessionId, { type: "rename_session", sessionId, name: newName });
  }
  sessionManager.update(sessionId, updates);
  broadcast({ type: "session_updated", sessionId, updates });
}

export function handleAttachProposal(
  msg: Extract<BrowserToServerMessage, { type: "attach_proposal" }>,
  ctx: BrowserHandlerContext,
): void {
  applyAttachProposal(msg.sessionId, msg.changeName, ctx);
}

export function handleDetachProposal(
  msg: Extract<BrowserToServerMessage, { type: "detach_proposal" }>,
  ctx: BrowserHandlerContext,
): void {
  const { sessionManager, piGateway, broadcast } = ctx;
  const session = sessionManager.get(msg.sessionId);

  // Idempotent auto-revert (see change: fix-mobile-attach-proposal-display).
  // See design.md decision matrix and ./proposal-attach-naming.ts.
  const updates: Record<string, unknown> = {
    attachedProposal: null,
    openspecPhase: null,
    openspecChange: null,
  };
  if (detachShouldClearName(session)) {
    updates.name = undefined;
    piGateway.sendToSession(msg.sessionId, { type: "rename_session", sessionId: msg.sessionId, name: "" });
  }
  sessionManager.update(msg.sessionId, updates);
  broadcast({ type: "session_updated", sessionId: msg.sessionId, updates });
}

export function handleFetchContent(
  msg: Extract<BrowserToServerMessage, { type: "fetch_content" }>,
  ctx: BrowserHandlerContext,
): void {
  const event = ctx.eventStore.getEvent(msg.sessionId, msg.seq);
  if (event) {
    ctx.sendTo(ctx.ws, { type: "event", sessionId: msg.sessionId, seq: msg.seq, event });
  }
}

export function handleListSessions(
  msg: Extract<BrowserToServerMessage, { type: "list_sessions" }>,
  ctx: BrowserHandlerContext,
): void {
  const { ws, sessionManager, piGateway, sendTo } = ctx;
  const cwd = msg.cwd;
  const bridgeSessionId = piGateway.findSessionByCwd(cwd);
  if (bridgeSessionId) {
    piGateway.sendToSession(bridgeSessionId, { type: "list_sessions", sessionId: bridgeSessionId, cwd });
  } else {
    const allSessions = sessionManager.listAll();
    const filtered = allSessions
      .filter((s) => s.cwd === cwd || s.cwd.startsWith(cwd + "/") || cwd.startsWith(s.cwd + "/"))
      .map((s) => ({
        id: s.id,
        path: s.sessionFile || "",
        cwd: s.cwd,
        name: s.name,
        created: new Date(s.startedAt).toISOString(),
        modified: new Date(s.endedAt || s.startedAt).toISOString(),
        messageCount: 0,
        firstMessage: s.firstMessage,
      }));
    sendTo(ws, { type: "sessions_list", sessionId: "", cwd, sessions: filtered });
  }
}
