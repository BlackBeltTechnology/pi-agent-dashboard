/**
 * Session action callbacks extracted from App.tsx.
 * Handles send, abort, resume, spawn, hide, rename, shutdown, terminal, and selection actions.
 */
import { useCallback } from "react";
import { createInitialState, resolveInteractiveRequest, type SessionState } from "../lib/event-reducer.js";
import { encodePromptAnswer } from "../lib/prompt-answer-encoder.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { TerminalSession } from "@blackbelt-technology/pi-dashboard-shared/terminal-types.js";
import type { ImageContent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export interface SessionActionDeps {
  selectedId: string | undefined;
  send: (msg: any) => void;
  navigate: (to: string) => void;
  setMobileOpen: React.Dispatch<React.SetStateAction<boolean>>;
  /**
   * Read-only handle on the sessions map. Used by queue-management
   * actions to look up an entry's text by id before clearing the
   * optimistic `pendingPrompt` state. Pass the latest map from the
   * component scope; useCallback captures by ref via this object.
   */
  sessions: Map<string, DashboardSession>;
  setSessions: React.Dispatch<React.SetStateAction<Map<string, DashboardSession>>>;
  setSessionStates: React.Dispatch<React.SetStateAction<Map<string, SessionState>>>;
  setSpawningCwds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setTerminals: React.Dispatch<React.SetStateAction<Map<string, TerminalSession>>>;
  clearSpawningCwd: (cwd: string) => void;
  spawnTimeoutsRef: React.MutableRefObject<Map<string, ReturnType<typeof setTimeout>>>;
  pendingTerminalCwdRef: React.MutableRefObject<string | null>;
  terminals: Map<string, TerminalSession>;
  /**
   * Maps client-minted `requestId` → originating click metadata. Populated
   * by `handleSpawnSession` / `handleResumeSession`; consumed by
   * `useMessageHandler.session_added` for exact auto-select correlation.
   * See change: spawn-correlation-token.
   */
  pendingSpawnsRef: React.MutableRefObject<Map<string, { cwd: string; kind: "spawn" | "resume"; placeholderCwd?: string }>>;
}

export function useSessionActions(deps: SessionActionDeps) {
  const {
    selectedId, send, navigate, setMobileOpen,
    sessions, setSessions, setSessionStates, setSpawningCwds, setTerminals,
    clearSpawningCwd, spawnTimeoutsRef, pendingTerminalCwdRef, terminals,
    pendingSpawnsRef,
  } = deps;

  // Native crypto.randomUUID is widely available; fall back to a Math.random
  // UUIDish for legacy environments without it.
  const mintRequestId = (): string => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    // Best-effort fallback (unlikely to hit in supported browsers).
    return `rq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  };

  const handleAbort = useCallback(() => {
    if (!selectedId) return;
    // Drop any optimistic `pendingPrompt` for this session. Abort tells
    // the bridge to drop its queue (`clearQueueOnAbort`), so any text
    // that was being represented as a queue chip will no longer appear
    // in the next `queue_state` snapshot. Without this client-side
    // clear, the chip-vs-card swap rule un-fires and the optimistic
    // card pops back into view until pi finally emits `agent_end`.
    // See change: surface-mid-turn-prompt-queue.
    setSessionStates((prev) => {
      const next = new Map(prev);
      const current = next.get(selectedId);
      if (current?.pendingPrompt) {
        next.set(selectedId, { ...current, pendingPrompt: undefined });
      }
      return next;
    });
    send({ type: "abort", sessionId: selectedId });
  }, [selectedId, send, setSessionStates]);

  const handleForceKill = useCallback(() => {
    if (!selectedId) return;
    // Same rationale as handleAbort: force_kill nukes the pi process, so
    // any optimistic pendingPrompt is doubly defunct. Clear it client-
    // side so the optimistic card doesn't linger past the kill.
    setSessionStates((prev) => {
      const next = new Map(prev);
      const current = next.get(selectedId);
      if (current?.pendingPrompt) {
        next.set(selectedId, { ...current, pendingPrompt: undefined });
      }
      return next;
    });
    send({ type: "force_kill", sessionId: selectedId });
  }, [selectedId, send, setSessionStates]);

  // Graceful stop-after-turn: let the agent finish the current turn, then
  // shut the session down cleanly. Distinct from abort (mid-stream) and
  // force_kill (SIGKILL). See change: adopt-pi-071-072-073-features.
  const handleStopAfterTurn = useCallback(() => {
    if (!selectedId) return;
    send({ type: "stop_after_turn", sessionId: selectedId });
  }, [selectedId, send]);

  // ── Follow-up queue mutation (bridge-owned buffer) ──────────────────
  //
  // These five senders dispatch the wire messages defined in
  // browser-protocol.ts. The bridge mutates `bridgeFollowUp` locally; pi
  // is not involved. Steer mutation is intentionally NOT exposed (steer
  // drains too fast for it to matter; user direction).
  //
  // See change: rework-mid-turn-prompt-queue.

  const removeFollowUpEntry = useCallback((index: number) => {
    if (!selectedId) return;
    send({ type: "remove_followup_entry", sessionId: selectedId, index });
  }, [selectedId, send]);

  const editFollowUpEntry = useCallback((index: number, text: string, images?: ImageContent[]) => {
    if (!selectedId) return;
    send({ type: "edit_followup_entry", sessionId: selectedId, index, text, images });
  }, [selectedId, send]);

  const promoteFollowUpEntry = useCallback((index: number) => {
    if (!selectedId) return;
    send({ type: "promote_followup_entry", sessionId: selectedId, index });
  }, [selectedId, send]);

  const clearFollowUpEntries = useCallback((indices: number[] | "all") => {
    if (!selectedId) return;
    send({ type: "clear_followup_entries", sessionId: selectedId, indices });
  }, [selectedId, send]);

  const handleCancelPending = useCallback(() => {
    if (selectedId) {
      setSessionStates((prev) => {
        const next = new Map(prev);
        const current = next.get(selectedId);
        if (current?.pendingPrompt) {
          next.set(selectedId, { ...current, pendingPrompt: undefined });
        }
        return next;
      });
      send({ type: "abort", sessionId: selectedId });
    }
  }, [selectedId, send, setSessionStates]);

  const handleRespondToUi = useCallback((requestId: string, result?: unknown, cancelled?: boolean) => {
    if (selectedId) {
      send({ type: "extension_ui_response", sessionId: selectedId, requestId, result, cancelled });
      // Also send via PromptBus protocol for new-style prompts.
      // Encoding precedence (multiselect-aware): see prompt-answer-encoder.ts.
      // Fix: change fix-multiselect-auto-cancel-on-dashboard.
      const answer = encodePromptAnswer(result, cancelled);
      // Standalone method:"input" carries pasted images that cannot fit in
      // the string `answer`; lift them onto the message. Batch images ride
      // inside `answer` (JSON answers) and are not duplicated here.
      // See change: add-ask-user-input-multiline-paste.
      const images =
        result && typeof result === "object" && Array.isArray((result as any).images)
          ? (result as any).images
          : undefined;
      send({ type: "prompt_response", sessionId: selectedId, promptId: requestId, answer, cancelled, source: "dashboard-default", images } as any);
      setSessionStates((prev) => {
        const next = new Map(prev);
        const current = next.get(selectedId);
        if (current) {
          next.set(selectedId, resolveInteractiveRequest(current, requestId, result, cancelled));
        }
        return next;
      });
      setSessions((prev) => {
        const next = new Map(prev);
        const session = next.get(selectedId);
        if (session?.currentTool === "ask_user") {
          next.set(selectedId, { ...session, currentTool: undefined });
        }
        return next;
      });
    }
  }, [selectedId, send, setSessionStates, setSessions]);

  const handleFlowAction = useCallback((sessionId: string, action: string, opts?: { flowName?: string; task?: string; description?: string }) => {
    send({
      type: "flow_management",
      sessionId,
      action,
      flowName: opts?.flowName,
      task: opts?.task,
      description: opts?.description,
    });
  }, [send]);

  const handleSend = useCallback((text: string, images?: ImageContent[], delivery?: "steer" | "followUp") => {
    if (selectedId) {
      // Send and let pi's queue_update event populate authoritative chip state
      // via `Session.pendingQueues`. No optimistic local pendingPrompt write.
      // See change: add-followup-edit-and-steer-cancel.
      send({ type: "send_prompt", sessionId: selectedId, text, images, delivery });
    }
  }, [selectedId, send]);

  const handleSelect = useCallback((id: string) => {
    navigate(`/session/${id}`);
    setMobileOpen(false);
  }, [navigate, setMobileOpen]);

  const handleRenameSession = useCallback((sessionId: string, name: string) => {
    send({ type: "rename_session", sessionId, name });
  }, [send]);

  const handleShutdownSession = useCallback((sessionId: string) => {
    // Optimistically flip the transient `closing` flag so the card can render
    // a closing state (dim + spinner + disabled ✕) immediately, instead of
    // sitting visually identical until `session_removed` lands 2-4s later.
    // Mirrors handleResumeSession's optimistic `resuming` flip.
    setSessions((prev) => {
      const next = new Map(prev);
      const existing = next.get(sessionId);
      if (existing) next.set(sessionId, { ...existing, closing: true });
      return next;
    });
    send({ type: "shutdown", sessionId });
    // Safety revert: the normal path never reaches this — `session_removed`
    // removes the card first. But if that broadcast never arrives, clear
    // `closing` after a bounded timeout so the card can't spin forever and
    // the user can retry.
    setTimeout(() => {
      setSessions((prev) => {
        const existing = prev.get(sessionId);
        if (!existing || !existing.closing) return prev;
        const next = new Map(prev);
        next.set(sessionId, { ...existing, closing: false });
        return next;
      });
    }, 10_000);
  }, [send, setSessions]);

  const handleKillProcess = useCallback((sessionId: string, pgid: number) => {
    send({ type: "kill_process", sessionId, pgid });
  }, [send]);

  const handleSendPromptToSession = useCallback(
    (sessionId: string, text: string, images?: ImageContent[]) => {
      send({ type: "send_prompt", sessionId, text, images });
    },
    [send],
  );

  const handleResumeSession = useCallback((sessionId: string, mode: "continue" | "fork", entryId?: string) => {
    setSessions((prev) => {
      const next = new Map(prev);
      const existing = next.get(sessionId);
      if (existing) next.set(sessionId, { ...existing, resuming: true });
      return next;
    });
    // Mint requestId so session_added (for fork mode) carries spawnRequestId
    // and the client can auto-select the new fork. cwd is left empty here
    // because resume's parent-session lookup happens server-side; we only
    // need requestId for the eventual session_added match.
    // See change: spawn-correlation-token.
    const requestId = mintRequestId();
    pendingSpawnsRef.current.set(requestId, { cwd: "", kind: "resume" });
    // Explicit "front" placement: matches today's default but makes the
    // intent visible at the wire level. See change:
    // differentiate-resume-intent-by-trigger.
    send({ type: "resume_session", sessionId, mode, placement: "front", requestId, ...(entryId ? { entryId } : {}) });
  }, [send, setSessions, pendingSpawnsRef]);

  /**
   * Drag-to-resume entry point. The drop position was just persisted via
   * `reorder_sessions`, so the resume MUST NOT clobber it — send placement
   * "keep" so the server's ended→alive branch leaves sessionOrder alone.
   * See change: differentiate-resume-intent-by-trigger.
   */
  const handleResumeSessionKeepPosition = useCallback((sessionId: string) => {
    setSessions((prev) => {
      const next = new Map(prev);
      const existing = next.get(sessionId);
      if (existing) next.set(sessionId, { ...existing, resuming: true });
      return next;
    });
    const requestId = mintRequestId();
    pendingSpawnsRef.current.set(requestId, { cwd: "", kind: "resume" });
    send({ type: "resume_session", sessionId, mode: "continue", placement: "keep", requestId });
  }, [send, setSessions, pendingSpawnsRef]);

  const handleSpawnSession = useCallback((
    cwd: string,
    attachProposal?: string,
    opts?: { gitWorktreeBase?: string; placeholderCwd?: string },
  ) => {
    // The placeholder/disabled-button group cwd. For a normal spawn this is
    // the spawn cwd; for a worktree spawn the host passes the PARENT repo
    // cwd (the group that will host the new session per the grouping
    // precedence). See change: add-worktree-spawn-placeholder-card.
    const placeholderCwd = opts?.placeholderCwd ?? cwd;
    setSpawningCwds((prev) => {
      if (prev.has(placeholderCwd)) return prev;
      const next = new Set(prev);
      next.add(placeholderCwd);
      return next;
    });
    // Guard against a double timeout: for worktree spawns `onSpawnStart`
    // already armed one for this group cwd. Only arm when none exists so a
    // single timer governs the whole in-flight window.
    if (!spawnTimeoutsRef.current.has(placeholderCwd)) {
      const timer = setTimeout(() => {
        spawnTimeoutsRef.current.delete(placeholderCwd);
        clearSpawningCwd(placeholderCwd);
      }, 30_000);
      spawnTimeoutsRef.current.set(placeholderCwd, timer);
    }
    // Mint requestId for exact auto-select correlation when session_added
    // arrives. See change: spawn-correlation-token. The entry carries
    // `placeholderCwd` so the clear keys on the group cwd, not the worktree
    // path. See change: add-worktree-spawn-placeholder-card.
    const requestId = mintRequestId();
    pendingSpawnsRef.current.set(requestId, { cwd, kind: "spawn", placeholderCwd });
    // The optional `attachProposal` field is consumed server-side and applied
    // when the bridge issues `session_register`. See change:
    // add-folder-task-checker-and-spawn-attach.
    // The optional `gitWorktreeBase` is similarly server-consumed and
    // written to `.meta.json` on register so the WORKSPACE-subcard pill
    // can render `created from <base>` later. See change:
    // add-worktree-spawn-dialog.
    send({
      type: "spawn_session",
      cwd,
      requestId,
      ...(attachProposal ? { attachProposal } : {}),
      ...(opts?.gitWorktreeBase ? { gitWorktreeBase: opts.gitWorktreeBase } : {}),
    });
  }, [send, clearSpawningCwd, setSpawningCwds, spawnTimeoutsRef, pendingSpawnsRef]);

  const handleHideSession = useCallback((sessionId: string) => {
    setSessions((prev) => {
      const next = new Map(prev);
      const existing = next.get(sessionId);
      if (existing) next.set(sessionId, { ...existing, hidden: true });
      return next;
    });
    send({ type: "hide_session", sessionId });
  }, [send, setSessions]);

  const handleUnhideSession = useCallback((sessionId: string) => {
    setSessions((prev) => {
      const next = new Map(prev);
      const existing = next.get(sessionId);
      if (existing) next.set(sessionId, { ...existing, hidden: false });
      return next;
    });
    send({ type: "unhide_session", sessionId });
  }, [send, setSessions]);

  const handleCreateTerminal = useCallback((cwd: string) => {
    pendingTerminalCwdRef.current = cwd;
    send({ type: "create_terminal", cwd });
  }, [send, pendingTerminalCwdRef]);

  const handleKillTerminal = useCallback((terminalId: string) => {
    send({ type: "kill_terminal", terminalId });
  }, [send]);

  // Inline interactive terminal card lifecycle. Open spawns an ephemeral PTY
  // and writes inline_terminal_open into the session chat stream; close
  // captures the transcript and writes inline_terminal_close.
  // See change: add-inline-terminal-card.
  const handleOpenInlineTerminal = useCallback((sessionId: string, cwd: string) => {
    send({ type: "open_inline_terminal", sessionId, cwd });
  }, [send]);

  const handleCloseInlineTerminal = useCallback((sessionId: string, terminalId: string) => {
    send({ type: "close_inline_terminal", sessionId, terminalId });
  }, [send]);

  const handleRenameTerminal = useCallback((terminalId: string, title: string) => {
    setTerminals((prev) => {
      const next = new Map(prev);
      const existing = next.get(terminalId);
      if (existing) next.set(terminalId, { ...existing, title, manuallyRenamed: true });
      return next;
    });
    send({ type: "rename_terminal", terminalId, title });
  }, [send, setTerminals]);

  const handleTerminalTitle = useCallback((terminalId: string, title: string) => {
    setTerminals((prev) => {
      const existing = prev.get(terminalId);
      if (!existing || existing.manuallyRenamed) return prev;
      const next = new Map(prev);
      next.set(terminalId, { ...existing, title });
      return next;
    });
    const t = terminals.get(terminalId);
    if (!t?.manuallyRenamed) {
      send({ type: "rename_terminal", terminalId, title });
    }
  }, [send, terminals, setTerminals]);

  const handleListFiles = useCallback((query: string) => {
    if (selectedId) send({ type: "list_files", sessionId: selectedId, query });
  }, [selectedId, send]);

  return {
    handleAbort, handleForceKill, handleStopAfterTurn, handleCancelPending, handleRespondToUi, handleFlowAction, handleSend,
    handleSelect, handleRenameSession, handleShutdownSession, handleKillProcess,
    handleSendPromptToSession, handleResumeSession, handleResumeSessionKeepPosition, handleSpawnSession,
    handleHideSession, handleUnhideSession,
    handleCreateTerminal, handleKillTerminal, handleRenameTerminal, handleTerminalTitle,
    handleOpenInlineTerminal, handleCloseInlineTerminal,
    handleListFiles,
    // Bridge-owned follow-up buffer mutation senders. See change: rework-mid-turn-prompt-queue.
    removeFollowUpEntry, editFollowUpEntry, promoteFollowUpEntry, clearFollowUpEntries,
  };
}
