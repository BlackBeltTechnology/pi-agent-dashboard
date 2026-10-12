/**
 * Skill-atlas wire + builder types. Pure — no runtime imports.
 * See change: add-skill-atlas-screen (design D2, D8).
 */

/** Where a skill comes from. `project` = the folder's `.pi/skills`. */
export type SkillOrigin = "project" | "global" | "package";

/** Relation kinds. Open-ended by design (design D2 / Q6). */
export type SkillLinkType = "references" | "bundle" | "shares-tool";

/** Atlas scope requested from the server. */
export type SkillAtlasScope = "project" | "global";

/** One builder input row. `id` = frontmatter `name`; `pkg` undefined for loose skills. */
export interface SkillGraphInput {
  id: string;
  description: string;
  filePath: string;
  origin: SkillOrigin;
  pkg?: string;
  body: string;
}

export interface SkillNode {
  id: string;
  description: string;
  filePath: string;
  origin: SkillOrigin;
  pkg?: string;
  /** Number of links touching this node. */
  degree: number;
}

export interface SkillLink {
  source: string;
  target: string;
  type: SkillLinkType;
  /** Human-readable reason. */
  why: string;
}

export interface SkillGraph {
  skills: SkillNode[];
  links: SkillLink[];
}

/** `GET /api/plugins/skill-atlas/graph` payload. */
export interface SkillGraphResponse extends SkillGraph {
  scope: SkillAtlasScope;
  cwd?: string;
  fingerprint: string;
  builtAt: number;
  degraded: boolean;
  warnings: string[];
}

/** WS broadcast sent when an atlas's graph changed. */
export interface SkillAtlasChangedMessage {
  type: "skill_atlas_changed";
  scope: SkillAtlasScope;
  cwd?: string;
}

export const SKILL_ATLAS_CHANGED = "skill_atlas_changed" as const;
/** Graph view disabled above this node count (spec "Atlas views"). */
export const GRAPH_NODE_CAP = 300;
/** SKILL.md bytes considered per skill (spec "Graph stays fresh"). */
export const BODY_BYTE_LIMIT = 256 * 1024;
