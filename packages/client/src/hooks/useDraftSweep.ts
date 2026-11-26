/**
 * State-driven prompt-draft clearing. A draft lives while its request is
 * `pending`; once the request is answered, cancelled, dismissed, or its session
 * ended, the draft is dropped — whether or not a renderer is mounted (covers an
 * answer given in the terminal while another session was selected). Driven from
 * STATE, not the answer click, so a failed delivery keeps the draft.
 *
 * Runs on every `sessionStates` change (each streamed event), so it only acts on
 * non-pending requests that actually hold a draft (`hasPromptDraft`): no storage
 * write per event for the many resolved requests that never had one.
 * See change: fix-input-state-consistency (#1117).
 */
import { useEffect } from "react";
import type { SessionState } from "../lib/chat/event-reducer.js";
import { deletePromptDraft, hasPromptDraft } from "../lib/state/prompt-draft-storage.js";

type SessionStates = ReadonlyMap<string, Pick<SessionState, "interactiveRequests"> & Partial<Pick<SessionState, "status">>>;

export function sweepPromptDrafts(sessionStates: SessionStates): void {
  for (const [sessionId, state] of sessionStates) {
    // `session_removed` keeps the row as `ended` WITHOUT flipping its requests: an
    // ended session can never be answered, so every request of it counts as done.
    const ended = state.status === "ended";
    for (const request of state.interactiveRequests) {
      if ((ended || request.status !== "pending") && hasPromptDraft(sessionId, request.requestId)) {
        deletePromptDraft(sessionId, request.requestId);
      }
    }
  }
}

export function useDraftSweep(sessionStates: SessionStates): void {
  useEffect(() => {
    sweepPromptDrafts(sessionStates);
  }, [sessionStates]);
}
