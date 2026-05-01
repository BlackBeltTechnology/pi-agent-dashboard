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
  setSessions: React.Dispatch<React.SetStateAction<Map<string, DashboardSession>>>;
  setSessionStates: React.Dispatch<React.SetStateAction<Map<string, SessionState>>>;
  setSpawningCwds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setTerminals: React.Dispatch<React.SetStateAction<Map<string, TerminalSession>>>;
  clearSpawningCwd: (cwd: string) => void;
  spawnTimeoutsRef: React.MutableRefObject<Map<string, ReturnType<typeof setTimeout>>>;
  pendingTerminalCwdRef: React.MutableRefObject<string | null>;
  terminals: Map<string, TerminalSession>;
}

export function useSessionActions(deps: SessionActionDeps) {
  const {
    selectedId, send, navigate, setMobileOpen,
    setSessions, setSessionStates, setSpawningCwds, setTerminals,
    clearSpawningCwd, spawnTimeoutsRef, pendingTerminalCwdRef, terminals,
  } = deps;

  const handleAbort = useCallback(() => {
    if (selectedId) send({ type: "abort", sessionId: selectedId });
  }, [selectedId, send]);

  const handleForceKill = useCallback(() => {
    if (selectedId) send({ type: "force_kill", sessionId: selectedId });
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
      send({ type: "prompt_response", sessionId: selectedId, promptId: requestId, answer, cancelled, source: "dashboard-default" } as any);
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

  const handleSend = useCallback((text: string, images?: ImageContent[]) => {
    if (selectedId) {
      send({ type: "send_prompt", sessionId: selectedId, text, images });
      setSessionStates((prev) => {
        const next = new Map(prev);
        const current = next.get(selectedId) ?? createInitialState();
        next.set(selectedId, {
          ...current,
          pendingPrompt: {
            text,
            images: images?.map((img) => ({ data: img.data, mimeType: img.mimeType })),
          },
        });
        return next;
      });
    }
  }, [selectedId, send, setSessionStates]);

  const handleSelect = useCallback((id: string) => {
    navigate(`/session/${id}`);
    setMobileOpen(false);
  }, [navigate, setMobileOpen]);

  const handleRenameSession = useCallback((sessionId: string, name: string) => {
    send({ type: "rename_session", sessionId, name });
  }, [send]);

  const handleShutdownSession = useCallback((sessionId: string) => {
    send({ type: "shutdown", sessionId });
  }, [send]);

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
    // Explicit "front" placement: matches today's default but makes the
    // intent visible at the wire level. See change:
    // differentiate-resume-intent-by-trigger.
    send({ type: "resume_session", sessionId, mode, placement: "front", ...(entryId ? { entryId } : {}) });
  }, [send, setSessions]);

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
    send({ type: "resume_session", sessionId, mode: "continue", placement: "keep" });
  }, [send, setSessions]);

  const handleSpawnSession = useCallback((cwd: string, attachProposal?: string) => {
    setSpawningCwds((prev) => {
      const next = new Set(prev);
      next.add(cwd);
      return next;
    });
    const timer = setTimeout(() => {
      spawnTimeoutsRef.current.delete(cwd);
      clearSpawningCwd(cwd);
    }, 30_000);
    spawnTimeoutsRef.current.set(cwd, timer);
    // The optional `attachProposal` field is consumed server-side and applied
    // when the bridge issues `session_register`. See change:
    // add-folder-task-checker-and-spawn-attach.
    send({ type: "spawn_session", cwd, ...(attachProposal ? { attachProposal } : {}) });
  }, [send, clearSpawningCwd, setSpawningCwds, spawnTimeoutsRef]);

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
    handleAbort, handleForceKill, handleCancelPending, handleRespondToUi, handleFlowAction, handleSend,
    handleSelect, handleRenameSession, handleShutdownSession, handleKillProcess,
    handleSendPromptToSession, handleResumeSession, handleResumeSessionKeepPosition, handleSpawnSession,
    handleHideSession, handleUnhideSession,
    handleCreateTerminal, handleKillTerminal, handleRenameTerminal, handleTerminalTitle,
    handleListFiles,
  };
}
