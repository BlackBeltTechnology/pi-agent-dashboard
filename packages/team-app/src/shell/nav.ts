import { useCallback } from "react";
import { useLocation } from "wouter";
import type { Target } from "../api/types.js";

export const withProject = (path: string, t: Target, extra = ""): string =>
  `${path}${path.includes("?") ? "&" : "?"}project=${encodeURIComponent(t)}${extra}`;

export const agentPath = (key: string, c?: string): string => `/agent/${encodeURIComponent(key)}${c ? `/c/${c}` : ""}`;

/** Navigation helpers relative to the app's router base. */
export function useNav() {
  const [, navigate] = useLocation();
  return {
    navigate,
    toGrid: useCallback((t: Target) => navigate(withProject("/", t)), [navigate]),
    toAgent: useCallback((key: string, t: Target, c?: string) => navigate(withProject(agentPath(key, c), t)), [navigate]),
    toEditor: useCallback((t: Target, key?: string, fork?: string) => {
      const path = key ? `/personas/${encodeURIComponent(key)}` : "/personas/new";
      navigate(withProject(path, t, fork ? `&fork=${encodeURIComponent(fork)}` : ""));
    }, [navigate]),
    toSkills: useCallback((t: Target) => navigate(withProject("/skills", t)), [navigate]),
    toSkill: useCallback((t: Target, name: string) => navigate(withProject(`/skills/${encodeURIComponent(name)}`, t)), [navigate]),
  };
}
