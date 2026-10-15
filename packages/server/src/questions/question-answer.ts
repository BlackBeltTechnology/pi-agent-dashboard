/**
 * Answer transmission shared by the REST road and the browser `prompt_response`
 * road. One synchronous claim in the question store guarantees at most one user
 * answer is transmitted per question across every road; the claim is released
 * when transmission fails so the question can be answered again.
 * Transport-agnostic (no Fastify, no sockets): callers inject `send`.
 * See change: add-pending-question-stack (D8).
 */
import type { QuestionStore } from "./question-store.js";

/** Same contract as `PiGateway.sendToSession`: false = the bridge was not reachable. */
export type SendToSession = (sessionId: string, msg: Record<string, unknown>) => boolean;

/** `source` the dashboard chat stamps on its answers (the bridge defaults to the same). */
export const ANSWER_SOURCE = "dashboard-default";

export interface AnswerPayload {
  answer?: string;
  cancelled?: boolean;
}

/**
 * Send a claimed answer. `true` → hide the row (the registry entry stays until
 * the bridge's `prompt_dismiss` echo); `false` or a throw → release the claim.
 */
export function transmitClaimed(
  store: Pick<QuestionStore, "markTransmitted" | "releaseClaim">,
  claimId: string,
  send: () => boolean,
): boolean {
  let sent = false;
  try {
    sent = send();
  } finally {
    if (sent) store.markTransmitted(claimId);
    else store.releaseClaim(claimId);
  }
  return sent;
}

/**
 * Browser `prompt_response` gate. Returns whether the response was forwarded.
 * Untracked prompts (and file-access prompts, which are never claimed) proceed
 * exactly as before; a prompt another road already answered is dropped.
 */
export function relayBrowserPromptResponse(
  store: QuestionStore | undefined,
  msg: { sessionId: string; promptId: string },
  send: () => boolean,
): boolean {
  const claim = store?.claimPrompt(msg.sessionId, msg.promptId);
  if (!store || !claim || claim.status === "unknown") return send();
  if (claim.status === "answered") return false;
  return transmitClaimed(store, claim.id, send);
}
