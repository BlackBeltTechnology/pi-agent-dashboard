/**
 * Session metadata handlers: rename, hide, unhide, attach/detach proposal, fetch_content, list_sessions.
 */
import type { BrowserToServerMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { normalizeTags } from "@blackbelt-technology/pi-dashboard-shared/tags.js";
import { attachRenameTarget, detachShouldClearName } from "../proposal-attach-naming.js";
import { resolveOrderKey } from "../resolve-order-key.js";
import type { BrowserHandlerContext } from "./handler-context.js";

/**
 * Move a session to the front of its resolved-group order list and broadcast
 * `sessions_reordered`. Used by hide/unhide so the card surfaces at the top
 * of its tier (hidden, resp. ended). No-op when the order managers are absent
 * (lean test contexts) or the session is unknown.
 * See change: simplify-session-card-ordering.
 */
function moveSessionToFront(sessionId: string, ctx: BrowserHandlerContext): void {
  const { sessionManager, sessionOrderManager, preferencesStore, broadcast } = ctx;
  if (!sessionOrderManager) return;
  const session = sessionManager.get(sessionId);
  if (!session) return;
  const key = resolveOrderKey(session, preferencesStore?.getPinnedDirectories() ?? []);
  sessionOrderManager.moveToFront(key, sessionId);
  broadcast({
    type: "sessions_reordered",
    cwd: key,
    sessionIds: sessionOrderManager.getOrder(key) ?? [],
  });
}

export function handleRenameSession(
  msg: Extract<BrowserToServerMessage, { type: "rename_session" }>,
  ctx: BrowserHandlerContext,
): void {
  const { sessionManager, piGateway, broadcast } = ctx;
  // A dashboard-initiated rename is a user action — tag provenance "user" so
  // auto-naming is permanently locked out for this session.
  // See change: add-auto-session-naming.
  const nameUpdates = { name: msg.name || undefined, nameSource: "user" as const };
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
  // Surface at the top of the HIDDEN tier (stable status-partition).
  // See change: simplify-session-card-ordering.
  moveSessionToFront(msg.sessionId, ctx);
}

/**
 * Browser → server: replace a session's full user-owned tag list. Mirrors
 * `handleHideSession`: normalize, `sessionManager.update(id, { tags })` (which
 * triggers the debounced `onChange` full-overwrite persist), then broadcast
 * `session_updated`. Does NOT call `mergeSessionMeta` — persistence flows
 * through `onChange` (which MUST enumerate `tags`, else the next unrelated save
 * wipes it). See change: add-session-tags.
 */
export function handleSetSessionTags(
  msg: Extract<BrowserToServerMessage, { type: "set_session_tags" }>,
  ctx: BrowserHandlerContext,
): void {
  const updates = { tags: normalizeTags(msg.tags) };
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
  // Cleared hidden → surface at the top of the ENDED tier.
  // See change: simplify-session-card-ordering.
  moveSessionToFront(msg.sessionId, ctx);
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
  pushAttachProposalChanged(ctx, sessionId, changeName);
}

/**
 * Push `attach_proposal_changed { sessionId, attachedChange }` to the bridge
 * currently owning `sessionId`. Silent no-op when no bridge is connected
 * (`piGateway.sendToSession` drops sends to absent sessions). The bridge
 * mirrors the value into `BridgeContext.attachedChange`, read by the
 * `before_agent_start` injector. See change: inject-session-context-into-agent.
 */
export function pushAttachProposalChanged(
  ctx: Pick<BrowserHandlerContext, "piGateway">,
  sessionId: string,
  attachedChange: string | null,
): void {
  ctx.piGateway.sendToSession(sessionId, {
    type: "attach_proposal_changed",
    sessionId,
    attachedChange,
  });
}

export function handleAttachProposal(
  msg: Extract<BrowserToServerMessage, { type: "attach_proposal" }>,
  ctx: BrowserHandlerContext,
): void {
  applyAttachProposal(msg.sessionId, msg.changeName, ctx);
}

/**
 * Browser → server: commit a suggested proposal replacement. Validates the
 * `changeName` matches the session's `pendingReplaceProposal` (or, defensively,
 * the current `attachedProposal`), reuses `applyAttachProposal` (idempotent:
 * sets `attachedProposal`, runs `attachRenameTarget`, sends `rename_session`,
 * broadcasts `session_updated`), then clears `pendingReplaceProposal`. Does
 * NOT add the accepted name to `rejectedReplaceProposals`.
 * See change: replace-proposal-dialog-with-race-handling.
 */
export function handleAcceptReplaceProposal(
  msg: Extract<BrowserToServerMessage, { type: "accept_replace_proposal" }>,
  ctx: BrowserHandlerContext,
): void {
  const { sessionManager, broadcast } = ctx;
  const session = sessionManager.get(msg.sessionId);
  if (!session) return;
  // Defensive: only commit a name the server is actually offering (or the
  // already-attached one, idempotent). Guards against stale/racy clients.
  if (
    msg.changeName !== session.pendingReplaceProposal &&
    msg.changeName !== session.attachedProposal
  ) {
    return;
  }
  applyAttachProposal(msg.sessionId, msg.changeName, ctx);
  const clearUpdates = { pendingReplaceProposal: null };
  sessionManager.update(msg.sessionId, clearUpdates);
  broadcast({ type: "session_updated", sessionId: msg.sessionId, updates: clearUpdates });
}

/**
 * Browser → server: reject a suggested proposal replacement. Appends
 * `changeName` to `rejectedReplaceProposals` (deduped) so it does not
 * re-prompt until `agent_end`, and clears `pendingReplaceProposal`.
 * See change: replace-proposal-dialog-with-race-handling.
 */
export function handleDismissReplaceProposal(
  msg: Extract<BrowserToServerMessage, { type: "dismiss_replace_proposal" }>,
  ctx: BrowserHandlerContext,
): void {
  const { sessionManager, broadcast } = ctx;
  const session = sessionManager.get(msg.sessionId);
  if (!session) return;
  const prev = session.rejectedReplaceProposals ?? [];
  const rejectedReplaceProposals = prev.includes(msg.changeName)
    ? prev
    : [...prev, msg.changeName];
  const updates = { rejectedReplaceProposals, pendingReplaceProposal: null };
  sessionManager.update(msg.sessionId, updates);
  broadcast({ type: "session_updated", sessionId: msg.sessionId, updates });
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
    // Detach ends the attachment lifecycle — clear the replace-proposal
    // state too. See change: replace-proposal-dialog-with-race-handling.
    pendingReplaceProposal: null,
    rejectedReplaceProposals: [],
  };
  if (detachShouldClearName(session)) {
    updates.name = undefined;
    piGateway.sendToSession(msg.sessionId, { type: "rename_session", sessionId: msg.sessionId, name: "" });
  }
  sessionManager.update(msg.sessionId, updates);
  broadcast({ type: "session_updated", sessionId: msg.sessionId, updates });
  // Detach is a separate path from applyAttachProposal; push null explicitly
  // so the bridge clears its fragment. See change: inject-session-context-into-agent.
  pushAttachProposalChanged(ctx, msg.sessionId, null);
}

/**
 * Browser → server: set or clear the per-session `displayPrefsOverride`.
 * `override: null` removes the field from `.meta.json`.
 * Broadcasts a `session_updated` so all browsers re-render with the new
 * effective prefs.
 * See change: configurable-chat-display.
 */
export function handleSetSessionDisplayPrefs(
  msg: Extract<BrowserToServerMessage, { type: "setSessionDisplayPrefs" }>,
  ctx: BrowserHandlerContext,
): void {
  const { sessionManager, broadcast, metaPersistence } = ctx;
  const session = sessionManager.get(msg.sessionId);
  if (!session) return;

  const override = msg.override;
  // Update in-memory session so server.ts onChange + broadcast pick it up.
  // Setting to `undefined` makes the field disappear on the next debounced
  // .meta.json write; we also write synchronously below to belt-and-braces.
  const updates = { displayPrefsOverride: override === null ? undefined : override };
  sessionManager.update(msg.sessionId, updates);
  broadcast({ type: "session_updated", sessionId: msg.sessionId, updates });

  if (session.sessionFile && metaPersistence) {
    metaPersistence.setDisplayPrefsOverride(session.sessionFile, override);
  }
}

/**
 * Browser → server: persist the per-session collapse state of the PROCESS
 * subcard's background-processes drawer. Updates the in-memory session so
 * `server.ts` onChange + broadcast pick it up, writes synchronously to
 * `.meta.json`, and broadcasts `session_updated` so all browsers re-render.
 * See change: persist-process-drawer-collapse.
 */
export function handleSetSessionProcessDrawer(
  msg: Extract<BrowserToServerMessage, { type: "set_session_process_drawer" }>,
  ctx: BrowserHandlerContext,
): void {
  const { sessionManager, broadcast, metaPersistence } = ctx;
  const session = sessionManager.get(msg.sessionId);
  if (!session) return;

  const updates = { processDrawerCollapsed: msg.collapsed };
  sessionManager.update(msg.sessionId, updates);
  broadcast({ type: "session_updated", sessionId: msg.sessionId, updates });

  if (session.sessionFile && metaPersistence) {
    metaPersistence.setProcessDrawerCollapsed(session.sessionFile, msg.collapsed);
  }
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
