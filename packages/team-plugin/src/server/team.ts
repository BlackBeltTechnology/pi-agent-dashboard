/**
 * Composition root: builds the team services from narrow host ports, so the
 * whole stack is testable without a real host. See change: add-team-plugin.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { type Access, createAccess, type IdentityLike } from "./access.js";
import { ConversationService, type HostPort, type Logger } from "./conversations.js";
import { type FsOps, realFs, resolveTeamHome, TeamPaths } from "./paths.js";
import { PersonaService } from "./personas-service.js";
import { ProjectRegistry } from "./projects.js";
import { RecordStore } from "./records.js";
import { writePersonaFile } from "./render.js";
import { mountTeamRoutes } from "./routes.js";
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
}

export interface Team {
  paths: TeamPaths;
  access: Access;
  conversations: ConversationService;
  personas: PersonaService;
  projects: ProjectRegistry;
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
  const conversations = new ConversationService({
    host: d.host,
    access,
    paths,
    personas: store,
    projects,
    records,
    config: d.config,
    logger: d.logger,
    guardExtensionPath: d.guardExtensionPath,
    renderPersona: d.renderPersona ?? ((persona, uk) => writePersonaFile(paths.runtimeDir(uk, persona.key), persona)),
    spawnTimeoutMs: d.spawnTimeoutMs,
    now: d.now,
  });
  const personas = new PersonaService({ store, projects, access, config: d.config });

  return {
    paths,
    access,
    conversations,
    personas,
    projects,
    async start() {
      if (!fs.existsSync(d.guardExtensionPath)) {
        d.logger.error("team.guard_missing: spawns will answer 503 guard_unavailable");
      }
      await mountTeamRoutes(d.fastify, { access, personas, projects, conversations, users, logger: d.logger });
      mountAppRoutes(d.fastify, d.distAppDir, d.logger);
      conversations.start(d.sweepEveryMs);
    },
    stop() {
      conversations.stop();
    },
  };
}
