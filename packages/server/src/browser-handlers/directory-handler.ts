/**
 * Directory and preference handlers: pin, unpin, reorder, openspec, pi-gateway forwards.
 */
import type { BrowserToServerMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { BrowserHandlerContext } from "./handler-context.js";
import { safeRealpathSync } from "../resolve-path.js";
import { archiveCompleted as openspecArchiveCompleted } from "@blackbelt-technology/pi-dashboard-shared/platform/openspec.js";
import { normalizePath } from "@blackbelt-technology/pi-dashboard-shared/platform/paths.js";

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
  const { preferencesStore, directoryService, sessionManager, broadcast } = ctx;
  if (!preferencesStore) return;
  const resolved = canonicalizePath(msg.path);
  preferencesStore.pinDirectory(resolved);
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
          sessionManager.unregister(hist.id);
          sessionManager.update(hist.id, { hidden: true });
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
    ctx.broadcast({ type: "pinned_dirs_updated", paths: ctx.preferencesStore.getPinnedDirectories() });
  }
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
    ctx.directoryService.refreshOpenSpec(msg.cwd).then((data) => {
      ctx.broadcast({ type: "openspec_update", cwd: msg.cwd, data });
    });
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
    Promise.resolve()
      .then(() => ctx.directoryService!.refreshOpenSpec(msg.cwd))
      .then((data) => {
        if (data) ctx.broadcast({ type: "openspec_update", cwd: msg.cwd, data });
      });
  }
}

export function handleExtensionUiResponse(
  msg: Extract<BrowserToServerMessage, { type: "extension_ui_response" }>,
  ctx: BrowserHandlerContext,
): void {
  ctx.piGateway.sendToSession(msg.sessionId, {
    type: "extension_ui_response",
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
    case "set_thinking_level":
      piGateway.sendToSession(msg.sessionId, { type: "set_thinking_level", sessionId: msg.sessionId, level: msg.level });
      break;
    case "set_model":
      piGateway.sendToSession(msg.sessionId, { type: "set_model", sessionId: msg.sessionId, provider: msg.provider, modelId: msg.modelId });
      break;
  }
}
