/**
 * Agent event hub: the compact, transition-only feed behind
 * `GET /api/events/stream`, for an external controller (a Claude Code session
 * driving pi through the dashboard) that must REACT to a session instead of
 * polling it.
 *
 * Inputs are the two existing fan-outs: the browser gateway's registry frames
 * (`session_added` / `session_updated` / `session_removed`, tapped in its
 * `broadcast`) and the question store's `onChange`. Output is one event per
 * meaningful change: a status transition (deduped — a `session_updated` that
 * does not change `status` emits nothing), a question opened or closed (once
 * each; brief updates emit nothing), a session added or removed. Streaming
 * token/tool churn never reaches subscribers.
 *
 * Every event is delivered with the session's last known owner so the route
 * can apply the session-list visibility predicate, also after removal.
 * Transport-agnostic; holds no per-subscriber state.
 * See change: add-agent-event-stream.
 */
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { QuestionRow } from "@blackbelt-technology/pi-dashboard-shared/question-types.js";
import type { SessionStatus } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { QuestionChange } from "../questions/question-store.js";

type Owner = { iss: string; sub: string };

export type AgentEvent =
  | { type: "session_added"; sessionId: string; status?: SessionStatus; cwd?: string; name?: string }
  | { type: "status"; sessionId: string; from?: SessionStatus; to: SessionStatus }
  | { type: "session_removed"; sessionId: string }
  | { type: "question_opened"; sessionId: string; questionId: string; questionType: string; preview: string; sessionLabel: string }
  | { type: "question_closed"; sessionId: string; questionId: string; reason: "answered" | "removed" };

export type AgentEventType = AgentEvent["type"];

export const AGENT_EVENT_TYPES: readonly AgentEventType[] = ["session_added", "status", "session_removed", "question_opened", "question_closed"];

export type AgentEventListener = (event: AgentEvent, owner: Owner | undefined) => void;

export interface AgentEventHub {
  onRegistryFrame(msg: ServerToBrowserMessage): void;
  onQuestionChange(change: QuestionChange): void;
  /** Currently open questions, as `question_opened` events (initial frame for a new subscriber). */
  openQuestions(): Array<Extract<AgentEvent, { type: "question_opened" }>>;
  ownerOf(sessionId: string): Owner | undefined;
  subscribe(listener: AgentEventListener): () => void;
}

const openedOf = (row: QuestionRow): Extract<AgentEvent, { type: "question_opened" }> => ({
  type: "question_opened",
  sessionId: row.sessionId,
  questionId: row.id,
  questionType: row.type,
  preview: row.preview,
  sessionLabel: row.sessionLabel,
});

export function createAgentEventHub(deps: {
  listQuestionRows: () => QuestionRow[];
  /** Owner of a live session (fallback when no frame carried one). */
  ownerOf: (sessionId: string) => Owner | undefined;
}): AgentEventHub {
  const lastStatus = new Map<string, SessionStatus>();
  const lastOwner = new Map<string, Owner>();
  /** Questions announced as opened (dedupes a re-sent `added`). */
  const openIds = new Set<string>();
  /** Questions closed by a transmitted answer whose `removed` has not arrived yet. */
  const hiddenIds = new Set<string>();
  const listeners = new Set<AgentEventListener>();

  const ownerOf = (sessionId: string): Owner | undefined => deps.ownerOf(sessionId) ?? lastOwner.get(sessionId);

  function emit(event: AgentEvent): void {
    const owner = ownerOf(event.sessionId);
    for (const l of [...listeners]) {
      try {
        l(event, owner);
      } catch (err) {
        console.error("[agent-events] listener failed:", (err as Error).message);
      }
    }
  }

  function sessionAdded(s: Extract<ServerToBrowserMessage, { type: "session_added" }>["session"]): void {
    if (s.principalOwner) lastOwner.set(s.id, s.principalOwner);
    if (s.status) lastStatus.set(s.id, s.status);
    emit({
      type: "session_added",
      sessionId: s.id,
      ...(s.status ? { status: s.status } : {}),
      ...(s.cwd ? { cwd: s.cwd } : {}),
      ...(s.name ? { name: s.name } : {}),
    });
  }

  function sessionUpdated(sessionId: string, raw: unknown): void {
    const updates = (raw ?? {}) as { status?: unknown; principalOwner?: Owner };
    if (updates.principalOwner) lastOwner.set(sessionId, updates.principalOwner);
    if (typeof updates.status !== "string") return;
    const to = updates.status as SessionStatus;
    const from = lastStatus.get(sessionId);
    if (from === to) return;
    lastStatus.set(sessionId, to);
    emit({ type: "status", sessionId, ...(from ? { from } : {}), to });
  }

  function sessionRemoved(sessionId: string): void {
    emit({ type: "session_removed", sessionId });
    lastStatus.delete(sessionId);
    lastOwner.delete(sessionId);
  }

  function onRegistryFrame(msg: ServerToBrowserMessage): void {
    if (msg.type === "session_added") sessionAdded(msg.session);
    else if (msg.type === "session_updated") sessionUpdated(msg.sessionId, msg.updates);
    else if (msg.type === "session_removed") sessionRemoved(msg.sessionId);
  }

  function questionAdded(change: QuestionChange): void {
    if (openIds.has(change.id)) return;
    const row = deps.listQuestionRows().find((r) => r.id === change.id);
    if (!row) return;
    openIds.add(change.id);
    hiddenIds.delete(change.id);
    emit(openedOf(row));
  }

  function questionClosed(change: QuestionChange): void {
    openIds.delete(change.id);
    const answered = change.kind === "hidden";
    // A transmitted answer hides the question first; its later removal is the same close.
    if (hiddenIds.has(change.id)) {
      if (!answered) hiddenIds.delete(change.id);
      return;
    }
    if (answered) hiddenIds.add(change.id);
    // `hidden` = the answer was transmitted; a plain removal closed it unanswered.
    emit({ type: "question_closed", sessionId: change.sessionId, questionId: change.id, reason: answered ? "answered" : "removed" });
  }

  function onQuestionChange(change: QuestionChange): void {
    if (change.kind === "added") questionAdded(change);
    else if (change.kind === "hidden" || change.kind === "removed") questionClosed(change);
  }

  return {
    onRegistryFrame,
    onQuestionChange,
    openQuestions: () => deps.listQuestionRows().map(openedOf),
    ownerOf,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
