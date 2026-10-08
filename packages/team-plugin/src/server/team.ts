/**
 * Composition root: builds the team services from narrow host ports, so the
 * whole stack is testable without a real host. See change: add-team-plugin.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PluginCwdPolicy } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { getDashboardConfigDir, resolvePiSessionsDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import type { FastifyInstance } from "fastify";
import { type Access, createAccess, type IdentityLike } from "./access.js";
import { ConversationService, type HostPort, type Logger } from "./conversations.js";
import { type FsOps, realFs, resolveTeamHome, TeamPaths } from "./paths.js";
import { PersonaService } from "./personas-service.js";
import { ProjectRegistry } from "./projects.js";
import { RecordStore } from "./records.js";
import { writePersonaFile } from "./render.js";
import { mountTeamRoutes } from "./routes.js";
import { type SkillEntry, SkillsService } from "./skills-service.js";
import { mountAppRoutes } from "./static.js";
import { PersonaStore } from "./store.js";
import type { Persona, TeamConfig } from "./types.js";
import { UsersStore } from "./users.js";

export interface TeamDeps {
  host: HostPort;
  identity?: IdentityLike;
  fastify: FastifyInstance;
  config: () => TeamConfig;
  logger: Logger;
  guardExtensionPath: string;
  distAppDir: string;
  env?: NodeJS.ProcessEnv;
  piDir?: string;
  ops?: FsOps;
  spawnTimeoutMs?: number;
  now?: () => number;
  renderPersona?: (persona: Persona, uk: string) => string;
  sweepEveryMs?: number;
  /** `host.listOperatorSkills` service (D11); absent on older hosts. */
  listOperatorSkills?: () => Promise<{ name: string; description: string; path: string; source: string }[]>;
  /** D8 seam override (tests): called instead of the built-in `invalidateSkill` pass. */
  onManagedWrite?: (name: string, before: SkillEntry | null, after: SkillEntry | null, by: string) => number | Promise<number>;
  /** Host cwd capability floor resolver (D7 composition); absent → no narrowing possible. */
  resolveCwdPolicy?: (cwd: string) => PluginCwdPolicy | undefined;
}

export interface Team {
  paths: TeamPaths;
  access: Access;
  conversations: ConversationService;
  personas: PersonaService;
  projects: ProjectRegistry;
  skills: SkillsService;
  start(): Promise<void>;
  stop(): void;
}

export function createTeam(d: TeamDeps): Team {
  const paths = new TeamPaths(resolveTeamHome(d.config().teamHome, d.env));
  const access = createAccess(d.identity, d.config);
  const ops = d.ops ?? realFs;
  const store = new PersonaStore(paths, d.logger, ops);
  const projects = new ProjectRegistry({
    paths,
    config: d.config,
    logger: d.logger,
    piDir: d.piDir ?? path.join(os.homedir(), ".pi"),
    ops,
  });
  const records = new RecordStore(paths, ops);
  const users = new UsersStore(paths, ops);
  const nowDate = d.now ? () => new Date(d.now?.() ?? Date.now()) : undefined;
  // Late-bound: the built-in invalidation pass lives on the conversation service, which needs `skills`.
  let conversations: ConversationService;
  const skills = new SkillsService({
    paths,
    projects,
    access,
    config: d.config,
    logger: d.logger,
    personas: store,
    records,
    getSession: (id) => d.host.getSession(id),
    agentDir: process.env.PI_CODING_AGENT_DIR ? path.resolve(process.env.PI_CODING_AGENT_DIR) : path.join(os.homedir(), ".pi", "agent"),
    sessionsRoot: resolvePiSessionsDir(),
    dashboardHome: getDashboardConfigDir(),
    listOperatorSkills: d.listOperatorSkills,
    onManagedWrite: (name, before, after, by) =>
      d.onManagedWrite ? d.onManagedWrite(name, before, after, by) : conversations.invalidateSkill(name, before, after, by),
    ops,
    now: nowDate,
  });
  const conversationService = new ConversationService({
    host: d.host,
    access,
    paths,
    personas: store,
    projects,
    records,
    skills,
    config: d.config,
    logger: d.logger,
    guardExtensionPath: d.guardExtensionPath,
    renderPersona: d.renderPersona ?? ((persona, uk) => writePersonaFile(paths.runtimeDir(uk, persona.key), persona)),
    spawnTimeoutMs: d.spawnTimeoutMs,
    now: d.now,
    resolveCwdPolicy: d.resolveCwdPolicy,
  });
  conversations = conversationService;
  const personas = new PersonaService({ store, projects, access, skills, config: d.config, now: nowDate });

  return {
    paths,
    access,
    conversations,
    personas,
    projects,
    skills,
    async start() {
      if (!fs.existsSync(d.guardExtensionPath)) {
        d.logger.error("team.guard_missing: starting a conversation will answer 503 guard_unavailable");
      }
      await mountTeamRoutes(d.fastify, {
        access,
        personas,
        projects,
        conversations,
        users,
        skills,
        logger: d.logger,
      });
      mountAppRoutes(d.fastify, d.distAppDir, d.logger);
      conversations.start(d.sweepEveryMs);
    },
    stop() {
      conversations.stop();
    },
  };
}
