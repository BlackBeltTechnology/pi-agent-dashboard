/**
 * Effective target: the remembered selection, or — in an embedded folder view —
 * the project the host's folder matches (locked, D17).
 * See change: add-team-plugin.
 */
import { useEffect, useState } from "react";
import type { MatchResult, Target } from "../api/types.js";
import { useTeam } from "./team-store.js";

export interface EffectiveTarget {
  target: Target;
  /** Set when the host is a folder view: the selector is a locked chip. */
  locked: boolean;
  /** Folder view with no matching project. */
  folderUnmatched: boolean;
  folderName?: string;
  ready: boolean;
}

export function useEffectiveTarget(): EffectiveTarget & ReturnType<typeof useTeam> {
  const team = useTeam();
  const folder = team.host.folder;
  const [match, setMatch] = useState<MatchResult | null | undefined>(folder ? undefined : null);

  useEffect(() => {
    if (!folder || team.state.status !== "ready") return;
    let cancelled = false;
    team.api
      .match([folder.cwd])
      .then((r) => !cancelled && setMatch(r[0] ?? null))
      .catch(() => !cancelled && setMatch(null));
    return () => {
      cancelled = true;
    };
  }, [folder, team.state.status, team.api]);

  if (folder) {
    const project = match?.project;
    return {
      ...team,
      target: project ? project.id : team.target,
      locked: !!project,
      folderUnmatched: match === null || (match !== undefined && !match.project),
      folderName: project?.name,
      ready: team.state.status === "ready" && match !== undefined,
    };
  }
  return { ...team, locked: false, folderUnmatched: false, ready: team.state.status === "ready" };
}
