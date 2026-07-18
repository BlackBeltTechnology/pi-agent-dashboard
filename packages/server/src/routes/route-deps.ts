/**
 * Shared dependency types for route modules.
 * Each route module receives only the deps it needs.
 */
import type { SessionManager } from "../session/memory-session-manager.js";
import type { EventStore } from "../persistence/memory-event-store.js";
import type { PreferencesStore } from "../persistence/preferences-store.js";
import type { MetaPersistence } from "../persistence/meta-persistence.js";
import type { DirectoryService } from "../directory-service.js";
import type { ServerConfig } from "../server.js";
import type { FastifyRequest, FastifyReply } from "fastify";

export type NetworkGuard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export interface RouteDeps {
  sessionManager: SessionManager;
  eventStore: EventStore;
  preferencesStore: PreferencesStore;
  metaPersistence: MetaPersistence;
  directoryService: DirectoryService;
  config: ServerConfig;
  networkGuard: NetworkGuard;
}
