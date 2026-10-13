/**
 * Skill/prompt starter cards for the folder home's pre-session pane.
 *
 * Pure helpers: pick up to `MAX_STARTERS` cards from a folder command list
 * (folder-scope skills, then prompt templates, then global skills) and apply a
 * card's slash invocation to a draft. A card never sends.
 *
 * See change: redesign-directory-home-split (design D10).
 */
import type { CommandInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";

const MAX_STARTERS = 6;

export interface Starter {
  /** Stable key: the command name. */
  id: string;
  /** Command name as the composer knows it (`skill:foo` / `weekly-review`). */
  invocation: string;
  /** Same as `invocation`; kept separate so the label can diverge later. */
  invocationName: string;
  description?: string;
}

type Scoped = CommandInfo & { scope?: "folder" | "global" };

/** Folder-scope skills → prompts (any scope) → global skills, capped at six. */
export function buildStarters(commands: CommandInfo[]): Starter[] {
  const scoped = commands as Scoped[];
  const skills = scoped.filter((c) => c.source === "skill");
  const ordered = [
    ...skills.filter((c) => c.scope === "folder"),
    ...scoped.filter((c) => c.source === "prompt"),
    ...skills.filter((c) => c.scope !== "folder"),
  ];
  return ordered.slice(0, MAX_STARTERS).map((c) => ({
    id: c.name,
    invocation: c.name,
    invocationName: c.name,
    ...(c.description ? { description: c.description } : {}),
  }));
}

/**
 * Put `/<invocation> ` at the start of `draft`, REPLACING a leading slash token
 * when the draft already starts with one. Never touches the rest of the draft.
 */
export function withStarterInserted(draft: string, invocation: string): string {
  const head = `/${invocation}`;
  const leading = /^\/\S*/.exec(draft);
  if (leading) {
    const tail = draft.slice(leading[0].length);
    return tail === "" ? `${head} ` : `${head}${/^\s/.test(tail) ? tail : ` ${tail}`}`;
  }
  return `${head} ${draft}`;
}
