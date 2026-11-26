/**
 * Fake host members the UI bridge drives: `broadcastToSubscribers` (recorded
 * frames) and `assignSessionRef`, which keeps a per-session plugin bag with the
 * host's merge semantics (`packages/server/src/session/plugin-refs.ts`: a key is
 * written, an `undefined` value deletes it, the bag must be JSON-plain; the
 * session top level is the flattened bag), so a stamp is judged by what the
 * session list would carry, including the JSON round trip. `state.result` scripts
 * the return value (`false` = untrusted/unknown session, `"throw"`), `state.known`
 * limits the sessions the host knows.
 * See change: add-agent-teams-ui.
 */

interface RecordedAssign {
  sessionId: string;
  ref: Record<string, unknown>;
  opts: { persist?: boolean } | undefined;
}

export function createFakeUiHost() {
  const frames: Array<Record<string, any>> = [];
  const assigns: RecordedAssign[] = [];
  const bags = new Map<string, Record<string, unknown>>();
  const state = { result: true as boolean | "throw", broadcastThrows: false, known: undefined as Set<string> | undefined };
  const host = {
    broadcastToSubscribers(msg: unknown): void {
      if (state.broadcastThrows) throw new Error("broadcast boom");
      frames.push(msg as Record<string, any>);
    },
    assignSessionRef(sessionId: string, ref: Record<string, unknown | undefined>, opts?: { persist?: boolean }): boolean {
      assigns.push({ sessionId, ref: ref as Record<string, unknown>, opts });
      if (state.result === "throw") throw new Error("assign boom");
      if (state.result === false || (state.known && !state.known.has(sessionId))) return false;
      const bag = { ...(bags.get(sessionId) ?? {}) };
      for (const [k, v] of Object.entries(ref)) {
        if (v === undefined) delete bag[k];
        else bag[k] = v;
      }
      bags.set(sessionId, bag);
      return true;
    },
  };
  return {
    host,
    frames,
    assigns,
    state,
    /** Top-level session projection the shell would receive for `sessionId` (what `session_updated` carries, before JSON). */
    projection: (sessionId: string): Record<string, unknown> => ({ ...(bags.get(sessionId) ?? {}) }),
    /** The `agent-teams-lead` stamp as the client predicate sees it after a JSON round trip. */
    stampOf(sessionId: string): unknown {
      const wire = JSON.parse(JSON.stringify({ ...(bags.get(sessionId) ?? {}) })) as Record<string, any>;
      return wire["agent-teams-lead"];
    },
  };
}

export type FakeUiHost = ReturnType<typeof createFakeUiHost>;
