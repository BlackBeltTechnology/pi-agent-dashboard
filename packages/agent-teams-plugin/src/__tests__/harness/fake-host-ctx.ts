/**
 * Fake host context — the five `ServerPluginContext` members the plugin drives
 * (`emitEventToSession`, `spawnSession`, `abortSession`, `shutdownSession`,
 * `getPluginConfig`). Every call is recorded; every outcome is scriptable, so a
 * test can model a lost emit, a failed spawn, a hung shutdown or a config
 * change. `getPluginConfig` starts from the REAL `configSchema.json` defaults,
 * so the harness cannot drift from the shipped settings.
 * Extends the `packages/team-plugin/src/server/__tests__/harness.ts` pattern.
 * See change: add-agent-teams-core.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type {
  PluginSpawnOptions,
  PluginSpawnResult,
  ServerPluginContext,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";

type HostCtxSurface = Pick<
  ServerPluginContext,
  "emitEventToSession" | "spawnSession" | "abortSession" | "shutdownSession" | "getPluginConfig"
>;

interface RecordedEmit {
  readonly sessionId: string;
  readonly eventType: string;
  readonly data: Record<string, unknown> | undefined;
}

interface FakeHostCtxOptions {
  /** Overrides merged over the configSchema defaults. */
  config?: Record<string, unknown>;
  /** Sessions the host knows; unknown ids make emit/abort/shutdown return false. */
  knownSessions?: Iterable<string>;
}

interface FakeHostCtx {
  /** Pass this where the plugin expects its host context members. */
  readonly ctx: HostCtxSurface;
  readonly emits: RecordedEmit[];
  readonly spawns: PluginSpawnOptions[];
  readonly aborts: string[];
  readonly shutdowns: string[];
  /** Mutable: ids the host currently "has". `spawnSession` adds the new id. */
  readonly sessions: Set<string>;
  /** Replace the spawn behaviour (default: succeed with a fresh `spawn-<n>` token). */
  onSpawn(handler: (opts: PluginSpawnOptions) => Promise<PluginSpawnResult> | PluginSpawnResult): void;
  /** Replace the shutdown behaviour (default: resolve true for a known session). */
  onShutdown(handler: (sessionId: string) => Promise<boolean> | boolean): void;
  /** Merge a config patch; later `getPluginConfig()` calls see it. */
  setConfig(patch: Record<string, unknown>): void;
}

/** Defaults declared by the shipped `src/configSchema.json` (property → `default`). */
export function loadConfigDefaults(): Record<string, unknown> {
  const schemaPath = fileURLToPath(new URL("../../configSchema.json", import.meta.url));
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8")) as {
    properties?: Record<string, { default?: unknown }>;
  };
  const out: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(schema.properties ?? {})) {
    if (def.default !== undefined) out[key] = def.default;
  }
  return out;
}

export function createFakeHostCtx(opts: FakeHostCtxOptions = {}): FakeHostCtx {
  const emits: RecordedEmit[] = [];
  const spawns: PluginSpawnOptions[] = [];
  const aborts: string[] = [];
  const shutdowns: string[] = [];
  const sessions = new Set<string>(opts.knownSessions ?? []);
  let config: Record<string, unknown> = { ...loadConfigDefaults(), ...(opts.config ?? {}) };
  let spawnHandler: (o: PluginSpawnOptions) => Promise<PluginSpawnResult> | PluginSpawnResult;
  let shutdownHandler: (id: string) => Promise<boolean> | boolean = (id) => sessions.has(id);
  let spawnSeq = 0;

  spawnHandler = () => ({ success: true, spawnToken: `spawn-${++spawnSeq}` });

  const ctx: HostCtxSurface = {
    emitEventToSession(sessionId, eventType, data) {
      emits.push({ sessionId, eventType, data });
      return sessions.has(sessionId);
    },
    async spawnSession(o) {
      spawns.push(o);
      return spawnHandler(o);
    },
    abortSession(sessionId) {
      aborts.push(sessionId);
      return sessions.has(sessionId);
    },
    async shutdownSession(sessionId) {
      shutdowns.push(sessionId);
      return shutdownHandler(sessionId);
    },
    getPluginConfig<T = Record<string, unknown>>(): T {
      return { ...config } as T;
    },
  };

  return {
    ctx,
    emits,
    spawns,
    aborts,
    shutdowns,
    sessions,
    onSpawn(handler) {
      spawnHandler = handler;
    },
    onShutdown(handler) {
      shutdownHandler = handler;
    },
    setConfig(patch) {
      config = { ...config, ...patch };
    },
  };
}
