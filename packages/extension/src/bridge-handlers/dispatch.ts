/**
 * Inbound dashboard→bridge WebSocket message dispatch.
 *
 * Extracted from `bridge.ts` (change: test-trust-audit, design D2). Receives the per-incarnation
 * `BridgeInstance`; holds no module-level mutable state and never imports the bridge entry point.
 */

import type { ServerToExtensionMessage, TranscriptRequestMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { decideTranscriptRequest } from "@blackbelt-technology/pi-dashboard-shared/transcript-request-guard.js";
import { applyAutoNameRestore } from "../auto-session-namer.js";
import { routeGitInfoRefresh } from "../bridge-polling.js";
import type { McpTokenMintedPayload } from "../mcp-token-delivery.js";
import { refreshAfterCredentialsReload } from "../model-refresh.js";
import { emitPendingPrompts } from "../pending-prompt-emitter.js";
import { buildProviderCatalogue, reloadProviders, toModelInfo } from "../provider-register.js";
import { filterByEnabledModels } from "../session-sync.js";
import { serveSubagentResync } from "../subagent-forward-sites.js";
import { readTranscriptChunk, type TranscriptCursor } from "../transcript-backfill.js";
import { handleUiManagement } from "../ui-modules.js";
import type { BridgeInstance } from "./instance.js";

/** Handle one inbound server message. Called by the connection's `onMessage` (wrapped in `safe`). */
export async function handleInboundMessage(inst: BridgeInstance, data: unknown): Promise<void> {
  const pi = inst.pi;
  if (!inst.isActive()) return; // Stale listener guard
  const msg = data as ServerToExtensionMessage;
  // D12: the dashboard asking for a slice of THIS session's transcript.
  // Guarded before any filesystem touch — a request naming a path, or
  // another session, never reaches the reader. See change:
  // add-pi-gateway-transport-identity (tasks 11.3/11.4/11.6).
  if ((msg as any).type === "transcript_request") {
    const req = msg as unknown as TranscriptRequestMessage;
    const verdict = decideTranscriptRequest({
      request: req as never,
      ownSessionId: inst.sessionId,
    });
    if (!verdict.allow) {
      console.warn(`[dashboard] transcript request refused: ${verdict.reason}`);
      inst.connection.send({
        type: "transcript_chunk",
        // Echo the caller's id: routing is the connection, and the server
        // must be able to correlate a refusal with what it asked for.
        sessionId: req.sessionId,
        entries: [],
        complete: false,
        restarted: false,
        refused: { cause: verdict.cause, reason: verdict.reason },
      });
      return;
    }
    if (!inst.lastSessionFile) return;
    const chunk = readTranscriptChunk(
      inst.lastSessionFile,
      req.cursor as TranscriptCursor | undefined,
      { maxBytes: req.maxBytes },
    );
    inst.connection.send({
      type: "transcript_chunk",
      sessionId: req.sessionId,
      entries: chunk.entries,
      cursor: chunk.cursor,
      complete: chunk.complete,
      restarted: chunk.restarted,
    });
    return;
  }
  // Supervised mode: the server sets (or reconciles) this session's mode. The control validates the
  // payload (malformed → ignored, mode kept), appends the session entry and reports back; it never
  // touches a pending approval. See change: add-supervised-tool-approval (design D4).
  if ((msg as any).type === "set_supervised") {
    inst.supervisedGate.control.onSetSupervised(msg);
    return;
  }
  // Extension UI System (Phase 1): browser-originated action / data
  // request. Re-emit on pi.events; the listener either populates
  // data.items synchronously or calls _reply asynchronously.
  // See change: add-extension-ui-modal.
  if ((msg as any).type === "ui_management") {
    handleUiManagement(inst.uiModulesBridgeCtx, msg as any);
    return;
  }
  // Server announced a deliberate restart/shutdown. Pause the auto-start
  // spawn step in `server-auto-start.ts` for `quiesceMs` so we don't
  // race the orchestrator that's about to bring up the replacement.
  // Discovery + reconnection still run via the normal backoff path.
  // See change: fix-restart-bridge-auto-start-race.
  if ((msg as any).type === "server_restarting") {
    const reason = (msg as any).reason;
    const quiesceMs = (msg as any).quiesceMs;
    if (typeof quiesceMs === "number" && quiesceMs > 0) {
      inst.connection.pauseAutoStart(quiesceMs);
      console.log(`[dashboard] server announced restart (reason=${reason} quiesceMs=${quiesceMs})`);
    }
    return;
  }
  // Legacy extension_ui_response removed — now handled by prompt_response → promptBus.respond()
  if (msg.type === "plugin_reply") {
    // Resolves the caller's Promise only — never re-emitted on pi.events.
    inst.pluginRequests.handleReply(msg);
    return;
  }
  // Credential vault: `vault_snapshot` is consumed here (never re-emitted, never
  // logged); `dashboard_identity` is only observed so the other consumers below
  // still see it. See change: add-credential-vault.
  if (inst.vaultDelivery.onServerMessage(msg)) return;
  // Agent path gate: grant-store identity + grant results (never re-emitted).
  if (inst.pathGate.onServerMessage(msg as { type?: string })) return;
  if (msg.type === "mcp_token_minted") {
    // The minted MCP bearer (+ /mcp url) arrives on the session-private
    // lane and is registered with pi's built-in MCP — never placed in
    // process.env, a log line, or pi.events.
    // See change: migrate-mcp-to-pi-builtin (D1).
    inst.mcpRegistrar.onMinted(msg as McpTokenMintedPayload);
    return;
  }
  // Reload auth credentials when dashboard notifies of changes
  if (msg.type === "credentials_updated") {
    try {
      // Hot-reload providers.json diff BEFORE refreshing the registry,
      // so any newly added providers are registered before getAvailable() runs.
      // Explicit Settings → Refresh models: force-re-register the named
      // providers so their /models list is re-fetched. Older servers omit the
      // field. See change: add-provider-models-refresh.
      const force = Array.isArray(msg.refreshProviders)
        ? msg.refreshProviders.filter((n: unknown): n is string => typeof n === "string")
        : [];
      if (force.length) console.log(`[dashboard] refreshing provider models: ${JSON.stringify(force)}`);
      const diff = await (force.length ? reloadProviders(pi, { force }) : reloadProviders(pi)).catch((err) => {
        console.error("[dashboard] reloadProviders failed:", err);
        return { added: [], removed: [], changed: [] };
      });
      if (diff.added.length || diff.removed.length || diff.changed.length) {
        console.log(
          `[dashboard] hot-reloaded providers: added=${JSON.stringify(diff.added)} removed=${JSON.stringify(diff.removed)} changed=${JSON.stringify(diff.changed)}`,
        );
      }
      inst.cachedModelRegistry?.authStorage?.reload?.();
      // pi 0.84.0: await + inspect refresh() so getAvailable() below sees
      // the refreshed catalogue. Scoped to touched providers; an empty diff
      // (credential-only change) runs a local full refresh.
      // See changes: update-pi-core-0-84-adopt-apis, refresh-models-on-provider-change.
      await refreshAfterCredentialsReload(inst.cachedModelRegistry, diff);
    } catch (err) { console.error("[dashboard] credentials reload failed:", err); }
    // Push updated models list to dashboard client
    if (inst.cachedModelRegistry && inst.sessionReady) {
      try {
        const models = filterByEnabledModels(inst.cachedModelRegistry.getAvailable().map(toModelInfo));
        inst.connection.send({ type: "models_list", sessionId: inst.sessionId, models });
        // See change: replace-hardcoded-provider-lists.
        inst.connection.send({ type: "providers_list", sessionId: inst.sessionId, providers: buildProviderCatalogue() });
      } catch (err) { console.error("[dashboard] models_list push failed:", err); }
    }
    return;
  }
  // Auto-naming toggle relay: store the pushed value so the namer gates on
  // the current preference. See change: add-auto-session-naming.
  if (msg.type === "preferences_update") {
    if (typeof (msg as any).autoNameSessions === "boolean") {
      inst.autoNameSessions = (msg as any).autoNameSessions;
    }
    return;
  }
  // Persisted stop state + session-owned provenance pushed at register, so a
  // permanent stop AND the `auto`/`system`/`user` provenance survive a
  // PROCESS restart / session resume. With no namer yet the adopted state
  // seeds it; a namer that an observation already created gets the
  // provenance via `restoreProvenance` (it replaces a live `user` only when
  // the live name equals the restored witness).
  // See change: fix-auto-naming-reasoning-model (design D7);
  // investigate-auto-name-provenance-relabel (D4).
  if (msg.type === "auto_name_state_restore") {
    const adopted = applyAutoNameRestore(msg as any, inst.autoNamer, pi.getSessionName());
    if (adopted) {
      inst.namerState = adopted;
      inst.shared.namerState = adopted;
    }
    return;
  }
  // Graceful stop-after-turn: latch a per-session flag; the next turn_end
  // shuts the session down cleanly. Idempotent. See change:
  // adopt-pi-071-072-073-features.
  if (msg.type === "stop_after_turn") {
    inst.shared.shouldStopAfterTurn = true;
    return;
  }
  // Forced PR-status probe after a worktree Push / Open PR. The server
  // only targets bridges whose cwd is inside the worktree. See change:
  // redesign-composer-session-strip (D5).
  if (routeGitInfoRefresh(msg, { prStatus: inst.prStatus, gitTracker: inst.polling.gitTracker })) return;
  // Route flow management actions from dashboard buttons
  if (msg.type === "flow_management" && pi.events) {
    if (msg.action === "run") {
      pi.events.emit("flow:run", { flowName: msg.flowName, task: msg.task || undefined });
    } else if (msg.action === "set-edit-mode") {
      // Edit-mode toggle (rework-flows-plugin-for-new-pi-flows). pi-flows
      // persists flows.editFlow, syncs skill visibility, reloads.
      // /flows:new + /flows:edit removed upstream — authoring is now the
      // edit-flow skill via send_prompt from the dashboard.
      if (typeof (msg as { enabled?: unknown }).enabled === "boolean") {
        pi.events.emit("flow:set-edit-mode", { enabled: (msg as { enabled: boolean }).enabled });
      }
    } else if (msg.action === "delete") {
      // Dashboard already confirmed upfront — delete directly
      pi.events.emit("flow:delete-request", { flowName: msg.flowName });
      pi.events.emit("flow:notify", { message: `Flow "${msg.flowName}" deleted.`, level: "info" });
    }
    return;
  }
  // Route role management from dashboard
  if (msg.type === "role_set" && pi.events) {
    const data: any = { role: (msg as any).role, modelId: (msg as any).modelId };
    pi.events.emit("roles:set", data);
    if (data.success) {
      const rolesData: any = {};
      pi.events.emit("roles:get-all", rolesData);
      inst.connection.send({
        type: "roles_list",
        sessionId: inst.sessionId,
        roles: rolesData.roles ?? {},
        presets: rolesData.presets ?? [],
        activePreset: rolesData.activePreset ?? null,
        builtinRoleNames: rolesData.builtinRoleNames ?? [],
      });
    }
    return;
  }
  if (msg.type === "role_preset_load" && pi.events) {
    const data: any = { name: (msg as any).presetName };
    pi.events.emit("roles:preset-load", data);
    if (data.success) {
      const rolesData: any = {};
      pi.events.emit("roles:get-all", rolesData);
      inst.connection.send({
        type: "roles_list",
        sessionId: inst.sessionId,
        roles: rolesData.roles ?? {},
        presets: rolesData.presets ?? [],
        activePreset: rolesData.activePreset ?? null,
        builtinRoleNames: rolesData.builtinRoleNames ?? [],
      });
    }
    return;
  }
  if (msg.type === "role_preset_save" && pi.events) {
    const data: any = { name: (msg as any).presetName };
    pi.events.emit("roles:preset-save", data);
    if (data.success) {
      const rolesData: any = {};
      pi.events.emit("roles:get-all", rolesData);
      inst.connection.send({
        type: "roles_list",
        sessionId: inst.sessionId,
        roles: rolesData.roles ?? {},
        presets: rolesData.presets ?? [],
        activePreset: rolesData.activePreset ?? null,
        builtinRoleNames: rolesData.builtinRoleNames ?? [],
      });
    }
    return;
  }
  if (msg.type === "role_preset_delete" && pi.events) {
    const data: any = { name: (msg as any).presetName };
    pi.events.emit("roles:preset-delete", data);
    if (data.success) {
      const rolesData: any = {};
      pi.events.emit("roles:get-all", rolesData);
      inst.connection.send({
        type: "roles_list",
        sessionId: inst.sessionId,
        roles: rolesData.roles ?? {},
        presets: rolesData.presets ?? [],
        activePreset: rolesData.activePreset ?? null,
        builtinRoleNames: rolesData.builtinRoleNames ?? [],
      });
    }
    return;
  }
  // Remove a CUSTOM role: purge from schema + active map + every preset.
  // Built-ins are rejected server-side in the roles:remove handler.
  // Mirrors the role_set routing block. See change: add-custom-roles-ui.
  if (msg.type === "role_remove" && pi.events) {
    const data: any = { role: (msg as any).role };
    pi.events.emit("roles:remove", data);
    if (data.success) {
      const rolesData: any = {};
      pi.events.emit("roles:get-all", rolesData);
      inst.connection.send({
        type: "roles_list",
        sessionId: inst.sessionId,
        roles: rolesData.roles ?? {},
        presets: rolesData.presets ?? [],
        activePreset: rolesData.activePreset ?? null,
        builtinRoleNames: rolesData.builtinRoleNames ?? [],
      });
    }
    return;
  }
  if (msg.type === "request_roles" && pi.events) {
    const rolesData: any = {};
    pi.events.emit("roles:get-all", rolesData);
    inst.connection.send({
      type: "roles_list",
      sessionId: inst.sessionId,
      roles: rolesData.roles ?? {},
      presets: rolesData.presets ?? [],
      activePreset: rolesData.activePreset ?? null,
      builtinRoleNames: rolesData.builtinRoleNames ?? [],
    });
    return;
  }
  // Route PromptBus responses from dashboard client
  if (msg.type === "prompt_response" && inst.promptBus) {
    inst.promptBus.respond({
      id: (msg as any).promptId,
      answer: (msg as any).answer,
      cancelled: (msg as any).cancelled,
      source: (msg as any).source ?? "dashboard-default",
      // Optional pasted images for method:"input".
      // See change: add-ask-user-input-multiline-paste.
      images: (msg as any).images,
    });
    return;
  }
  // Legacy architect_prompt_response routing REMOVED.
  // Previously routed to flow:prompt-response + cancelAllPending().
  // Now handled by PromptBus: dashboard sends prompt_response,
  // bus calls respond(), adapters get onResponse() for cross-cancellation.
  // Route flow control messages to pi-flows via pi.events
  // Generic plugin-registered event emission. A dashboard plugin action
  // (e.g. automation) emits a configured event INTO this session; the
  // bridge relays it onto pi.events. Decoupled: the bridge does not know
  // which events exist. See change: automation-emit-configured-event.
  if (msg.type === "plugin_emit_event" && pi.events) {
    const eventType = (msg as { eventType?: unknown }).eventType;
    if (typeof eventType === "string" && eventType.length > 0) {
      const data = (msg as { data?: unknown }).data;
      pi.events.emit(eventType, data && typeof data === "object" ? (data as Record<string, unknown>) : {});
    }
    return;
  }
  // Subagent resync (D2): reply with the latest retained snapshot of a
  // running subagent as a synthetic subagent_started event_forward. No-op
  // for an unknown/finished agent (durable completed-case backfill covers
  // those). See change: fix-subagent-live-detail-reliability.
  if (msg.type === "subagent_resync_request") {
    // The incoming id may be EITHER a v4 agentId or a v7 runner
    // agentSessionId (from a deep-link route); resync() resolves both.
    // See change: resolve-subagent-inspector-by-session-id (D3/D4).
    const requestedId = (msg as { agentId?: unknown }).agentId;
    if (typeof requestedId === "string" && requestedId.length > 0) {
      // The reply is NEVER stripped: it IS the pull model's answer and
      // carries the full timeline for a RUNNING agent — exactly the shape a
      // strip inside `sendEventForward` would have destroyed.
      // See change: reduce-subagent-details-payload (X6).
      const echoId = (msg as { requestId?: unknown }).requestId;
      const resolvedAgentId = serveSubagentResync(
        inst.subagentFrameBuffer,
        requestedId,
        inst.sendEventForward,
        () => inst.sessionReady && inst.isActive(),
        typeof echoId === "string" && echoId.length > 0 ? echoId : undefined,
        (msg as { reason?: "open" | "cadence" }).reason,
      );
      console.log(
        resolvedAgentId
          ? `[dashboard] served subagent resync for id=${requestedId} (resolved agentId=${resolvedAgentId})`
          : `[dashboard] subagent resync no-op (unknown/finished/not-ready) id=${requestedId}`,
      );
    }
    return;
  }
  // Prompt resync (fix B, extension half): a browser asked the bridge to
  // re-emit every prompt it is still awaiting an answer for — the bus's
  // pending set is the source of truth, NOT the server's derived registry
  // (D6). Each frame echoes the requester token so the server unicasts it
  // back to the asking browser as a critical frame. Empty pending set →
  // zero frames, no error (E10); a malformed token degrades to tokenless.
  // See change: fix-pending-prompt-lost-on-replay (design D5/D6/D7).
  if (msg.type === "prompt_resync_request") {
    const echoId = (msg as { requestId?: unknown }).requestId;
    const token = typeof echoId === "string" && echoId.length > 0 ? echoId : undefined;
    if (inst.promptBus) {
      emitPendingPrompts(inst.promptBus, (m) => inst.connection.send(m as any), inst.sessionId, token);
    }
    return;
  }
  if (msg.type === "flow_control" && pi.events) {
    if (msg.action === "abort") {
      pi.events.emit("flow:abort", {});
      // Also abort architect if running (mutually exclusive with flow execution;
      // the irrelevant emit is a no-op due to guard checks on both listeners)
      pi.events.emit("flow:architect-abort", {});
    } else if (msg.action === "toggle_autonomous") {
      pi.events.emit("flow:toggle-autonomous", {});
    } else if (msg.action === "dismiss_summary") {
      pi.events.emit("flow:summary-dismissed", {});
    }
    return;
  }
  // ── Follow-up queue mutation (bridge-owned buffer) ─────────────────
  //
  // These four handlers mutate `bridgeFollowUp` only. NONE of them
  // call pi.sendUserMessage, pi.clear*Queue, or any other pi method.
  // The bridge owns the buffer; pi never sees these entries until the
  // drain loop ships them on agent_end as fresh-turn sendUserMessage.
  //
  // The OLD pi-mutation handler set from Phase 3 (clear_steering_queue,
  // clear_followup_slot, edit_followup_slot) is GONE forever — pi's
  // ExtensionAPI exposes no clear*Queue primitives (verified through
  // pi 0.76.0). Steer mutation will never be exposed (steer drains too
  // fast for it to matter; user direction).
  //
  // See change: rework-mid-turn-prompt-queue (design.md D3).
  if (msg.type === "edit_followup_entry") {
    const { index, text } = msg as { type: string; index: number; text: string };
    // Text-only edit: the entry's images are PRESERVED (design D5). Gated
    // on the byte ceiling because the inline editor can grow text without
    // bound; a refused edit leaves the entry untouched and emits no
    // `queue_update`. See change: fix-bridge-followup-image-drop.
    const edited = inst.bridgeFollowUp.editText(index, text);
    if (!edited.ok) {
      inst.sendCommandFeedback("edit_followup_entry", edited.message);
      return;
    }
    inst.emitQueueUpdate();
    return;
  }
  if (msg.type === "remove_followup_entry") {
    const { index } = msg as { type: string; index: number };
    if (!inst.bridgeFollowUp.removeAt(index)) {
      inst.sendCommandFeedback("remove_followup_entry", "Index out of range");
      return;
    }
    inst.emitQueueUpdate();
    return;
  }
  if (msg.type === "promote_followup_entry") {
    const { index } = msg as { type: string; index: number };
    // Silent no-op for index 0 or invalid — no emit (D3). Carries images.
    if (inst.bridgeFollowUp.promote(index)) inst.emitQueueUpdate();
    return;
  }
  if (msg.type === "clear_followup_entries") {
    const { indices } = msg as { type: string; indices: number[] | "all" };
    const mutated =
      indices === "all" ? inst.bridgeFollowUp.clearAll() : inst.bridgeFollowUp.clearIndices(indices);
    if (mutated) inst.emitQueueUpdate();
    return;
  }
  const response = await inst.commandHandler.handle(msg);
  if (response) inst.connection.send(response);
  // Immediately send model/thinking update after handling set_thinking_level
  if (msg.type === "set_thinking_level") {
    // Small delay to let pi process the level change
    setTimeout(() => inst.sendModelUpdateIfChanged(), 50);
  }
}
