/**
 * Start profiles (design D4 "Start profiles"): a later change registers `registerStartProfile(name, …)` for
 * the template of the same name. `preflight` runs inside `team.start` before `createTeam` or any spawn (a
 * failure returns its typed code and creates nothing); `seed` runs once after the lead binds and before the
 * first eager member spawns. Process-wide, like the bundled template registry.
 * See change: add-agent-teams-templates-hooks.
 */
import type { Team } from "../shared/types.js";

/** @public A refusal with a typed code (a later change's own code is allowed: it is passed through verbatim). */
export interface StartRefusal {
  ok: false;
  error: string;
  message?: string;
  details?: Record<string, unknown>;
}

/** @public */
export interface StartProfile {
  /** Validate the goal / cwd before anything exists; `{ok:false, error}` aborts the start. */
  preflight(goal: string, cwd: string): { ok: true } | StartRefusal | Promise<{ ok: true } | StartRefusal>;
  /** Pre-author tasks / state once (use `ops.createTask(team, …, {actor:"server"})`: it never runs hooks). */
  seed(team: Team): void | Promise<void>;
}

const profiles = new Map<string, StartProfile>();

/** Register the profile of template `name`; returns a disposer. A second registration replaces the first. */
export function registerStartProfile(name: string, profile: StartProfile): () => void {
  profiles.set(name, profile);
  return () => {
    if (profiles.get(name) === profile) profiles.delete(name);
  };
}

export function getStartProfile(name: string): StartProfile | undefined {
  return profiles.get(name);
}
