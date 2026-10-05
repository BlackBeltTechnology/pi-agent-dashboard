/** Wire types of `/api/plugins/team/*` (design D9). See change: add-team-plugin. */
export type Target = string; // project id or "_ws"
export const WORKSPACE: Target = "_ws";

export type AvatarSpec = { kind: "gallery"; id: string } | { kind: "initials" };
export type ToolsPreset = "chat" | "files" | "full";
export type ConvStatus = "busy" | "running" | "sleeping";
export type AgentStatus = ConvStatus | "new" | "retired" | "unavailable";

export interface Me {
  uk: string;
  iss: string;
  sub: string;
  admin: boolean;
  mode: "single" | "multi";
  maxConversations: number;
  skills: string[];
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
