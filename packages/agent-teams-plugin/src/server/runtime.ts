/**
 * Server composition: store + persistence + driver + modes + ops + lane, wired
 * from the host context members the plugin uses. `registerPlugin` (server entry)
 * is a thin call into this; tests build the same runtime over the fake host.
 * See change: add-agent-teams-core.
 */
import path from "node:path";
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { resolvePiAgentDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import { registerApprovalMailKinds } from "../shared/approval-mail.js";
import { type Clock, systemClock } from "../shared/clock.js";
import { AGENT_TEAMS_EVENT_INPROC } from "../shared/plugin-id.js";
import { createConfigReader } from "./config.js";
import { createSessionDriver } from "./driver.js";
import { createInProcDriver, type InProcDriver } from "./driver-inproc.js";
import { type ExtensionPoints, extensionPoints } from "./extension-points.js";
import { createInProcLead, type InProcLead } from "./inproc-lead.js";
import { createInProcLifecycle, type InProcLifecycle } from "./inproc-lifecycle.js";
import { createLaneHandlers, registerLane } from "./lane.js";
import { createModeRegistry, type ModeRegistry } from "./modes.js";
import { bindNewTeamToHello, closeInProcessTeamsWithoutMode, createInProcAvailability, createInProcLane, flagMembersWithoutToken, type InProcAvailability, registerInProcessMode } from "./modes-inproc.js";
import { createOps, type MailFlusher, type Ops, type SpawnPlanner, type SpawnStarter } from "./ops.js";
import { type PersistFs, TeamPersistence } from "./persistence.js";
import { scrubProxyTokensOnClose } from "./proxy-identity.js";
import { TeamStore } from "./store.js";
import type { Telemetry } from "./telemetry.js";
import { createPluginCounters, type LeadSpawner, type PluginCounters, registerTemplatesHooks, type TemplatesHooksHost } from "./templates-hooks.js";
import { type HostSessionLookup, narrowHostSession } from "./types.js";

/** The `ServerPluginContext` members the runtime drives. */
export type RuntimeHost = Pick<
  ServerPluginContext,
  | "emitEventToSession"
  | "spawnSession"
  | "abortSession"
  | "abortSpawnedRun"
  | "shutdownSession"
  | "getPluginConfig"
  | "logger"
  | "dataDir"
  | "onShutdown"
  | "onSessionResolved"
  | "onSessionEnded"
  | "sessionManager"
> &
  Partial<Pick<ServerPluginContext, "registerPiRequestHandler" | "getPiResources" | "consume">>;

export interface RuntimeOptions {
  clock?: Clock;
  ext?: ExtensionPoints;
  fs?: PersistFs;
  planner?: SpawnPlanner;
  starter?: SpawnStarter;
  mailer?: MailFlusher;
  newToken?: () => string;
  idFactory?: () => string;
  /** Host model availability for `TeammateSpawn {model}` (absent ⇒ syntax check only). */
  isKnownModel?: (model: string) => boolean;
  /** Overrides of the host capabilities the templates-hooks modules consume (tests; defaults come from `host.consume`). */
  templatesHost?: Partial<TemplatesHooksHost>;
  /**
   * Register the `in-process` teammate mode (driver, availability map, `agent-teams/inproc` lane). Default `false`:
   * the mode stays unregistered until the lead-bridge host and the upstream release exist, and open in-process teams found
   * on load are closed `mode_unavailable`. See change: add-agent-teams-in-process.
   */
  inProcess?: boolean;
}

export interface TeamsRuntime {
  store: TeamStore;
  persistence: TeamPersistence;
  ops: Ops;
  /** Counters + structured logs (the REST snapshot `stats`). */
  telemetry: Telemetry;
  modes: ModeRegistry;
  ext: ExtensionPoints;
  /** Server-started lead spawn + abort by token (D4b); the session driver's `spawnLead`. */
  leads: LeadSpawner;
  /** Plugin-owned counters shared with the templates-hooks modules. */
  counters: PluginCounters;
  /** In-process mode internals (driver, lead lifecycle, availability map); absent unless `RuntimeOptions.inProcess`. */
  inProcess?: { driver: InProcDriver; lead: InProcLead; lifecycle: InProcLifecycle; availability: InProcAvailability };
  /** Whether the request lane could be registered (false on an old host). */
  laneRegistered: boolean;
  laneHandlers: ReturnType<typeof createLaneHandlers>;
  dispose(): void;
}

export function createTeamsRuntime(host: RuntimeHost, opts: RuntimeOptions = {}): TeamsRuntime {
  registerApprovalMailKinds();
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
  const offScrub = scrubProxyTokensOnClose(store); // in-process member secrets die with the team

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
  // `abortSpawnedRun`/`getPiResources` are `this`-free host hooks; bind-less calls are safe, but keep them behind a guard for old hosts.
  const abortSpawnedRun = typeof host.abortSpawnedRun === "function" ? host.abortSpawnedRun : undefined;
  const getPiResources = typeof host.getPiResources === "function" ? host.getPiResources : undefined;

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
    ...(abortSpawnedRun ? { abortSpawnedRun: (a) => abortSpawnedRun(a) } : {}),
    ...(getPiResources ? { getPiResources: (cwd) => getPiResources(cwd) } : {}),
    ...(opts.isKnownModel ? { isKnownModel: opts.isKnownModel } : {}),
    // A rejected proxied `as` (in-process identity): counter + ids-only log line.
    onProxyRejected: ({ sessionId, reason, teamId }) => {
      counters.inc("inproc_forbidden", teamId);
      logger.warn(`agent-teams: proxied identity rejected session=${sessionId} reason=${reason}${teamId ? ` team=${teamId}` : ""}`);
    },
  });

  const disposers: Array<() => void> = [];
  const leads: LeadSpawner = {
    spawn: (team, o) => (driver.spawnLead ? driver.spawnLead(team, o) : Promise.resolve({ ok: false, message: "this mode cannot spawn a lead" })),
    abort(spawnToken) {
      try {
        const out = abortSpawnedRun?.({ spawnToken });
        if (out && typeof (out as Promise<unknown>).catch === "function") (out as Promise<unknown>).catch((err: unknown) => logger.warn(`agent-teams: abortSpawnedRun failed: ${(err as Error).message}`));
      } catch (err) {
        logger.warn(`agent-teams: abortSpawnedRun failed: ${(err as Error).message}`);
      }
    },
  };
  const counters = createPluginCounters();
  const consume = host.consume;
  registerTemplatesHooks({
    ops,
    store,
    ext,
    config,
    logger,
    clock,
    dataDir: host.dataDir,
    hostSession,
    modes,
    leads,
    telemetry: ops.telemetry,
    counters,
    host: {
      isProjectTrusted: (cwd: string) => consume?.<(cwd: string) => boolean>("host.isProjectTrusted")?.(cwd) === true,
      knownFolderCwds: () => consume?.<() => string[]>("host.knownFolderCwds")?.() ?? [],
      resolvePiAgentDir: () => resolvePiAgentDir(),
      onShutdown: (fn) => host.onShutdown(fn),
      ...opts.templatesHost,
    },
    onDispose: (fn) => void disposers.push(fn),
  });

  const availability = createInProcAvailability(clock);
  const isHostConnected = (id: string): boolean => sm.isConnected?.(id) === true;
  let inProcDriver: ReturnType<typeof createInProcDriver> | undefined;
  let inProcLead: InProcLead | undefined;
  let inProcLifecycle: InProcLifecycle | undefined;
  let offTeamCreated: (() => void) | undefined;
  const inProcLane: ReturnType<typeof createInProcLane> | undefined = (() => {
    if (opts.inProcess !== true) return undefined;
    inProcDriver = createInProcDriver({
      store,
      clock,
      logger,
      config,
      emit: (sessionId, data) => host.emitEventToSession(sessionId, AGENT_TEAMS_EVENT_INPROC, data),
      isConnected: isHostConnected,
      availability,
      counters,
      failMember: (teamId, member, message) => {
        const team = store.get(teamId);
        if (team) ops.releaseMember(team, member, "failed", message);
      },
      goneMember: (teamId, member, reason) => {
        const team = store.get(teamId);
        if (team) ops.releaseMember(team, member, "gone", reason);
      },
      // Mail handed to a child is acked when the host reports it handed over; a failed handover is un-handed for the next flush.
      ackMail: (teamId, ids) => ops.mailHandover.ack(teamId, ids),
      unhandMail: (teamId, member) => ops.mailHandover.unhand(teamId, member),
      flushMail: (teamId, member) => ops.mailHandover.flush(teamId, member),
      // A stop that was never confirmed: the child may still run, so remember it for the lead's next hello, and release the member.
      stopUnconfirmed: ({ teamId, member, childId, agentId }) => {
        inProcLead?.recordStop(teamId, { member, ...(childId ? { childId } : {}), ...(agentId ? { agentId } : {}) });
        const team = store.get(teamId);
        if (team) ops.releaseMember(team, member, "gone", "not_alive");
      },
    });
    registerInProcessMode(modes, inProcDriver, availability, isHostConnected);
    inProcLead = createInProcLead({ store, clock, logger, driver: inProcDriver, availability, ops });
    inProcLifecycle = createInProcLifecycle({ store, clock, logger, config, counters, driver: inProcDriver, ops });
    offTeamCreated = bindNewTeamToHello(store, availability);
    return createInProcLane({ ops, ext, store, driver: inProcDriver, availability, counters, logger, lifecycle: inProcLifecycle, lead: inProcLead });
  })();
  // Rollback / mode removed: open in-process teams cannot continue (a registered mode keeps them `disconnected` until the lead's hello).
  closeInProcessTeamsWithoutMode(store, modes, ops, logger);
  flagMembersWithoutToken(store, logger);
  inProcLead?.expireStops();

  const laneHandlers = { ...createLaneHandlers({ ops, ext }), ...(inProcLane ?? {}) };
  const laneRegistered = registerLane(host, laneHandlers, logger);

  const offResolved = host.onSessionResolved((sessionId, ref) => ops.handleSessionResolved(sessionId, ref));
  const offEnded = host.onSessionEnded((sessionId) => {
    // The lead of an in-process team ending closes the team at once (no orphan window; its pending stops need the lead's incarnation, so
    // the availability record is forgotten only afterwards); everything else is core's.
    const handled = inProcLead?.onSessionEnded(sessionId) === true;
    availability.forget(sessionId);
    if (!handled) ops.handleSessionEnded(sessionId);
  });
  // Flush every pending team file synchronously: `onShutdown` hooks cannot await.
  const offShutdown = host.onShutdown(() => persistence.flushSync());

  ops.rearmOrphans();
  ops.reconcile();
  ops.resumeClosing();

  return {
    store,
    persistence,
    ops,
    telemetry: ops.telemetry,
    modes,
    ext,
    leads,
    counters,
    laneRegistered,
    laneHandlers,
    ...(inProcDriver && inProcLead && inProcLifecycle ? { inProcess: { driver: inProcDriver, lead: inProcLead, lifecycle: inProcLifecycle, availability } } : {}),
    dispose() {
      offScrub();
      offResolved();
      offEnded();
      offShutdown();
      inProcDriver?.dispose();
      inProcLifecycle?.dispose();
      offTeamCreated?.();
      for (const fn of disposers.splice(0)) {
        try {
          fn();
        } catch (err) {
          logger.warn(`agent-teams: dispose hook failed: ${(err as Error).message}`);
        }
      }
      ops.dispose();
    },
  };
}
