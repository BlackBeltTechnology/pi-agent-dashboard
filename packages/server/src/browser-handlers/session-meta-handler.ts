/**
 * Session metadata handlers: rename, archive, unarchive, attach/detach proposal, fetch_content, list_sessions,
 * sessions_page.
 */
import type { BrowserToServerMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { normalizeTags } from "@blackbelt-technology/pi-dashboard-shared/tags.js";
import { attachRenameTarget, detachShouldClearName } from "../openspec/proposal-attach-naming.js";
import { shutdownSession } from "./session-action-handler.js";
import { stripNotifyLog } from "../session/memory-session-manager.js";
import { canAccessSession } from "../identity/session-access.js";
import type { BrowserHandlerContext } from "./handler-context.js";

/**
 * §8.2 per-ITEM owner gate for the SESSION-LIST roads. The gateway's §8.3 choke
 * point covers the `session` scope only and deliberately falls through for
 * `session-list` — these roads return a SET, so authorizing the container would
 * disclose every principal's sessions. Inert era passes everything (unchanged).
 * See change: add-multi-user-identity-plane (D11).
 */
function visibleToSocket(ctx: BrowserHandlerContext, owner: { iss: string; sub: string } | undefined): boolean {
  const active = ctx.isResolverActive?.() ?? false;
  if (!active) return true;
  return canAccessSession({
    active,
    principal: (ctx.ws as { principal?: { iss: string; sub: string } }).principal ?? null,
    owner,
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

/**
 * Browser → server: replace a session's full user-owned tag list. Normalize,
 * `sessionManager.update(id, { tags })` (which triggers the debounced `onChange`
 * full-overwrite persist), then broadcast `session_updated`. Does NOT call
 * `mergeSessionMeta` — persistence flows through `onChange` (which MUST
 * enumerate `tags`, else the next unrelated save wipes it).
 * See change: add-session-tags.
 */
export function handleSetSessionTags(
  msg: Extract<BrowserToServerMessage, { type: "set_session_tags" }>,
  ctx: BrowserHandlerContext,
): void {
  const updates = { tags: normalizeTags(msg.tags) };
  ctx.sessionManager.update(msg.sessionId, updates);
  ctx.broadcast({ type: "session_updated", sessionId: msg.sessionId, updates });
}

/**
 * Browser → server: strip a single user tag from EVERY session that carries it
 * (global, not folder-scoped — over `sessionManager.listAll()`). Normalizes the
 * inbound tag first; a blank/whitespace-only tag (`normalizeTags` → `[]`) is an
 * early no-op. For each carrying session it reuses the same
 * `normalizeTags` → `sessionManager.update({ tags })` → `broadcast(session_updated)`
 * path as `handleSetSessionTags` (one broadcast per changed session; no
 * `mergeSessionMeta`). Best-effort fan-out, not a transaction.
 * See change: sidebar-tag-collapse-and-delete.
 */
export function handleRemoveTagGlobally(
  msg: Extract<BrowserToServerMessage, { type: "remove_tag_globally" }>,
  ctx: BrowserHandlerContext,
): void {
  const { sessionManager, broadcast } = ctx;
  // Untrusted WS payload: guard non-string `tag` before normalize (`normalizeTags`
  // calls `.trim()` — a malformed `null`/number would throw). See CodeRabbit #8.
  if (typeof msg.tag !== "string") return;
  const target = normalizeTags([msg.tag])[0];
  if (!target) return;
  for (const session of sessionManager.listAll()) {
    const tags = session.tags ?? [];
    if (!tags.includes(target)) continue;
    const updates = { tags: normalizeTags(tags.filter((t) => t !== target)) };
    sessionManager.update(session.id, updates);
    broadcast({ type: "session_updated", sessionId: session.id, updates });
  }
}

export function handleUnarchiveSession(
  msg: Extract<BrowserToServerMessage, { type: "unarchive_session" }>,
  ctx: BrowserHandlerContext,
): void {
  ctx.sessionArchive?.unarchiveSession(msg.sessionId);
}

/**
 * Classify what an archive request should do for a session. Pure so the
 * eligibility table is testable without a live gateway.
 * See change: archive-sessions-lazy-load.
 */
export type ArchiveAction =
  | "not-found"
  | "reject-live"
  | "reject-running"
  | "archive"
  | "end-then-archive";

export function decideArchiveAction(session: DashboardSession | undefined): ArchiveAction {
  if (!session) return "not-found";
  if (session.live === true) return "reject-live";
  if (session.status === "ended") return "archive";
  if (session.status === "streaming") return "reject-running";
  return "end-then-archive";
}

/**
 * End (if alive-idle) then archive an ended session. Ended → archive now;
 * idle-alive → register a one-shot intent, terminate the process, and archive
 * on the `ended` transition; running or `live:true` → error reply. Returns the
 * outcome so the REST route can mirror it; the WS path relies on the
 * `session_archived` / `archived_count_updated` broadcasts.
 * See change: archive-sessions-lazy-load.
 */
export async function requestArchive(
  sessionId: string,
  ctx: Pick<
    BrowserHandlerContext,
    | "sessionManager"
    | "piGateway"
    | "headlessPidRegistry"
    | "broadcast"
    | "metaPersistence"
    | "sessionArchive"
    | "pendingArchiveIntents"
    | "endSession"
  >,
): Promise<{ ok: boolean; pending?: boolean; error?: string }> {
  const { sessionManager, sessionArchive, pendingArchiveIntents } = ctx;
  if (!sessionArchive) return { ok: false, error: "archive unavailable" };
  const action = decideArchiveAction(sessionManager.get(sessionId));
  if (action === "not-found") return { ok: false, error: "session not found" };
  if (action === "reject-live") return { ok: false, error: "session is live (interrupted)" };
  if (action === "reject-running") return { ok: false, error: "session is running" };
  if (action === "archive") {
    const res = sessionArchive.archiveSession(sessionId, "manual");
    return res.ok ? { ok: true } : { ok: false, error: res.error };
  }
  // Alive idle: terminate the process, then archive on the ended transition.
  pendingArchiveIntents?.record(sessionId);
  const endSession = ctx.endSession ?? shutdownSession;
  try {
    await endSession(sessionId, {
      sessionManager,
      piGateway: ctx.piGateway,
      headlessPidRegistry: ctx.headlessPidRegistry,
      broadcast: ctx.broadcast,
      metaPersistence: ctx.metaPersistence,
    });
  } catch (err) {
    pendingArchiveIntents?.clear(sessionId);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true, pending: true };
}

export async function handleArchiveSession(
  msg: Extract<BrowserToServerMessage, { type: "archive_session" }>,
  ctx: BrowserHandlerContext,
): Promise<void> {
  await requestArchive(msg.sessionId, ctx);
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
  // In-memory + disk representation of "no override" is field-absent
  // (`undefined`); the next debounced .meta.json write drops the key and we
  // also write synchronously below to belt-and-braces.
  const updates = { displayPrefsOverride: override === null ? undefined : override };
  sessionManager.update(msg.sessionId, updates);
  // The broadcast MUST carry `null` (not `undefined`) on clear: `JSON.stringify`
  // in the gateway drops `undefined`-valued keys, so an `undefined` here reaches
  // browsers as an empty `updates` object and the stale override survives. The
  // client `getSessionOverride` normalizes `null → undefined`. See design D1.
  broadcast({
    type: "session_updated",
    sessionId: msg.sessionId,
    updates: { displayPrefsOverride: override === null ? null : override },
  });

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

/**
 * Rows per `sessions_page` reply (D5).
 * See change: fix-connect-snapshot-frame-loss.
 */
export const SESSIONS_PAGE_SIZE = 50;

/**
 * Browser → server: the next batch of a group's ended sessions that the
 * snapshot window excluded (D5). `pageable(g)` = `endedSequence(g)` minus a
 * fresh `snapshotVisibleIds()` — exactly the ended sessions a fresh snapshot
 * would NOT carry — so every window exclusion is reachable by paging and a
 * user-reordered ended id outside the window sits at its sequence position.
 * `cwd` is the session GROUP key (pin > worktree mainPath > cwd), matching
 * `sessions_page_result.cwd` and `endedTotals`. Reply is unicast through
 * `sendTo` (state class → `sendState`, key `sessions_page_result:<g>`).
 * See change: fix-connect-snapshot-frame-loss (D5).
 */
export function handleSessionsPage(
  msg: Extract<BrowserToServerMessage, { type: "sessions_page" }>,
  ctx: BrowserHandlerContext,
): void {
  const { ws, sessionManager, preferencesStore, sendTo } = ctx;
  const pinned = preferencesStore?.getPinnedDirectories() ?? [];
  const visible = sessionManager.snapshotVisibleIds(pinned);
  // Owner-filter BEFORE slicing: `hasMore` and the offset walk must run over
  // the caller's OWN pageable, else a hidden row still leaks as a page count.
  const pageable = sessionManager
    .endedSequence(msg.cwd, pinned)
    .filter((id) => !visible.has(id))
    .filter((id) => visibleToSocket(ctx, sessionManager.get(id)?.principalOwner));
  const slice = pageable.slice(msg.offset, msg.offset + SESSIONS_PAGE_SIZE);
  const sessions = slice
    .map((id) => sessionManager.get(id))
    .filter((s): s is DashboardSession => s !== undefined)
    .map(stripNotifyLog);
  sendTo(ws, {
    type: "sessions_page_result",
    cwd: msg.cwd,
    sessions,
    order: sessions.map((s) => s.id),
    hasMore: msg.offset + SESSIONS_PAGE_SIZE < pageable.length,
  });
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
      .filter((s) => visibleToSocket(ctx, s.principalOwner))
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
