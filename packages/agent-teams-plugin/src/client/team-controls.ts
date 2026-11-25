/**
 * Control state of the Team view (design D8; task 8.6): Stop member and Shut down
 * team POSTs through the store, with the per-control pending flag and the inline
 * outcome note. One note per control, never a toast; a rejected, timed-out or
 * unconfirmed POST re-enables the control (the store already refetched the truth
 * and never retries). The 404 of a vanished team needs no note: the store's refetch
 * turns the view into "not found".
 * See change: add-agent-teams-ui.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ControlResult, TeamsStore } from "./teams-store.js";

export type ControlNote = "forbidden" | "not_busy" | "not_connected" | "team_closed" | "no_response" | "unconfirmed" | "failed";

/** Key in the view's string table. */
export const noteKey = (note: ControlNote): string => `note.${note}`;

const REJECT_CODES: Readonly<Record<string, ControlNote>> = { not_busy: "not_busy", not_connected: "not_connected", team_closed: "team_closed" };

/** The inline note a result calls for (`undefined` = nothing to say). */
export function noteOf(result: ControlResult): ControlNote | undefined {
  switch (result.kind) {
    case "ok":
      return undefined;
    case "timeout":
      return "no_response";
    case "unconfirmed":
      return "unconfirmed";
    case "rejected":
      if (result.status === 403) return "forbidden";
      if (result.status === 404) return undefined;
      return (result.code !== undefined ? REJECT_CODES[result.code] : undefined) ?? "failed";
  }
}

export interface TeamControls {
  /** Members whose Stop POST is pending. */
  pendingStops: ReadonlySet<string>;
  shutdownPending: boolean;
  /** Last outcome note per member. */
  notes: Readonly<Record<string, ControlNote | undefined>>;
  shutdownNote: ControlNote | undefined;
  stop: (name: string) => void;
  /** Resolves after the POST settled (so the dialog flow can return focus). */
  shutdown: () => Promise<void>;
}

const NO_STOPS: ReadonlySet<string> = new Set();

export function useTeamControls(teamId: string | undefined, store: TeamsStore): TeamControls {
  const [pendingStops, setPendingStops] = useState<ReadonlySet<string>>(NO_STOPS);
  const [shutdownPending, setShutdownPending] = useState(false);
  const [notes, setNotes] = useState<Readonly<Record<string, ControlNote | undefined>>>({});
  const [shutdownNote, setShutdownNote] = useState<ControlNote | undefined>();
  const inflight = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // A different team starts clean.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `teamId` is the trigger — the reset must run when the team changes, not read it
  useEffect(() => {
    inflight.current.clear();
    setPendingStops(NO_STOPS);
    setShutdownPending(false);
    setNotes({});
    setShutdownNote(undefined);
  }, [teamId]);

  const stop = useCallback(
    (name: string): void => {
      if (!teamId || inflight.current.has(`stop:${name}`)) return;
      inflight.current.add(`stop:${name}`);
      setPendingStops((s) => new Set(s).add(name));
      setNotes((n) => ({ ...n, [name]: undefined }));
      void store.stopMember(teamId, name).then((result) => {
        inflight.current.delete(`stop:${name}`);
        if (!mounted.current) return;
        setPendingStops((s) => {
          const next = new Set(s);
          next.delete(name);
          return next;
        });
        setNotes((n) => ({ ...n, [name]: noteOf(result) }));
      });
    },
    [teamId, store],
  );

  const shutdown = useCallback(async (): Promise<void> => {
    if (!teamId || inflight.current.has("shutdown")) return;
    inflight.current.add("shutdown");
    setShutdownPending(true);
    setShutdownNote(undefined);
    const result = await store.shutdownTeam(teamId);
    inflight.current.delete("shutdown");
    if (!mounted.current) return;
    setShutdownPending(false);
    setShutdownNote(noteOf(result));
  }, [teamId, store]);

  return { pendingStops, shutdownPending, notes, shutdownNote, stop, shutdown };
}
