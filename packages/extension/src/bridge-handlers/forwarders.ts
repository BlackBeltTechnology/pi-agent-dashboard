/**
 * pi event forwarders: enriched and pass-through `pi.on` registrations.
 *
 * Extracted from `bridge.ts` (change: test-trust-audit, design D2). Receives the per-incarnation
 * `BridgeInstance`; holds no module-level mutable state and never imports the bridge entry point.
 */

import fs from "node:fs";
import os from "node:os";
import { isUnderArtifactRoot, resolveArtifactRoots } from "../artifact-roots.js";
import { feedPollingEvent, scheduleModelRecheckOnSelect } from "../bridge-polling.js";
import { SURFACE_MESSAGE } from "../empty-actionable-guard.js";
import { mapEventToProtocol, redactBeforeSettleContext, redactCompactionEntry } from "../event-forwarder.js";
import { flushesParkedText } from "../message-update-coalescer.js";
import { stripForForward } from "../subagent-frame-strip.js";
import { isSubagentTick } from "../subagent-tick-throttle.js";
import { inlineToolResultImages } from "../tool-result-image-inliner.js";
import { classifyTurnActionability } from "../turn-actionability.js";
import type { BridgeInstance } from "./instance.js";

// Forward all pi core events to the dashboard.
// Events with special enrichment logic:
const enrichedEventTypes = [
  "agent_start",
  "agent_end",
  "agent_settled",
  "turn_start",
  "turn_end",
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "session_compact",
  "model_select",
  "thinking_level_select",
] as const;
// Pass-through events: forwarded as-is with no special handling.
// Unrecognized types render as expandable JSON cards in the dashboard.
const passThroughEventTypes = [
  "tool_call",
  "tool_result",
  "user_bash",
  "input",
  "before_agent_start",
  "resources_discover",
  "session_before_switch",
  "session_before_fork",
  "session_before_compact",
  "session_before_tree",
  "session_tree",
  // pi >= 0.84.3. Clears the server-side `compacting` latch on the failure
  // path (see event-status-extraction.ts) — without it a failed or aborted
  // compaction blocks every later reload of the session.
  "session_compact_failed",
  // pi >= 0.84.4. Brackets a BLOCKING `ctx.ui` prompt so the dashboard can
  // tell "agent working" apart from "pi parked waiting on a user prompt".
  // The 0.85.1 lockstep floor guarantees both events; the subscription is
  // unconditional (no version gate, not merely inert below an old floor).
  "ui_prompt_start",
  "ui_prompt_end",
  // pi >= 0.87. Fires before final settlement; no status effect (the agent
  // may still continue). Forwarded without its `context` preview.
  // See change: update-pi-core-1-0-adopt-apis (D5).
  "agent_before_settle",
] as const;
// Excluded from subscription (not forwarded):
// - `context`: carries full message arrays (very large)
// - `before_provider_request`: carries raw API payloads (very large)
// - `session_start`: dedicated handler → session_register protocol message
// - session change (new/fork/resume): handled inside session_start via event.reason
// - `session_shutdown`: dedicated handler → disconnect/cleanup
// - `cache_warming_decision`: dedicated observe-only handler → usage drain
//   (`usage_recorded`), never `event_forward`. See change: count-non-message-usage.

/** Forward the pi events that need enrichment (message coalescing, ids, usage) to the dashboard. */
export function registerEnrichedForwarders(inst: BridgeInstance): void {
  const pi = inst.pi;
  for (const eventType of enrichedEventTypes) {
    pi.on(eventType as any, inst.safe(async (event: any, ctx: any) => {
      // Bail out if a newer bridge instance has taken over
      if (!inst.isActive()) return;
      // Always keep latest context for abort/shutdown
      inst.cachedCtx = ctx;
      // Don't send events before session_start has established the correct session ID
      if (!inst.sessionReady) return;
      // ── Flush choke point (D5) ──────────────────────────────────────────
      // The invariant is "no non-`message_update` event may reach the wire while
      // a text snapshot is parked". ONE statement here — before ANY branch, so
      // it covers every early return below, including ones added later. Do not
      // move it into a branch: a branch-scoped flush is exactly the bug this
      // change exists to prevent.
      // See change: coalesce-bridge-message-update-snapshots.
      if (flushesParkedText(eventType)) inst.coalescer.flush();
      // Adaptive process-scan cadence hooks. See change: optimize-polling-hot-paths.
      feedPollingEvent(eventType, event, inst.polling);
      // Track agent streaming state (survives reconnect/reload)
      if (eventType === "agent_start") {
        inst.shared.isAgentStreaming = true;
        // Abort latch (resumption hook): if a user abort is still latched when
        // pi fires a fresh agent_start for the aborted turn (no intervening
        // user prompt cleared it), abort again. See change:
        // unify-error-retry-lifecycle.
        if (inst.abortLatch.shouldAbort(inst.sessionId)) {
          try { inst.cachedCtx?.abort?.(); } catch { /* idempotent */ }
        }
        // Provider-retry synthesis: when this agent_start is the awaited retry
        // attempt (a chain is armed), emit auto_retry_start so the surface
        // flips waiting → in-flight. Deferred via setTimeout(0) so it lands on
        // the wire AFTER this agent_start (the reducer defensively clears
        // retryState on agent_start, so the synth must arrive next to re-set
        // it). See change: retry-forever-with-stop-control (design D4).
        const retryStart = inst.retryTracker.observeAgentStart(inst.sessionId);
        if (retryStart) {
          setTimeout(() => {
            if (inst.retryTracker.isRetrying(inst.sessionId)) {
              inst.sendSyntheticRetryEvent(retryStart.eventType, retryStart.data);
            }
          }, 0);
        }
      }
      if (eventType === "agent_settled") {
        // Terminal settle (native pi, guaranteed at the 0.85.1 lockstep floor;
        // fires once after the run loop). Clear streaming. This is the SOLE
        // terminal signal for a retry chain: close it with auto_retry_end
        // BEFORE forwarding the settle. The floor-pi synthesis path was
        // retired with agent-settled.ts. See changes: adopt-pi-074-080-features
        // (A.1), retry-forever-with-stop-control, update-pi-core-0-85-adopt-apis.
        inst.shared.isAgentStreaming = false;
        inst.abortLatch.clear(inst.sessionId);
        // Drain point. See change: count-non-message-usage.
        inst.drainUsage(ctx);
        const retryEnd = inst.retryTracker.observeAgentSettled(inst.sessionId);
        if (retryEnd) {
          inst.sendSyntheticRetryEvent(retryEnd.eventType, retryEnd.data);
        }
        // Bridge-owned follow-up drain: pop one entry from bridgeFollowUp and
        // hand it to pi as a fresh turn (sendUserMessage, no deliverAs). pi
        // clears its run-active flag BEFORE it emits `agent_settled`, so a
        // timer scheduled here observes an idle session (a sendUserMessage made
        // synchronously inside the settle emission would be deferred by pi into
        // its own settle path, outside the bridge's error handling). One settle
        // fires per run — after the LAST attempt of an auto-retry chain and
        // after an abort — so the drain never probes between attempts. A false
        // `isIdle()` (another run already started) makes the drain return; the
        // next settle drains. After the abort-latch clear above, so a user
        // abort is never resumed by the drain.
        // See change: update-pi-core-1-3-adopt-apis (design D4).
        setTimeout(() => inst.drainFollowupQueue(), 0);
      }
      if (eventType === "agent_end") {
        inst.shared.isAgentStreaming = false;
        // Provider-retry synthesis: an error agent_end means an attempt just
        // failed and (optimistically) another is coming — emit the WAITING
        // signal (attempt + computed delay + nextAttemptAt) so the surface
        // shows a live countdown during pi's sleep. The chain is NOT closed
        // here; only agent_settled (above) terminates it. A non-error agent_end
        // returns null. See change: retry-forever-with-stop-control (design D4).
        const trackerSynth = inst.retryTracker.observeAgentEnd(inst.sessionId, event as any);
        if (trackerSynth) {
          inst.sendSyntheticRetryEvent(trackerSynth.eventType, trackerSynth.data);
        }
        // Automatic session topic-naming: attempt on each terminal turn until
        // the first success (or a permanent lockout). Non-blocking; all errors
        // are handled inside the namer. See change: add-auto-session-naming.
        inst.runAutoNameOnTurnEnd();
        // Bridge shadow follow-up queue: the per-entry drain matcher in
        // the `message_start` handler removes each entry as pi delivers it
        // (mirrors pi's internal `_processAgentEvent`). No bulk clear here
        // — it would wipe entries the user adds DURING the drain window.
        // See change: add-followup-edit-and-steer-cancel (per-entry-drain).

        // The follow-up drain no longer runs here: it moved to `agent_settled`
        // (above), which fires once per run after pi is idle.
        // See change: update-pi-core-1-3-adopt-apis (design D4).

        // Empty-actionable-turn guard: classify this turn's terminal shape.
        // A thinking-only / empty `stop` (no visible text, no tool call, no
        // error) would otherwise idle the session silently. Continue-or-
        // surface instead. Normal / tool-call / truncated / error turns yield
        // `none` and only reset the guard's per-session counter.
        // See change: fix-gemini-subagent-silent-tool-schema-failure.
        {
          const agentMsgs = (event as any)?.messages;
          const terminalMsg =
            Array.isArray(agentMsgs) && agentMsgs.length > 0
              ? (agentMsgs[agentMsgs.length - 1] as Record<string, unknown>)
              : undefined;
          if (terminalMsg?.role === "assistant") {
            const actionability = classifyTurnActionability(terminalMsg as any);
            const decision = inst.emptyActionableGuard.observe(inst.sessionId, actionability);
            if (decision.action === "continue" && decision.nudge) {
              // Only nudge when nothing else will already re-run the session
              // (no user/system follow-up pending). A pending entry means the
              // session is not idling, so the guard can safely no-op.
              if (inst.bridgeFollowUp.length === 0) {
                inst.enqueueSystemFollowup(decision.nudge);
              }
            } else if (decision.action === "surface") {
              // Non-error status: the model returned only reasoning. Forward a
              // structured, non-error notice so the server logs it to
              // server.log and the dashboard card renders it (distinct from an
              // error banner).
              const model =
                typeof terminalMsg.model === "string"
                  ? (terminalMsg.model as string)
                  : undefined;
              const provider =
                typeof terminalMsg.provider === "string"
                  ? (terminalMsg.provider as string)
                  : undefined;
              inst.connection.send({
                type: "event_forward",
                sessionId: inst.sessionId,
                event: {
                  eventType: "empty_actionable_surface",
                  timestamp: Date.now(),
                  data: {
                    message: decision.reason ?? SURFACE_MESSAGE,
                    model: provider && model ? `${provider}/${model}` : model,
                  },
                },
              });
            }
          }
        }

      }
      // For model_select, enrich the event data with thinkingLevel
      if (eventType === "model_select") {
        const enriched = { ...event, thinkingLevel: (pi as any).getThinkingLevel?.() };
        const msg = mapEventToProtocol(inst.sessionId, enriched);
        inst.connection.send(msg);
        // A TUI-initiated model change otherwise waits for the 30 s tick. The
        // 50 ms deferral lets pi's ctx.model reflect the new model first (same
        // as the dashboard-initiated setModel path). See change:
        // optimize-polling-hot-paths (D8).
        scheduleModelRecheckOnSelect(inst.setRegisteredTimeout, inst.sendModelUpdateIfChanged);
        return;
      }

      // Pi 0.71+ fires a dedicated thinking_level_select event when the
      // thinking level changes alone (no model change). Push a model_update
      // through the existing dedup gate so the dashboard reflects it
      // immediately rather than waiting for the next model change.
      // See change: adopt-pi-071-072-073-features.
      if (eventType === "thinking_level_select") {
        inst.sendModelUpdateIfChanged();
        return;
      }

      // Graceful stop-after-turn: when latched, shut the session down cleanly
      // at this turn boundary. Fall back to abort if shutdown is unavailable.
      // Clear the flag BEFORE calling shutdown so a double-fired turn_end
      // can't re-trigger. See change: adopt-pi-071-072-073-features.
      if (eventType === "turn_end" && inst.shared.shouldStopAfterTurn) {
        inst.shared.shouldStopAfterTurn = false;
        try {
          if (typeof (ctx as any)?.shutdown === "function") (ctx as any).shutdown();
          else (ctx as any)?.abort?.();
        } catch (err) {
          console.error("[dashboard] stop-after-turn shutdown failed:", err);
        }
      }

      // For turn_end, enrich with contextUsage (pi-only API) so server can extract stats
      if (eventType === "turn_end") {
        const contextUsage = ctx.getContextUsage?.();
        if (contextUsage) {
          const enriched = { ...event, contextUsage };
          const msg = mapEventToProtocol(inst.sessionId, enriched);
          inst.connection.send(msg);
          return;
        }
      }

      // For message_start: stamp a nonce on the event so the client reducer
      // can correlate a later entry_persisted back-fill with this bubble.
      // We do NOT attach entryId here — the message has no id yet on pi
      // 0.69+ (persistence is deferred to message_end). See change:
      // fix-per-message-fork.
      //
      // USER message_start sends are deferred via setTimeout(0) so they
      // land on the wire AFTER any pending message_end deferrals (which
      // also use setTimeout(0) — timer FIFO preserves order). Without this,
      // a follow-up user message_start emitted synchronously by pi during
      // an agent_settled drain would arrive BEFORE the preceding assistant
      // message_end, and the client reducer would append the user bubble
      // above the assistant's final response. ASSISTANT message_start stays
      // sync because message_update events fire sync and the reducer's
      // streamingTextFlushed reset depends on message_start being processed
      // first. See change: add-followup-edit-and-steer-cancel (chat-order).
      if (eventType === "message_start") {
        // Barrier, at ENTRY: bump the generation and open the identity BEFORE
        // the `role === "custom"` early return below, so a custom message still
        // closes out the previous identity's slot.
        // See change: coalesce-bridge-message-update-snapshots (D4).
        inst.assistantMessageGen += 1;
        inst.coalescer.messageStart(
          inst.assistantMessageGen,
          inst.messageKeyOf(inst.assistantMessageGen, (event as any).message),
          (event as any).message,
        );
        // Custom messages are forwarded by wrapCustomPersistenceForCtx (pi's
        // idle-path sendMessage emits message_start/end internally only, and
        // the agent-loop path would double-forward here). See change:
        // render-inline-reasoning-and-custom-entries (D2).
        if ((event as any).message?.role === "custom") return;
        // pi >= 0.86.0 makes the system prompt/tool loadout transcript-backed:
        // `agent-loop.js` emits the first request's `role:"system"` message with
        // every prompt `section` and the full `toolsAdded` declaration list as a
        // `message_start`/`message_end` pair (~150 KB per message, so both
        // events cost ~2x that per session). The client has no `role:"system"`
        // arm, so forwarding it is pure wire cost with no render. Return AFTER
        // the barrier above (same placement as `custom`) so the barrier's
        // contract — every `message_start` opens an identity — is unchanged.
        // No version gate: pi < 0.86 never emits the role, so this is inert
        // there. See change: filter-system-role-message-forwarding (D2).
        if ((event as any).message?.role === "system") return;
        inst.wrapAppendMessageForCtx(ctx);
        // Lazy retry (review round 1): if session_start ran before the
        // sessionManager exposed its persistence methods, the wrapper would
        // never engage. Idempotent per-sm — re-invoking here repairs that.
        inst.wrapCustomPersistenceForCtx(ctx);
        const messageRef = (event as any).message;
        if (messageRef && typeof messageRef === "object") {
          const nonce = inst.nextNonce();
          inst.pendingNonces.set(messageRef as object, nonce);
          const enriched = { ...event, nonce };
          const msg = mapEventToProtocol(inst.sessionId, enriched);
          const role = (messageRef as any).role;
          // Abort latch (resumption + clear hooks). A USER message_start is a
          // deliberate new turn — clear the latch so it is never aborted. An
          // ASSISTANT message_start while the latch is set is the aborted
          // turn resuming a retry (no intervening user prompt) — abort again.
          // See change: unify-error-retry-lifecycle.
          if (role === "user") {
            inst.abortLatch.clear(inst.sessionId);
            inst.retryTracker.noteExplicitRun(inst.sessionId);
            // A deliberate new user turn resets the empty-actionable guard's
            // consecutive-continuation counter, so a stale count from a prior
            // (possibly aborted) empty-actionable chain never shortens the next
            // unrelated prompt's retry budget.
            // See change: fix-gemini-subagent-silent-tool-schema-failure.
            inst.emptyActionableGuard.reset(inst.sessionId);
          } else if (inst.abortLatch.shouldAbort(inst.sessionId)) {
            try { inst.cachedCtx?.abort?.(); } catch { /* idempotent */ }
          }
          // NOTE: retry synthesis moved off `message_start`. pi ends a full
          // agent turn per attempt, so the retry lifecycle is now driven by
          // agent_start (in-flight) / agent_end (waiting) / agent_settled
          // (terminal). See change: retry-forever-with-stop-control.
          if (role === "user") {
            // Per-entry shadow-queue drain matcher: mirror pi's internal
            // logic (`_processAgentEvent` in pi-coding-agent
            // agent-session.js). When pi delivers a queued user message,
            // find its text in `bridgeSteering` first then `bridgeFollowUp`,
            // remove the first occurrence, and emit a fresh `queue_update`.
            //
            // POST-rework-mid-turn-prompt-queue: the steer side is
            // unchanged — pi still owns steering. The follow-up side is
            // now reduced in scope: dashboard-buffered follow-ups never
            // reach pi via {deliverAs:"followUp"} (the drain loop ships
            // them as no-deliverAs fresh-turn sends, popped from the
            // buffer BEFORE the pi call). So this matcher will splice
            // bridgeFollowUp ONLY for:
            //   (a) TUI-queued follow-ups draining through pi's natural
            //       queue (text not in bridgeFollowUp → indexOf=-1 → no-op)
            //   (b) Any code path that calls
            //       pi.sendUserMessage(_, {deliverAs:"followUp"}) directly.
            //       One exists: the single-bang `!cmd` output. Its text
            //       (`$ cmd\n…`) is never a `bridgeFollowUp` entry, so the
            //       matcher stays a no-op for it.
            // The follow-up matcher is therefore defense-in-depth; cost is
            // one indexOf per user message_start.
            //
            // See changes: rework-mid-turn-prompt-queue (design.md D9, R7),
            // update-pi-core-1-3-adopt-apis (design D3).
            const text = inst.extractUserMessageText(messageRef);
            if (text) {
              const sIdx = inst.bridgeSteering.indexOf(text);
              if (sIdx !== -1) {
                inst.bridgeSteering.splice(sIdx, 1);
                inst.emitQueueUpdate();
              } else {
                const fIdx = inst.bridgeFollowUp.indexOfText(text);
                if (fIdx !== -1) {
                  inst.bridgeFollowUp.removeAt(fIdx);
                  inst.emitQueueUpdate();
                }
              }
            }
            setTimeout(() => {
              if (!inst.isActive() || !inst.sessionReady) return;
              inst.connection.send(msg);
            }, 0);
          } else {
            inst.connection.send(msg);
          }
          return;
        }
      }

      // For message_end: defer the SEND via setTimeout(0). Pi 0.69+ runs
      // sessionManager.appendMessage AFTER the awaited extension dispatcher
      // returns, so a queueMicrotask deferral is no longer enough. By the
      // time the macrotask fires, appendMessage has run, pi has mutated
      // event.message.id in place, and the wrapped appendMessage above has
      // populated idByMessage. We also stamp a nonce so a downstream
      // entry_persisted can correlate (covers user message_end where the
      // earlier message_start nonce is what the reducer is waiting on).
      // See change: fix-per-message-fork.
      if (eventType === "message_end") {
        // Barrier, at ENTRY and BEFORE the deferred send is scheduled below: the
        // entry flush has already put the final snapshot on the wire, so closing
        // here means any update arriving during the macrotask gap is dropped by
        // the closed slot instead of landing after the `message_end`.
        // See change: coalesce-bridge-message-update-snapshots (D4/D5).
        // The generation this message was OPENED under, not the counter's
        // current value: a message_end for a message whose start we saw must
        // close ITS identity, never a newer one. Falls back to the current
        // counter for a message this instance never saw open (reload mid-turn).
        const endMessage = (event as any).message;
        const endGen = inst.coalescer.generationOf(endMessage, inst.assistantMessageGen);
        inst.coalescer.messageEnd(endGen, inst.messageKeyOf(endGen, endMessage));
        // Custom messages are forwarded by wrapCustomPersistenceForCtx — see
        // the message_start guard above. See change:
        // render-inline-reasoning-and-custom-entries (D2).
        if ((event as any).message?.role === "custom") return;
        // Same pi >= 0.86.0 system-role drop as the `message_start` arm above,
        // after the same barrier. See change:
        // filter-system-role-message-forwarding (D2).
        if ((event as any).message?.role === "system") return;
        inst.wrapAppendMessageForCtx(ctx);
        const messageRef = (event as any).message;
        const nonce = messageRef && typeof messageRef === "object"
          ? (inst.pendingNonces.get(messageRef as object) ?? inst.nextNonce())
          : inst.nextNonce();
        if (messageRef && typeof messageRef === "object" && !inst.pendingNonces.has(messageRef as object)) {
          inst.pendingNonces.set(messageRef as object, nonce);
        }
        // Apply markdown image inliner to assistant content. Mutates
        // event.message.content in place AND ships any new asset_register
        // messages immediately so they precede the deferred message_end
        // send below. See change: chat-markdown-local-images-and-math.
        inst.maybeInlineAssistantImages(event);
        // Run the retry-tracker SYNCHRONOUSLY here, BEFORE the handler
        // returns, so any synthesized retry event lands on the wire BEFORE
        // the next `agent_end` (which pi fires synchronously back-to-back,
        // see pi-coding-agent agent-session.js:298–331). The message_end
        // body itself stays deferred for the entryId workaround
        // (`fix-per-message-fork`); that does not affect retry-state ordering
        // since the reducer's message_end arm does not touch
        // retryState/lastError.
        //
        // Observe-based: an error message_end records a pending failure and
        // emits NOTHING (the retry is confirmed only when pi starts a fresh
        // assistant message_start). A non-error message_end that closes an
        // in-flight chain emits auto_retry_end{success:true}. Billing/quota
        // failures flow through this same path — pi treats them as terminal,
        // so they settle via agent_end with no special-casing.
        // See change: simplify-error-retry-single-card.
        const synthetic = inst.retryTracker.observeMessageEnd(inst.sessionId, messageRef as any);
        if (synthetic) {
          inst.sendSyntheticRetryEvent(synthetic.eventType, synthetic.data);
        }
        setTimeout(() => {
          if (!inst.isActive() || !inst.sessionReady) return;
          const entryId =
            (messageRef && typeof messageRef === "object" && typeof messageRef.id === "string" ? messageRef.id : undefined)
            ?? (messageRef ? inst.idByMessage.get(messageRef as object) : undefined)
            ?? ctx.sessionManager?.getLeafId?.();
          const enriched = { ...event, entryId, nonce };
          const protoMsg = mapEventToProtocol(inst.sessionId, enriched);
          inst.connection.send(protoMsg);
        }, 0);
        return;
      }

      // Text snapshots are COALESCED (D1–D3): one wire write per fixed window
      // instead of one per source token. `offer` owns the family split and the
      // closed-identity drop rule; the markdown-image inliner now runs inside the
      // coalescer's send callback (once per flushed window, still ahead of the
      // snapshot that references its assets). This branch returns, so the shared
      // tail below never sees a `message_update`.
      // See change: coalesce-bridge-message-update-snapshots (D6).
      if (eventType === "message_update") {
        // Resolve the message's OWN generation, so a late update for an already
        // closed message still keys to that closed identity and is dropped —
        // keying it under the counter's current value would fail open.
        const updateMessage = (event as any)?.message;
        inst.coalescer.offer(event, inst.coalescer.generationOf(updateMessage, inst.assistantMessageGen));
        return;
      }

      // Inline path-referenced image tool results (e.g. browser `screenshot`)
      // as type:"image" content blocks at capture time. Gated to the artifact-
      // root allowlist (default agent-browser screenshot dir +
      // AGENT_BROWSER_SCREENSHOT_DIR) so arbitrary tool-echoed paths are not
      // read/disclosed. Over-cap / out-of-root / missing / non-image paths are
      // left as text and fall back to the artifact route.
      // See change: inline-agent-screenshot-artifacts.
      if (eventType === "tool_execution_end") {
        try {
          const artifactRoots = resolveArtifactRoots({
            homedir: os.homedir(),
            env: process.env,
            realpathSync: fs.realpathSync,
          });
          const inlined = inlineToolResultImages((event as any).result, {
            readFile: inst.inlinerReadFile,
            isAllowedPath: (p) => isUnderArtifactRoot(p, artifactRoots, fs.realpathSync),
          });
          // Apply when a new image was inlined OR when the inliner rewrote the
          // result (e.g. stripped a redundant path whose image the result
          // already carried natively). The inliner returns the SAME reference
          // when nothing changed, so an identity diff is a safe change signal.
          if (inlined.result !== (event as any).result) {
            (event as any).result = inlined.result;
          }
        } catch (err) {
          console.error("[dashboard] tool-result image inline failed:", err);
        }
        // Forward the tool result's structured `details` to the client. pi's
        // live tool_execution_end extension event exposes the full ToolResult
        // ({ content, details }) on `event.result`, but only `result` is
        // otherwise surfaced — the reducer reads a top-level `data.details`
        // (the same field the replay path synthesizes from the persisted
        // entry). Lift `result.details` to the event so renderers (e.g. the
        // flow_agents list card) get a non-truncated structured payload LIVE,
        // not only after a replay/refresh. No-op when result carries no
        // details or already has a top-level details.
        // See change: flow-agents-readable-list.
        try {
          const r = (event as any).result;
          if (
            !(event as any).details &&
            r && typeof r === "object" && !Array.isArray(r) &&
            (r as any).details && typeof (r as any).details === "object"
          ) {
            (event as any).details = (r as any).details;
          }
        } catch { /* non-fatal */ }
      }

      // The `tool_execution_update` carrier is structurally disjoint from the
      // EventBus path (pi core event → `pi.on()` → `connection.send`), but one
      // `snapshotDetails()` object feeds both — so stripping one carrier only
      // is a half-fix. `tool_execution_end` is terminal and stays fat.
      // See change: reduce-subagent-details-payload (D2, task 3.8).
      //
      // `session_compact` is forwarded WITHOUT its `compactionEntry`. pi >= 0.86
      // fills that entry's `systemMessage` with the same prompt-sections +
      // tool-declaration checkpoint the system-role arms above drop, and carries
      // the compaction `summary` beside it. No dashboard consumer reads either:
      // the client renders the divider from the event's presence and the badge
      // from `reason`/`willRetry`/`estimatedPostCompactionTokens`; the server
      // uses the event only to clear the `compacting` latch. Redact on a COPY —
      // pi hands the SAME event object to every subscribed extension, so a
      // `delete event.compactionEntry` would strip the field from unrelated
      // extensions too. The redaction stays OUT of `mapEventToProtocol` (which
      // is generic over every forwarded type). No version gate: the field is
      // simply omitted wherever it is absent.
      // See change: filter-system-role-message-forwarding (D6/D7).
      const forwardEvent =
        eventType === "session_compact"
          ? redactCompactionEntry(event as Record<string, unknown>)
          : event;
      const msg = mapEventToProtocol(inst.sessionId, forwardEvent);
      let heldByThrottle = false;
      if (eventType === "tool_execution_update") {
        msg.event.data = stripForForward(msg.event.data as Record<string, unknown>);
        // Agent ticks only (allowlist predicate) — every other tool's update
        // stream forwards 1:1. `offer` returns false when it has taken
        // ownership of the frame and will send (or discard) it later.
        // See change: reduce-bridge-tick-bandwidth (D2).
        if (isSubagentTick(event) && typeof event.toolCallId === "string") {
          heldByThrottle = !inst.subagentTickThrottle.offer(event.toolCallId, msg, inst.sessionId);
        }
      }
      if (eventType === "tool_execution_end" && typeof event.toolCallId === "string") {
        // Terminal: DISCARD any held tick rather than flushing it. This carrier
        // never carries terminal state, so a held frame is a strictly stale
        // intermediate snapshot; flushing it would race the overwrite that
        // visibly re-opens a finished tool row. Runs before the send so no held
        // frame can interleave after the end event.
        inst.subagentTickThrottle.onTerminal(event.toolCallId);
      }
      if (!heldByThrottle) inst.connection.send(msg);

      // Native `agent_settled` (pi ≥ 0.80.4, guaranteed at the 0.85.1 floor) is
      // the single terminal signal; the bridge forwards it above and the
      // `agent_settled` handler closes the retry chain. The floor-pi synthesis
      // path was retired once `piCompatibility.minimum` reached a version that
      // emits natively. See change: update-pi-core-0-85-adopt-apis.
    }));
  }
}

/** Forward the remaining pi events to the dashboard unchanged. */
export function registerPassThroughForwarders(inst: BridgeInstance): void {
  const pi = inst.pi;
  for (const eventType of passThroughEventTypes) {
    pi.on(eventType as any, inst.safe(async (event: any, ctx: any) => {
      if (!inst.isActive()) return;
      inst.cachedCtx = ctx;
      if (!inst.sessionReady) return;
      // Same choke point as the enriched loop (D5).
      inst.coalescer.flush();
      const forwarded = event?.type === "agent_before_settle" ? redactBeforeSettleContext(event) : event;
      const msg = mapEventToProtocol(inst.sessionId, forwarded);
      inst.connection.send(msg);
    }));
  }
}
