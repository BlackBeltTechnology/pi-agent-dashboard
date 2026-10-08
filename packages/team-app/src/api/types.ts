/** Wire types of `/api/plugins/team/*` (design D9). See change: add-team-plugin. */
export type Target = string; // project id or "_ws"
export const WORKSPACE: Target = "_ws";

export type AvatarSpec = { kind: "gallery"; id: string } | { kind: "initials" };
export type ToolsPreset = "chat" | "files" | "full";
type ConvStatus = "busy" | "running" | "sleeping";
type AgentStatus = ConvStatus | "new" | "retired" | "unavailable";

export interface Me {
  uk: string;
  iss: string;
  sub: string;
  admin: boolean;
  mode: "single" | "multi";
  maxConversations: number;
  skills: string[];
}

/** Catalog access scope (same shape as the server's `SkillUsers`/`SkillTargets`). */
export type SkillUsers = "*" | { iss: string; sub: string }[];
export type SkillTargets = "*" | string[];
export type SkillBlockReason = "missing" | "invalid" | "users" | "targets";

/** `GET /skills` row for admins (mirror of the server's `AdminSkillRow`). */
export interface AdminSkillRow {
  name: string;
  source: "config" | "managed";
  path: string;
  users: SkillUsers;
  targets: SkillTargets;
  valid: boolean;
  invalidReason?: string;
  description?: string;
  usage: { personas: number; liveSessions: number };
}

/** `GET /skills` row for non-admins: caller-visible targets only. */
export interface CallerSkill {
  name: string;
  description?: string;
  targets: string[];
}

/** `GET /skills/available` row: a skill installed on the host (admin picker). */
export interface OperatorSkill {
  name: string;
  description: string;
  path: string;
  source: string;
}

/** `POST /skills/:name/impact`: what a managed write would end or block. */
export interface ImpactPreview {
  endSessions: number;
  blockedPersonas: { key: string; name: string; lostTargets: string[] }[];
  otherUsersPrivate: number;
}

export interface SkillWriteBody {
  name?: string;
  path?: string;
  users?: SkillUsers;
  targets?: SkillTargets;
}

export interface ProjectInfo {
  id: string;
  name: string;
  contextFiles: boolean;
  available: boolean;
  source: "config" | "folder";
  path?: string;
  users?: "*" | { iss: string; sub: string }[];
}

export interface Persona {
  key: string;
  scope: "shared" | "private";
  name: string;
  description: string;
  avatar: AvatarSpec;
  role: "leader" | "member";
  model?: string;
  instructions: string;
  tools: ToolsPreset;
  projects: string[];
  skills?: string[];
  forkedFrom?: string;
  updatedAt: string;
}

export interface PersonaInput {
  slug?: string;
  scope?: "shared" | "private";
  name: string;
  description: string;
  avatar: AvatarSpec;
  role: "leader" | "member";
  model?: string;
  instructions: string;
  tools: ToolsPreset;
  projects: string[];
  skills?: string[];
}

export interface Agent {
  key: string;
  name: string;
  description: string;
  avatar: AvatarSpec;
  role: "leader" | "member";
  model?: string;
  scope: "shared" | "private";
  tools: ToolsPreset;
  unconfined: boolean;
  status: AgentStatus;
  activeCount: number;
  latest?: { id: string; title: string; status: ConvStatus; lastActivityAt: string };
  personaStale: boolean;
  unassigned: boolean;
  retired: boolean;
  /** Persona skills the caller may use in the target, in persona order. */
  effectiveSkills: string[];
  /** First blocking skill for this caller/target, or null. */
  skillBlock: { skill: string; reason: SkillBlockReason } | null;
}

export interface Conversation {
  id: string;
  title: string;
  status: ConvStatus;
  lastActivityAt: string;
  archived: boolean;
  personaStale: boolean;
}

export interface MatchResult {
  cwd: string;
  project: { id: string; name: string; available: boolean; source: "config" | "folder"; agents: number; active: number } | null;
  enableable: boolean;
}

export interface KnownUser {
  iss: string;
  sub: string;
  email?: string;
  name?: string;
  lastSeenAt: string;
}
