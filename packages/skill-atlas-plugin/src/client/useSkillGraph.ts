/**
 * `useSkillGraph(scope, cwd?)` — fetch the atlas graph and keep it live.
 * On a matching `skill_atlas_changed` broadcast it refetches while still
 * returning the previous graph (`updating: true`) until the new one arrives.
 * See change: add-skill-atlas-screen (design D9).
 */
import { usePluginMessage } from "@blackbelt-technology/dashboard-plugin-runtime";
import { useCallback, useEffect, useRef, useState } from "react";
import { SKILL_ATLAS_CHANGED, type SkillAtlasChangedMessage, type SkillAtlasScope, type SkillGraphResponse } from "../shared/types.js";
import { fetchSkillGraph } from "./atlas-api.js";

export interface UseSkillGraph {
  graph: SkillGraphResponse | null;
  loading: boolean;
  updating: boolean;
  error: string | null;
  refetch: () => void;
}

/** Strip trailing separators in linear time (a `/[\\/]+$/` regex is quadratic: CodeQL js/polynomial-redos). */
function norm(p?: string): string | undefined {
  if (!p) return p;
  let end = p.length;
  while (end > 1 && (p[end - 1] === "/" || p[end - 1] === "\\")) end--;
  return p.slice(0, end);
}

export function useSkillGraph(scope: SkillAtlasScope, cwd?: string): UseSkillGraph {
  const [graph, setGraph] = useState<SkillGraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(
    (background: boolean) => {
      const my = ++seq.current;
      if (background) setUpdating(true);
      else setLoading(true);
      fetchSkillGraph(scope, cwd)
        .then((g) => {
          if (my !== seq.current) return;
          setGraph(g);
          setError(null);
        })
        .catch((err: unknown) => {
          if (my !== seq.current) return;
          setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (my !== seq.current) return;
          setLoading(false);
          setUpdating(false);
        });
    },
    [scope, cwd],
  );

  useEffect(() => {
    setGraph(null);
    load(false);
  }, [load]);

  usePluginMessage<SkillAtlasChangedMessage>(SKILL_ATLAS_CHANGED, (msg) => {
    if (msg.scope !== scope) return;
    if (scope === "project" && norm(msg.cwd) !== norm(cwd)) return;
    load(true);
  });

  const refetch = useCallback(() => load(graph !== null), [load, graph]);
  return { graph, loading, updating, error, refetch };
}
