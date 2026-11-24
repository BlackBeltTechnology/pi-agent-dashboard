/**
 * Server composition: store + persistence + driver + modes + ops + lane, wired
 * from the host context members the plugin uses. `registerPlugin` (server entry)
 * is a thin call into this; tests build the same runtime over the fake host.
 * See change: add-agent-teams-core.
 */
import path from "node:path";
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { type Clock, systemClock } from "../shared/clock.js";
import { createConfigReader } from "./config.js";
import { createSessionDriver } from "./driver.js";
import { type ExtensionPoints, extensionPoints } from "./extension-points.js";
import { createLaneHandlers, registerLane } from "./lane.js";
import { createModeRegistry, type ModeRegistry } from "./modes.js";
import { createOps, type MailFlusher, type Ops, type SpawnPlanner, type SpawnStarter } from "./ops.js";
import { type PersistFs, TeamPersistence } from "./persistence.js";
import { TeamStore } from "./store.js";
import { type HostSessionLookup, narrowHostSession } from "./types.js";

/** The `ServerPluginContext` members the runtime drives. */
export type RuntimeHost = Pick<
  ServerPluginContext,
  | "emitEventToSession"
  | "spawnSession"
  | "abortSession"
  | "shutdownSession"
  | "getPluginConfig"
  | "logger"
  | "dataDir"
  | "onShutdown"
  | "onSessionResolved"
  | "onSessionEnded"
  | "sessionManager"
> &
  Partial<Pick<ServerPluginContext, "registerPiRequestHandler">>;

export interface RuntimeOptions {
  clock?: Clock;
  ext?: ExtensionPoints;
  fs?: PersistFs;
  planner?: SpawnPlanner;
  starter?: SpawnStarter;
  mailer?: MailFlusher;
  newToken?: () => string;
  idFactory?: () => string;
}

export interface TeamsRuntime {
  store: TeamStore;
  persistence: TeamPersistence;
  ops: Ops;
  modes: ModeRegistry;
  ext: ExtensionPoints;
  /** Whether the request lane could be registered (false on an old host). */
  laneRegistered: boolean;
  laneHandlers: ReturnType<typeof createLaneHandlers>;
  dispose(): void;
}

export function createTeamsRuntime(host: RuntimeHost, opts: RuntimeOptions = {}): TeamsRuntime {
  const clock = opts.clock ?? systemClock;
  const logger = host.logger;
  const ext = opts.ext ?? extensionPoints;
  const config = createConfigReader(() => host.getPluginConfig<Record<string, unknown>>(), logger);

  const persistence = new TeamPersistence({
    dir: path.join(host.dataDir, "teams"),
    clock,
    logger,
    ...(opts.fs ? { fs: opts.fs } : {}),
    maxMailLogBytes: () => config().maxMailLogBytes,
    closedRetentionDays: () => config().closedRetentionDays,
  });
  const store = new TeamStore({ clock, logger, persistence, ...(opts.idFactory ? { idFactory: opts.idFactory } : {}) });
  store.hydrate(persistence.load());

  const sm = host.sessionManager as unknown as { getSession?: (id: string) => unknown; isConnected?: (id: string) => boolean };
  const hostSession: HostSessionLookup = (id) => narrowHostSession(sm.getSession?.(id));
  const driver = createSessionDriver({
    emitEventToSession: host.emitEventToSession,
    spawnSession: host.spawnSession,
    abortSession: host.abortSession,
    shutdownSession: host.shutdownSession,
    ...(sm.isConnected ? { isConnected: (id: string) => sm.isConnected?.(id) === true } : {}),
  });
  const modes = createModeRegistry(driver);

  const ops = createOps({
    store,
    clock,
    logger,
    config,
    modes,
    ext,
    hostSession,
    ...(opts.planner ? { planner: opts.planner } : {}),
    ...(opts.starter ? { starter: opts.starter } : {}),
    ...(opts.mailer ? { mailer: opts.mailer } : {}),
    ...(opts.newToken ? { newToken: opts.newToken } : {}),
  });

  const laneHandlers = createLaneHandlers({ ops, ext });
  const laneRegistered = registerLane(host, laneHandlers, logger);

  const offResolved = host.onSessionResolved((sessionId, ref) => ops.handleSessionResolved(sessionId, ref));
  const offEnded = host.onSessionEnded((sessionId) => ops.handleSessionEnded(sessionId));
  // Flush every pending team file synchronously: `onShutdown` hooks cannot await.
  const offShutdown = host.onShutdown(() => persistence.flushSync());

  ops.rearmOrphans();
  ops.resumeClosing();

  return {
    store,
    persistence,
    ops,
    modes,
    ext,
    laneRegistered,
    laneHandlers,
    dispose() {
      offResolved();
      offEnded();
      offShutdown();
      ops.dispose();
    },
  };
}
