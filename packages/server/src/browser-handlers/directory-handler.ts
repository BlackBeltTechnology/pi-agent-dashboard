/**
 * Directory and preference handlers: pin, unpin, reorder, openspec, pi-gateway forwards.
 */
import type { BrowserToServerMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { archiveCompleted as openspecArchiveCompleted } from "@blackbelt-technology/pi-dashboard-shared/platform/openspec.js";
import { normalizePath } from "@blackbelt-technology/pi-dashboard-shared/platform/paths.js";
import { safeRealpathSync } from "../resolve-path.js";
import type { BrowserHandlerContext } from "./handler-context.js";

/**
 * Canonicalize a user-supplied path before storage: normalize separator /
 * trailing-sep / case variants first, then resolve symlinks. Order matters
 * — `realpath` can fail for not-yet-existing paths, so we keep its
 * best-effort fallback but ensure we first have a sane string.
 * See change: platform-path-normalization.
 */
function canonicalizePath(input: string): string {
  return safeRealpathSync(normalizePath(input));
}

export function handlePinDirectory(
  msg: Extract<BrowserToServerMessage, { type: "pin_directory" }>,
  ctx: BrowserHandlerContext,
): void {
  const { preferencesStore } = ctx;
  if (!preferencesStore) return;
  const resolved = canonicalizePath(msg.path);
  preferencesStore.pinDirectory(resolved);
  pinDirectorySideEffects(resolved, ctx);
}

/**
 * Everything `handlePinDirectory` does AFTER `preferencesStore.pinDirectory`:
 * the `pinned_dirs_updated` broadcast plus historical on-disk session
 * discovery. Shared with the eject branch of `handleMoveFolderToWorkspace`
 * so an ejected folder gets the same treatment a hand-pinned one does.
 * Callers must NOT broadcast `pinned_dirs_updated` themselves.
 * `resolved` must already be canonical.
 * See change: drag-folders-across-workspaces.
 */
export function pinDirectorySideEffects(
  resolved: string,
  ctx: BrowserHandlerContext,
): void {
  const { preferencesStore, directoryService, sessionManager, broadcast } = ctx;
  if (!preferencesStore) return;
  // Pin change re-keys the archive index (worktree sessions move to/from their
  // parent repo) and broadcasts the changed folder counts.
  // See change: archive-sessions-lazy-load.
  ctx.sessionArchive?.rekey();
  broadcast({ type: "pinned_dirs_updated", paths: preferencesStore.getPinnedDirectories() });
  if (directoryService) {
    directoryService.onDirectoryAdded(resolved).then(({ sessions, openspecData }) => {
      for (const hist of sessions) {
        if (!sessionManager.get(hist.id)) {
          sessionManager.register({
            id: hist.id,
            cwd: hist.cwd,
            name: hist.name,
            source: "tui",
            sessionFile: hist.sessionFile,
            sessionDir: hist.sessionDir,
            firstMessage: hist.firstMessage,
            startedAt: hist.startedAt,
          });
          // Historical sessions: registered only to seed the map, then ended
          // immediately. The server never witnessed these endings, so they take
          // the evidence-derived time rather than the moment the directory was
          // added. See change: fix-ended-session-missing-endedat.
          sessionManager.unregister(hist.id, { witnessed: false });
          // Discovered history is a visible ended session — `hidden` now means
          // "auto-hidden headless worker" only. See change:
          // archive-sessions-lazy-load.
          const s = sessionManager.get(hist.id);
          if (s) broadcast({ type: "session_added", session: s });
        }
      }
      broadcast({ type: "openspec_update", cwd: resolved, data: openspecData } as any);
    }).catch(() => {});
  }
}

export function handleUnpinDirectory(
  msg: Extract<BrowserToServerMessage, { type: "unpin_directory" }>,
  ctx: BrowserHandlerContext,
): void {
  if (ctx.preferencesStore) {
    ctx.preferencesStore.unpinDirectory(canonicalizePath(msg.path));
    ctx.sessionArchive?.rekey();
    ctx.broadcast({ type: "pinned_dirs_updated", paths: ctx.preferencesStore.getPinnedDirectories() });
  }
}

export function handleFavoriteModel(
  msg: Extract<BrowserToServerMessage, { type: "favorite_model" }>,
  ctx: BrowserHandlerContext,
): void {
  if (!ctx.preferencesStore) return;
  ctx.preferencesStore.addFavoriteModel(msg.label);
  ctx.broadcast({ type: "favorite_models_updated", labels: ctx.preferencesStore.getFavoriteModels() });
}

export function handleUnfavoriteModel(
  msg: Extract<BrowserToServerMessage, { type: "unfavorite_model" }>,
  ctx: BrowserHandlerContext,
): void {
  if (!ctx.preferencesStore) return;
  ctx.preferencesStore.removeFavoriteModel(msg.label);
  ctx.broadcast({ type: "favorite_models_updated", labels: ctx.preferencesStore.getFavoriteModels() });
}

export function handleReorderPinnedDirs(
  msg: Extract<BrowserToServerMessage, { type: "reorder_pinned_dirs" }>,
  ctx: BrowserHandlerContext,
): void {
  if (ctx.preferencesStore) {
    // Wrap in arrow fn: map's (elem, index, array) callback would pass
    // the array index as canonicalizePath's 2nd arg, silently breaking
    // platform detection. See platform-path-normalization.
    ctx.preferencesStore.reorderPinnedDirs(msg.paths.map((p) => canonicalizePath(p)));
    ctx.broadcast({ type: "pinned_dirs_updated", paths: ctx.preferencesStore.getPinnedDirectories() });
  }
}

// ── folder-workspaces handlers ──────────────────────────────────
//
// Each handler dispatches to PreferencesStore which returns true on
// mutation. Broadcast `workspaces_updated` only on actual mutation
// (no broadcast for no-op / invalid / unknown-id calls). See spec
// folder-workspaces.

function broadcastWorkspaces(ctx: BrowserHandlerContext): void {
  if (!ctx.preferencesStore) return;
  ctx.broadcast({ type: "workspaces_updated", workspaces: ctx.preferencesStore.getWorkspaces() });
}

export function handleCreateWorkspace(
  msg: Extract<BrowserToServerMessage, { type: "create_workspace" }>,
  ctx: BrowserHandlerContext,
): void {
  const ws = ctx.preferencesStore?.createWorkspace(msg.name);
  if (ws) broadcastWorkspaces(ctx);
}

export function handleRenameWorkspace(
  msg: Extract<BrowserToServerMessage, { type: "rename_workspace" }>,
  ctx: BrowserHandlerContext,
): void {
  if (ctx.preferencesStore?.renameWorkspace(msg.id, msg.name)) broadcastWorkspaces(ctx);
}

export function handleDeleteWorkspace(
  msg: Extract<BrowserToServerMessage, { type: "delete_workspace" }>,
  ctx: BrowserHandlerContext,
): void {
  if (ctx.preferencesStore?.deleteWorkspace(msg.id)) broadcastWorkspaces(ctx);
}

export function handleSetWorkspaceCollapsed(
  msg: Extract<BrowserToServerMessage, { type: "set_workspace_collapsed" }>,
  ctx: BrowserHandlerContext,
): void {
  if (ctx.preferencesStore?.setWorkspaceCollapsed(msg.id, msg.collapsed)) broadcastWorkspaces(ctx);
}

// ── collapsed folders (persist-folder-collapse-server-side) ──────
//
// Mirrors `set_workspace_collapsed` exactly: the store returns true only on a
// real mutation, so a no-op (already collapsed / already expanded) emits no
// broadcast — which is what makes the legacy migration's send-only-what-is-
// missing rule safe (every send is a guaranteed echo). The store canonicalizes
// `msg.path` itself, so the client may send either spelling.

function broadcastCollapsedFolders(ctx: BrowserHandlerContext): void {
  if (!ctx.preferencesStore?.getCollapsedFolders) return;
  ctx.broadcast({
    type: "collapsed_folders_updated",
    collapsedFolders: ctx.preferencesStore.getCollapsedFolders(),
  });
}

export function handleSetFolderCollapsed(
  msg: Extract<BrowserToServerMessage, { type: "set_folder_collapsed" }>,
  ctx: BrowserHandlerContext,
): void {
  if (ctx.preferencesStore?.setFolderCollapsed?.(msg.path, msg.collapsed)) {
    broadcastCollapsedFolders(ctx);
  }
}

export function handleAddFolderToWorkspace(
  msg: Extract<BrowserToServerMessage, { type: "add_folder_to_workspace" }>,
  ctx: BrowserHandlerContext,
): void {
  if (ctx.preferencesStore?.addFolderToWorkspace(msg.id, msg.path)) broadcastWorkspaces(ctx);
}

export function handleRemoveFolderFromWorkspace(
  msg: Extract<BrowserToServerMessage, { type: "remove_folder_from_workspace" }>,
  ctx: BrowserHandlerContext,
): void {
  if (ctx.preferencesStore?.removeFolderFromWorkspace(msg.id, msg.path)) broadcastWorkspaces(ctx);
}

export function handleReorderWorkspaceFolders(
  msg: Extract<BrowserToServerMessage, { type: "reorder_workspace_folders" }>,
  ctx: BrowserHandlerContext,
): void {
  if (ctx.preferencesStore?.reorderWorkspaceFolders(msg.id, msg.paths)) broadcastWorkspaces(ctx);
}

/**
 * Move a folder into a workspace (`toWorkspaceId`), or eject it from every
 * workspace and pin it (`toWorkspaceId: null`).
 *
 * All effects gate on the store's return, so a rejected/stale request never
 * pins a directory the user never pinned. On eject, `pinned_dirs_updated`
 * goes out BEFORE `workspaces_updated` — the reverse order makes the folder
 * belong to neither list for one render frame. See design D1/D2.
 * See change: drag-folders-across-workspaces.
 */
export function handleMoveFolderToWorkspace(
  msg: Extract<BrowserToServerMessage, { type: "move_folder_to_workspace" }>,
  ctx: BrowserHandlerContext,
): void {
  const { preferencesStore } = ctx;
  if (!preferencesStore) return;
  // The type annotation is not a runtime guard: NaN would survive the clamp
  // and `splice(NaN, 0, x)` coerces to a front insert.
  if (msg.index !== undefined && !Number.isInteger(msg.index)) return;
  const canon = canonicalizePath(msg.path);
  if (!preferencesStore.moveFolderToWorkspace(canon, msg.toWorkspaceId, msg.index)) return;
  if (msg.toWorkspaceId === null) {
    preferencesStore.pinDirectory(canon);
    pinDirectorySideEffects(canon, ctx);
  }
  broadcastWorkspaces(ctx);
}

export function handleReorderWorkspaces(
  msg: Extract<BrowserToServerMessage, { type: "reorder_workspaces" }>,
  ctx: BrowserHandlerContext,
): void {
  if (ctx.preferencesStore?.reorderWorkspaces(msg.ids)) broadcastWorkspaces(ctx);
}

export function handleReorderSessions(
  msg: Extract<BrowserToServerMessage, { type: "reorder_sessions" }>,
  ctx: BrowserHandlerContext,
): void {
  if (ctx.sessionOrderManager) {
    ctx.sessionOrderManager.reorder(msg.cwd, msg.sessionIds);
    ctx.broadcast({ type: "sessions_reordered", cwd: msg.cwd, sessionIds: msg.sessionIds });
  }
}

export function handleOpenSpecRefresh(
  msg: Extract<BrowserToServerMessage, { type: "openspec_refresh" }>,
  ctx: BrowserHandlerContext,
): void {
  if (ctx.directoryService) {
    ctx.directoryService
      .refreshOpenSpec(msg.cwd)
      .then((data) => {
        ctx.broadcast({ type: "openspec_update", cwd: msg.cwd, data });
      })
      // Fire-and-forget from a sync dispatch handler: a rejected refresh must
      // not float. The gateway stays responsive; the client simply gets no
      // openspec_update for this cwd.
      // See change: cleanup-async-semantics-server-extension (design D1).
      .catch((err: unknown) => {
        console.warn(`[openspec] refresh failed for ${msg.cwd}:`, err);
      });
  }
}

/**
 * `openspec_get { requestId, cwd }` — unicast-only on-demand fetch (D6).
 * A gated or cached answer replies once with `final:true`. A cold tracked cwd
 * replies immediately with the PENDING placeholder (`final:false`), then a
 * `final:true` reply carrying the poll outcome — or, if the poll itself
 * rejects (an unexpected throw; `pollDirectoryGated` normally RESOLVES the
 * fold's finalized payload even on CLI failure), a `BROKEN · cli-failed`
 * placeholder, so the requester always receives its final reply (X1).
 * NEVER broadcasts: the shared poll broadcasts via the service when the
 * payload changed. Delivery rides `sendTo` (state class → `sendState`, key
 * `openspec_get_result:<cwd>`), and `sendTo`'s readyState guard makes a
 * closed requester socket a silent drop (X2).
 * See change: fix-connect-snapshot-frame-loss (D6).
 */
export function handleOpenSpecGet(
  msg: Extract<BrowserToServerMessage, { type: "openspec_get" }>,
  ctx: BrowserHandlerContext,
): void {
  const { ws, sendTo, directoryService } = ctx;
  // Hand-built `DirectoryService` fakes may lack the method (see the
  // `refreshFolderHeadsForEnteringKeys` note); absent service/method is a
  // silent no-op like the other openspec handlers.
  if (!directoryService?.getOrPollOpenSpec) return;
  const { hit, poll } = directoryService.getOrPollOpenSpec(msg.cwd);
  if (hit) {
    sendTo(ws, { type: "openspec_get_result", requestId: msg.requestId, cwd: msg.cwd, data: hit, final: !poll });
  }
  if (poll !== undefined) {
    poll.then(
      (data) => {
        sendTo(ws, { type: "openspec_get_result", requestId: msg.requestId, cwd: msg.cwd, data, final: true });
      },
      () => {
        sendTo(ws, {
          type: "openspec_get_result",
          requestId: msg.requestId,
          cwd: msg.cwd,
          data: {
            initialized: false,
            pending: false,
            changes: [],
            // The cwd passed the root gate to have a poll at all.
            hasOpenspecDir: true,
            readiness: { state: "BROKEN", reason: "cli-failed" },
          },
          final: true,
        });
      },
    );
  }
}

export function handleOpenSpecBulkArchive(
  msg: Extract<BrowserToServerMessage, { type: "openspec_bulk_archive" }>,
  ctx: BrowserHandlerContext,
): void {
  if (ctx.directoryService) {
    // Delegate to the shared openspec tool module. The runner handles
    // windowsHide, timeout, and argv-array escaping.
    // See change: platform-command-executor.
    openspecArchiveCompleted({ cwd: msg.cwd });
    // Post-archive refresh stays gated: bulk-archive bumps `<changes>/`
    // mtime once (entry removal), so the gate naturally re-runs `list` and
    // any per-change CLI calls whose effective mtime advanced. Skipping
    // the user-facing `refreshOpenSpec` (which now force-bypasses the gate)
    // avoids O(N) status spawns after every bulk archive.
    // See change: fix-openspec-mtime-gate-toctou.
    Promise.resolve()
      .then(() => ctx.directoryService!.pollDirectoryGated(msg.cwd))
      .then((data) => {
        if (data) ctx.broadcast({ type: "openspec_update", cwd: msg.cwd, data });
      })
      // The archive above already happened; a failed post-archive poll only
      // costs the client its refresh, so log and stay responsive rather than
      // floating the rejection.
      // See change: cleanup-async-semantics-server-extension (design D1).
      .catch((err: unknown) => {
        console.warn(`[openspec] post-archive poll failed for ${msg.cwd}:`, err);
      });
  }
}

export function forwardExtensionUiResponse(
  piGateway: BrowserHandlerContext["piGateway"],
  args: { sessionId: string; requestId: string; result: unknown; cancelled?: boolean },
): void {
  piGateway.sendToSession(args.sessionId, {
    type: "extension_ui_response",
    sessionId: args.sessionId,
    requestId: args.requestId,
    result: args.result,
    // Normalise to a boolean so the REST and WS entry points emit an
    // identical message (E27).
    cancelled: args.cancelled === true,
  });
}

export function handleExtensionUiResponse(
  msg: Extract<BrowserToServerMessage, { type: "extension_ui_response" }>,
  ctx: BrowserHandlerContext,
): void {
  forwardExtensionUiResponse(ctx.piGateway, {
    sessionId: msg.sessionId,
    requestId: msg.requestId,
    result: msg.result,
    cancelled: msg.cancelled,
  });
}

/** Forward simple pi-gateway commands (request_commands, list_files, request_models, set_model, set_thinking_level) */
export function handlePiGatewayForward(
  msg: BrowserToServerMessage,
  ctx: BrowserHandlerContext,
): void {
  const { piGateway } = ctx;
  switch (msg.type) {
    case "request_commands":
      piGateway.sendToSession(msg.sessionId, { type: "request_commands", sessionId: msg.sessionId });
      break;
    case "list_files":
      piGateway.sendToSession(msg.sessionId, { type: "list_files", sessionId: msg.sessionId, query: msg.query });
      break;
    case "request_models":
      piGateway.sendToSession(msg.sessionId, { type: "request_models", sessionId: msg.sessionId });
      break;
    case "request_providers":
      // See change: replace-hardcoded-provider-lists.
      piGateway.sendToSession(msg.sessionId, { type: "request_providers", sessionId: msg.sessionId });
      break;
    case "set_thinking_level":
      piGateway.sendToSession(msg.sessionId, { type: "set_thinking_level", sessionId: msg.sessionId, level: msg.level });
      break;
    case "set_model":
      piGateway.sendToSession(msg.sessionId, { type: "set_model", sessionId: msg.sessionId, provider: msg.provider, modelId: msg.modelId });
      break;
  }
}
