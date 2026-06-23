/**
 * `useJudgeModels()` — fetch the dashboard's known/favorite model labels for
 * the goal judge picker. One cold load on mount; failures degrade to an empty
 * list (the picker still offers "Extension default").
 *
 * See change: sophisticate-goal-authoring-and-control (task 4.2).
 */
import { useEffect, useState } from "react";
import { fetchJudgeModels } from "./goals-api.js";

export interface UseJudgeModelsResult {
  models: string[];
  loading: boolean;
}

export function useJudgeModels(): UseJudgeModelsResult {
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ac = new AbortController();
    fetchJudgeModels(ac.signal)
      .then((m) => setModels(m))
      .catch(() => { /* picker falls back to default-only */ })
      .finally(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => ac.abort();
  }, []);

  return { models, loading };
}
