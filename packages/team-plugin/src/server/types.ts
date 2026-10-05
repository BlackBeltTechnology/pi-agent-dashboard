/**
 * Shared types for the team plugin server. See change: add-team-plugin.
 */

export type PersonaScope = "shared" | "private";
export type PersonaRole = "leader" | "member";
export type ToolsPreset = "chat" | "files" | "full";
export type AvatarSpec = { kind: "gallery"; id: string } | { kind: "initials" };

/** Target id: a project id or the own workspace. */
export const WORKSPACE_TARGET = "_ws";

export interface Persona {
  schemaVersion: 1;
  /** `"<scope>:<slug>"`. */
  key: string;
  scope: PersonaScope;
  owner?: { iss: string; sub: string };
  name: string;
  description: string;
  avatar: AvatarSpec;
  role: PersonaRole;
  model?: string;
  instructions: string;
  tools: ToolsPreset;
  projects: string[];
  skills?: string[];
  forkedFrom?: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

/** The acting user, resolved per request. */
export interface Caller {
  /** 32-hex user key, or `local`. */
  uk: string;
  iss: string;
  sub: string;
  email?: string;
  name?: string;
  admin: boolean;
}

export type Mode = "single" | "multi";

export interface PersonaSnapshot {
  name: string;
  description: string;
  avatar: AvatarSpec;
  role: PersonaRole;
  model?: string;
}

export interface ConversationRecord {
  schemaVersion: 1;
  c: string;
  personaKey: string;
  project: string;
  sessionId: string;
  sessionFile?: string;
  runId: string;
  spawnToken: string;
  createdAt: string;
  startedAt: string;
  lastActivityAt: string;
  lastAgentEndAt?: string;
  personaUpdatedAt: string;
  title?: string;
  archived: boolean;
  personaSnapshot: PersonaSnapshot;
}

export interface ProjectConfigEntry {
  name: string;
  path: string;
  users: "*" | { iss: string; sub: string }[];
  contextFiles?: boolean;
}

export interface Project {
  id: string;
  name: string;
  /** Validated realpath; undefined when unavailable. */
  path?: string;
  users: "*" | { iss: string; sub: string }[];
  contextFiles: boolean;
  source: "config" | "folder";
  available: boolean;
}

/** HTTP-level error carrying a machine code. */
export class TeamError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(code);
  }
}

export interface TeamConfig {
  admins?: { iss: string; sub: string }[];
  skillCatalog?: Record<string, string>;
  idleMinutes?: number;
  maxConversations?: number;
  teamHome?: string;
  projects?: Record<string, ProjectConfigEntry>;
}
