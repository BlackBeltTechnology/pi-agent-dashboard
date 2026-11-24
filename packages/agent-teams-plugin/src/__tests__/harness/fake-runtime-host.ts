/**
 * Fake `RuntimeHost`: everything `createTeamsRuntime` needs from
 * `ServerPluginContext` — the recorded emit/spawn/abort/shutdown/config surface
 * of `createFakeHostCtx`, plus a scriptable session table (`sessionManager`), a
 * capturing request lane (`registerPiRequestHandler`), session resolved/ended
 * subscriptions, shutdown hooks and a temp data dir. `lane(sessionId, type,
 * payload)` calls a registered handler exactly as the host would, with the
 * socket-supplied `meta`.
 * See change: add-agent-teams-core.
 */
import type { PluginRequestHandler } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { RuntimeHost } from "../../server/runtime.js";
import type { HostSession } from "../../server/types.js";
import { createFakeHostCtx } from "./fake-host-ctx.js";
import { capturingLogger, tmpDataDir } from "./store-env.js";

type LaneMeta = Parameters<PluginRequestHandler>[1];

export interface FakeRuntimeHostOptions {
  config?: Record<string, unknown>;
  dataDir?: string;
  /** Omit the request-lane seam (old host). */
  noLane?: boolean;
}

export function createFakeRuntimeHost(opts: FakeRuntimeHostOptions = {}) {
  const base = createFakeHostCtx(opts.config ? { config: opts.config } : {});
  const { logger, logs } = capturingLogger();
  const sessions = new Map<string, HostSession>();
  const registered = new Map<string, { handler: PluginRequestHandler; opts?: { hubLocalOnly?: boolean } }>();
  const resolvedHandlers = new Set<(sessionId: string, ref: Record<string, unknown>) => void>();
  const endedHandlers = new Set<(sessionId: string) => void>();
  const shutdownHooks = new Set<() => void>();
  const dataDir = opts.dataDir ?? tmpDataDir();

  const host = {
    ...base.ctx,
    logger,
    dataDir,
    onShutdown: (fn: () => void) => {
      shutdownHooks.add(fn);
      return () => void shutdownHooks.delete(fn);
    },
    onSessionResolved: (fn: (sessionId: string, ref: Record<string, unknown>) => void) => {
      resolvedHandlers.add(fn);
      return () => void resolvedHandlers.delete(fn);
    },
    onSessionEnded: (fn: (sessionId: string) => void) => {
      endedHandlers.add(fn);
      return () => void endedHandlers.delete(fn);
    },
    sessionManager: {
      getSession: (id: string) => sessions.get(id),
      isConnected: (id: string) => base.sessions.has(id),
    },
    ...(opts.noLane
      ? {}
      : {
          registerPiRequestHandler: (type: string, handler: PluginRequestHandler, o?: { hubLocalOnly?: boolean }) => {
            registered.set(type, { handler, ...(o ? { opts: o } : {}) });
          },
        }),
  } as unknown as RuntimeHost;

  return {
    host,
    base,
    logs,
    dataDir,
    sessions,
    registered,
    /** Register a host session (connected for emits) with an optional record. */
    addSession(id: string, record: HostSession = { cwd: "/work" }): string {
      sessions.set(id, record);
      base.sessions.add(id);
      return id;
    },
    endSession(id: string): void {
      sessions.delete(id);
      base.sessions.delete(id);
      for (const fn of [...endedHandlers]) fn(id);
    },
    resolveSession(id: string, ref: Record<string, unknown>): void {
      for (const fn of [...resolvedHandlers]) fn(id, ref);
    },
    runShutdownHooks(): void {
      for (const fn of [...shutdownHooks]) fn();
    },
    /** Call a registered lane handler as the host would (socket-supplied meta). */
    async lane(sessionId: string, type: string, payload: unknown, meta: Partial<LaneMeta> = {}): Promise<any> {
      const entry = registered.get(type);
      if (!entry) throw new Error(`no lane handler for ${type}`);
      return entry.handler(payload, { sessionId, origin: { local: true }, ...meta } as LaneMeta);
    },
    async call(sessionId: string, op: string, args?: unknown, meta: Partial<LaneMeta> = {}): Promise<any> {
      return this.lane(sessionId, "agent-teams/call", { op, args }, meta);
    },
  };
}

export type FakeRuntimeHost = ReturnType<typeof createFakeRuntimeHost>;
