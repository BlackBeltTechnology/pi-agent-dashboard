/**
 * React bindings of the teams store: `useSyncExternalStore` over stable entry
 * references (an unchanged snapshot — the 304 path — causes no re-render).
 * See change: add-agent-teams-ui (task 7.1).
 */
import { useSyncExternalStore } from "react";
import { type LookupEntry, type TeamEntry, type TeamsStore, teamsStore } from "./teams-store.js";

/** Cache entry of a team, `undefined` until the store was asked for it. */
export function useTeamEntry(teamId: string | null | undefined, store: TeamsStore = teamsStore): TeamEntry | undefined {
  return useSyncExternalStore(
    store.subscribe,
    () => (teamId ? store.getTeam(teamId) : undefined),
    () => undefined,
  );
}

/** Session → team lookup state (`teamId: null` = the session has no visible team). */
export function useSessionLookup(sessionId: string, store: TeamsStore = teamsStore): LookupEntry | undefined {
  return useSyncExternalStore(
    store.subscribe,
    () => store.getLookup(sessionId),
    () => undefined,
  );
}
