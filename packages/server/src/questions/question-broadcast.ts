/**
 * `questions_update` fan-out. Per-recipient: every socket gets only the rows
 * whose session it may see on the session list road (`canAccessSession`:
 * inert → everything; active → owner equality per item, ownerless hidden from
 * human principals). Rows only — never context bodies.
 *
 * Delivery policy (D7): adds and brief changes are coalesced into one frame
 * after a trailing 250 ms window (timer unref'd); removals and transmit-hides
 * flush at once, synchronously — except a change flagged `more` (a removal loop
 * in progress: session end, reconcile), which defers to the batch's last change,
 * so the loop sends ONE frame — and carry any pending add, cancelling the timer. Each frame is a FULL
 * replacement of the recipient's rows, deduplicated against what that socket
 * last received, so a recipient who may not see a question never gets a frame
 * that reveals it exists.
 * Transport-agnostic: the gateway supplies sockets, `send` and the principal /
 * owner lookups.
 * See change: add-pending-question-stack.
 */
import type { QuestionsUpdateMessage } from "@blackbelt-technology/pi-dashboard-shared/question-types.js";
import { canAccessSession } from "../identity/session-access.js";
import type { QuestionStore } from "./question-store.js";

export const QUESTIONS_DEBOUNCE_MS = 250;

type Owner = { iss: string; sub: string };

/** Build the per-recipient visibility predicate from the gateway's own lookups. */
export function createQuestionVisibility<S>(deps: {
  isResolverActive: () => boolean;
  principalOf: (socket: S) => Owner | null | undefined;
  ownerOf: (sessionId: string) => Owner | undefined;
}): (socket: S, sessionId: string) => boolean {
  return (socket, sessionId) =>
    canAccessSession({ active: deps.isResolverActive(), principal: deps.principalOf(socket), owner: deps.ownerOf(sessionId) });
}

export interface QuestionBroadcaster<S> {
  /** Send the recipient's current rows (initial frame on connect; always sent, even empty). */
  sendTo(socket: S): void;
  /** Recompute and deliver now (cancels a pending debounce). */
  flush(): void;
  dispose(): void;
}

export function createQuestionBroadcaster<S extends object>(deps: {
  store: Pick<QuestionStore, "listRows" | "onChange">;
  sockets: () => Iterable<S>;
  send: (socket: S, msg: QuestionsUpdateMessage) => void;
  canSee: (socket: S, sessionId: string) => boolean;
  debounceMs?: number;
}): QuestionBroadcaster<S> {
  const debounceMs = deps.debounceMs ?? QUESTIONS_DEBOUNCE_MS;
  const lastSent = new WeakMap<S, string>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  function build(socket: S): { msg: QuestionsUpdateMessage; serialized: string } {
    const msg: QuestionsUpdateMessage = { type: "questions_update", questions: deps.store.listRows((sid) => deps.canSee(socket, sid)) };
    return { msg, serialized: JSON.stringify(msg.questions) };
  }

  /** `onlyIfChanged`: skip when unchanged, and stay silent for a socket that never got a frame and sees nothing. */
  function deliver(socket: S, onlyIfChanged: boolean): void {
    try {
      const { msg, serialized } = build(socket);
      if (onlyIfChanged) {
        if (lastSent.has(socket) ? lastSent.get(socket) === serialized : msg.questions.length === 0) return;
      }
      lastSent.set(socket, serialized);
      deps.send(socket, msg);
    } catch (err) {
      console.error("[questions] questions_update delivery failed:", (err as Error).message);
    }
  }

  function flush(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    for (const socket of deps.sockets()) deliver(socket, true);
  }

  const unsubscribe = deps.store.onChange((change) => {
    if (change.kind === "removed" || change.kind === "hidden") {
      if (!change.more) flush(); // mid-batch: the batch's last change flushes once
      return;
    }
    if (timer === undefined) {
      timer = setTimeout(() => {
        timer = undefined;
        flush();
      }, debounceMs);
      timer.unref?.(); // a pending frame must never hold the process open
    }
  });

  return {
    sendTo: (socket) => deliver(socket, false),
    flush,
    dispose() {
      unsubscribe();
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}
