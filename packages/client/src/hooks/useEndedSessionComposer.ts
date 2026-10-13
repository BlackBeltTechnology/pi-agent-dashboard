/**
 * Composer context for an ENDED session, which has no live bridge to ask.
 *
 * - **Commands:** the folder command list for the session's cwd. Once the
 *   session resumes, its own `commands_list` replaces it — but the folder list
 *   is kept until then (`folderListSessions` remembers who showed it), so the
 *   `/` popover never flashes empty across the resume.
 * - **Models:** the global catalogue (only fetched while the session is ended).
 * - **Picks:** a model / thinking level chosen in the composer, per session and
 *   per field. Sent on the resuming `send_prompt` / `resume_session` (continue);
 *   dropped as soon as the session is no longer ended (live again, or gone).
 *   Client-only: a reload forgets it, and the resume simply keeps the old model.
 *
 * See change: redesign-directory-home-split (design D9).
 */
import type { CommandInfo, ModelInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FolderCommandOrigin } from "../lib/api/folder-commands-api.js";
import { useFolderCommands } from "./useFolderCommands.js";
import { useModelCatalogue } from "./useModelCatalogue.js";

export interface ResumePick {
  model?: string;
  thinkingLevel?: string;
}

interface Input {
  selectedId: string | undefined;
  selectedSession: { status: string; cwd: string } | undefined;
  /** The session has received its own `commands_list`. */
  hasOwnCommands: boolean;
  /** Every known session, to drop picks of sessions that are live again. */
  sessions: Map<string, { status: string }>;
}

export interface EndedSessionComposer {
  isEnded: boolean;
  /** Folder list to offer instead of the session's own; `undefined` when not applicable. */
  folderCommands: { commands: CommandInfo[]; origin: FolderCommandOrigin } | undefined;
  /** Global catalogue (empty unless the selected session is ended). */
  models: ModelInfo[];
  /** The pending pick of the SELECTED session, if any. */
  pick: ResumePick | undefined;
  /** Stable lookup for any session id (read by the send/resume actions). */
  getResumePick: (sessionId: string) => ResumePick | undefined;
  setPickField: (sessionId: string, field: keyof ResumePick, value: string) => void;
  /** Drop ONE field of a session's pick (a `set_model` / `set_thinking_level` for it). */
  clearPickField: (sessionId: string, field: keyof ResumePick) => void;
}

export function useEndedSessionComposer({ selectedId, selectedSession, hasOwnCommands, sessions }: Input): EndedSessionComposer {
  const isEnded = selectedSession?.status === "ended";

  const folderListSessions = useRef<Set<string>>(new Set());
  if (selectedId && isEnded && !hasOwnCommands) folderListSessions.current.add(selectedId);
  const folderCwd =
    selectedId && selectedSession && !hasOwnCommands && folderListSessions.current.has(selectedId)
      ? selectedSession.cwd
      : undefined;
  const folder = useFolderCommands(folderCwd);
  const catalogue = useModelCatalogue({ enabled: isEnded, seedFromCache: true });

  const [picks, setPicks] = useState<Map<string, ResumePick>>(new Map());
  const picksRef = useRef(picks);
  picksRef.current = picks;
  const getResumePick = useCallback((sessionId: string) => picksRef.current.get(sessionId), []);

  useEffect(() => {
    setPicks((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Map(prev);
      for (const id of prev.keys()) {
        if (sessions.get(id)?.status !== "ended") {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [sessions]);

  const setPickField = useCallback((sessionId: string, field: keyof ResumePick, value: string) => {
    setPicks((prev) => {
      const next = new Map(prev);
      next.set(sessionId, { ...(prev.get(sessionId) ?? {}), [field]: value });
      return next;
    });
  }, []);

  const clearPickField = useCallback((sessionId: string, field: keyof ResumePick) => {
    setPicks((prev) => {
      const current = prev.get(sessionId);
      if (!current || current[field] === undefined) return prev;
      const next = new Map(prev);
      const { [field]: _dropped, ...rest } = current;
      if (Object.keys(rest).length === 0) next.delete(sessionId);
      else next.set(sessionId, rest);
      return next;
    });
  }, []);

  return {
    isEnded,
    folderCommands: folderCwd ? folder : undefined,
    models: isEnded ? catalogue.models : [],
    pick: selectedId ? picks.get(selectedId) : undefined,
    getResumePick,
    setPickField,
    clearPickField,
  };
}
