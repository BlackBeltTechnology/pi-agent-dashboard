/**
 * In-memory `HostSeam` — lets the orchestrator be tested with no dashboard, no
 * pi session and no network. Records every session-affecting call so a test can
 * assert what did (and did NOT) reach a session.
 *
 * See change: add-chat-gateway.
 */
import type { HostSeam, SeamSpawnOptions, SeamSession, SpawnOutcome } from "../seam.js";

export interface FakeSeam extends HostSeam {
  /** Live sessions returned by listSessions(). */
  sessions: SeamSession[];
  /** Prompts that reached a session (must be EMPTY for a refused message). */
  sentPrompts: Array<{ sessionId: string; text: string; delivery: "followUp" | "steer" }>;
  sentResponses: Array<{ sessionId: string; response: Record<string, unknown> }>;
  spawns: SeamSpawnOptions[];
  spawnResult: SpawnOutcome;
  frameHandlers: Map<string, (frame: unknown) => void>;
  /** Deliver a browser-protocol frame as the host would. */
  emitFrame(sessionId: string, frame: unknown): void;
  /** Resolve a spawn as the host would on session_register. */
  resolveSpawn(sessionId: string, pluginRef: Record<string, unknown>): void;
}

export function createFakeSeam(): FakeSeam {
  let tokenSeq = 0;
  const frameHandlers = new Map<string, (frame: unknown) => void>();
  const resolvedHandlers: Array<(id: string, ref: Record<string, unknown>) => void> = [];

  const seam: FakeSeam = {
    sessions: [],
    sentPrompts: [],
    sentResponses: [],
    spawns: [],
    spawnResult: { success: true },
    frameHandlers,
    hasFrameSeam: () => true,
    subscribe(sessionId, handler) {
      frameHandlers.set(sessionId, handler);
      return () => frameHandlers.delete(sessionId);
    },
    sendPrompt(sessionId, text, delivery) {
      if (!seam.sessions.some((s) => s.id === sessionId)) return false;
      seam.sentPrompts.push({ sessionId, text, delivery });
      return true;
    },
    sendPromptResponse(sessionId, response) {
      seam.sentResponses.push({ sessionId, response });
      return true;
    },
    abort: () => false,
    async spawn(opts) {
      seam.spawns.push(opts);
      return seam.spawnResult;
    },
    listSessions: () => seam.sessions,
    mintSpawnToken: () => `tok-${++tokenSeq}`,
    onSessionResolved(handler) {
      resolvedHandlers.push(handler);
      return () => {
        const i = resolvedHandlers.indexOf(handler);
        if (i >= 0) resolvedHandlers.splice(i, 1);
      };
    },
    log: () => {},
    emitFrame(sessionId, frame) {
      frameHandlers.get(sessionId)?.(frame);
    },
    resolveSpawn(sessionId, pluginRef) {
      for (const h of resolvedHandlers) h(sessionId, pluginRef);
    },
  };
  return seam;
}
