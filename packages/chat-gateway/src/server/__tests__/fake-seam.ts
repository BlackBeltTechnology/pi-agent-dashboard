/**
 * In-memory `HostSeam` — lets the orchestrator be tested with no dashboard, no
 * pi session and no network. Records every session-affecting call so a test can
 * assert what did (and did NOT) reach a session.
 *
 * See change: add-chat-gateway.
 */
import type { HostSeam, SeamSession, SeamSpawnOptions, SpawnOutcome } from "../seam.js";

/**
 * Copy of `CORE_RESERVED_REF_KEYS` in
 * `packages/server/src/pending/pending-plugin-ref-registry.ts` (chat-gateway
 * does not depend on the server package). Keep in sync.
 */
const CORE_RESERVED_REF_KEYS: ReadonlySet<string> = new Set([
  "sessionId",
  "cwd",
  "source",
  "status",
  "closedReason",
  "live",
  "liveEpoch",
  "recover",
  "finalizeOnSocketClose",
  "spawnToken",
  "sessionFile",
  "startedAt",
  "endedAt",
  "name",
  "nameSource",
  "pluginRefs",
]);

export interface FakeSeam extends HostSeam {
  /** Live sessions returned by listSessions(). */
  sessions: SeamSession[];
  /** Ended (resumable) sessions returned by getSession() only. */
  endedSessions: SeamSession[];
  /** Prompts that reached a session (must be EMPTY for a refused message). */
  sentPrompts: Array<{ sessionId: string; text: string; delivery: "followUp" | "steer" }>;
  sentResponses: Array<{ sessionId: string; response: Record<string, unknown> }>;
  spawns: SeamSpawnOptions[];
  spawnResult: SpawnOutcome;
  /** Allowlists persisted via a pairing redemption (empty until one happens). */
  persistedAllowlists: string[][];
  /** Provenance refs merged onto sessions. */
  assignedRefs: Array<{ sessionId: string; ref: Record<string, unknown> }>;
  /**
   * What `assignSessionRef` returns. `false` models an UNTRUSTED host, where a
   * trusted-gated verb is the host's no-op (test-plan #X10).
   */
  assignRefResult: boolean;
  frameHandlers: Map<string, (frame: unknown) => void>;
  /** Deliver a browser-protocol frame as the host would. */
  emitFrame(sessionId: string, frame: unknown): void;
  /** Resolve a spawn as the host would on session_register. */
  resolveSpawn(sessionId: string, pluginRef: Record<string, unknown>): void;
  /** Forward one session event as the host's `onEvent` stream would. */
  emitSessionEvent(sessionId: string): void;
}

export function createFakeSeam(): FakeSeam {
  let tokenSeq = 0;
  const frameHandlers = new Map<string, (frame: unknown) => void>();
  const resolvedHandlers: Array<(id: string, ref: Record<string, unknown>) => void> = [];
  const eventHandlers: Array<(id: string) => void> = [];

  const seam: FakeSeam = {
    sessions: [],
    endedSessions: [],
    sentPrompts: [],
    sentResponses: [],
    spawns: [],
    spawnResult: { success: true },
    persistedAllowlists: [],
    assignedRefs: [],
    assignRefResult: true,
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
    getSession: (id) =>
      seam.sessions.find((s) => s.id === id) ?? seam.endedSessions.find((s) => s.id === id),
    mintSpawnToken: () => `tok-${++tokenSeq}`,
    assignSessionRef(sessionId, ref) {
      if (!seam.assignRefResult) return false;
      seam.assignedRefs.push({ sessionId, ref });
      return true;
    },
    persistAllowlist(ids) {
      seam.persistedAllowlists.push([...ids]);
    },
    onSessionEvent(handler) {
      eventHandlers.push(handler);
      return () => {
        const i = eventHandlers.indexOf(handler);
        if (i >= 0) eventHandlers.splice(i, 1);
      };
    },
    emitSessionEvent(sessionId) {
      for (const h of [...eventHandlers]) h(sessionId);
    },
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
      // Mirror the REAL host: the pending-ref registry drops core-reserved keys
      // before the owner is notified, so a plugin can only correlate through a
      // key it owns. Passing the raw ref here hid a production bug where the
      // gateway correlated on `spawnToken` (reserved) and never bound a spawn.
      const delivered = Object.fromEntries(
        Object.entries(pluginRef).filter(([k]) => !CORE_RESERVED_REF_KEYS.has(k)),
      );
      for (const h of resolvedHandlers) h(sessionId, delivered);
    },
  };
  return seam;
}
