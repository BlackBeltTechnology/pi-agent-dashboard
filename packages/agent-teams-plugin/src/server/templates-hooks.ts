/**
 * Composition root of the templates-hooks change (design D3-D8): the ONLY place its modules
 * wire into the core. `createTeamsRuntime` calls `registerTemplatesHooks(deps)` once, after
 * `createOps` and BEFORE the request lane exists / the first lane request seals the registries.
 * Each module exports ONE registrar `(deps: TemplatesHooksDeps) => void` from its own file and is
 * listed in `REGISTRARS` below; a phase fills its own file and never edits core files again.
 *
 * What a registrar may use (all additive core seams, inert until used):
 *   `deps.ops.registerStartOp(op, handler, opts?)`   `team.start` / `team.templates` (lane, plain caller, async ok)
 *   `deps.ops.registerOp(op, handler)`                `PlanSubmit` / `PlanDecision` (sync handler)
 *   `deps.ext.registerOpGate(op, gate)`               `TaskCreate` | `TaskUpdate` | `IDLE_GATE_OP` ("TeammateIdle")
 *   `deps.ext.registerHelloContributor(fn)`           hello reply `planMode` + `degraded:"plan_tools_unavailable"`
 *   `deps.ext.setSpawnResolver(fn)`                   spawn precedence / ceilings / plan floor (ONE resolver)
 *   `deps.ext.registerSpawnContributor(fn)`           prompt files / env (`PI_EXT_AGENT_TEAMS_PLAN_MODE`)
 *   `deps.ext.registerDispatchEligibility(fn)`        skip `planning`/`pending` members
 *   `deps.ext.registerIdleNoticeFilter(fn)`           no lead idle notice for a `pending` plan member
 *   `deps.ext.registerRoutes(fn)`                     REST routes inside core's scope (tiers: shared/route-tiers.ts)
 *   `deps.leads`                                      server-started lead spawn + abort by token
 * Registrars run in `REGISTRARS` order; gates/contributors of one kind run in that same order.
 * See change: add-agent-teams-templates-hooks.
 */
import type { Clock } from "../shared/clock.js";
import type { Team } from "../shared/types.js";
import { registerAgents } from "./agents.js";
import type { ConfigReader } from "./config.js";
import type { LeadSpawnOptions, SpawnOutcome } from "./driver.js";
import type { ExtensionPoints } from "./extension-points.js";
import { registerHookTrust } from "./hook-trust.js";
import { registerHooks } from "./hooks.js";
import type { ModeRegistry } from "./modes.js";
import type { Ops } from "./ops.js";
import { registerPlans } from "./plans.js";
import { registerSpawnResolve } from "./spawn-resolve.js";
import { registerStart } from "./start.js";
import type { TeamStore } from "./store.js";
import type { Telemetry } from "./telemetry.js";
import { registerTemplates } from "./templates.js";
import type { HostSessionLookup, Logger } from "./types.js";

/** Server-started lead (D4b): the session driver's lead spawn and the token-based abort. */
export interface LeadSpawner {
  /**
   * Spawn the lead session of a `starting` team (`pluginRef {"agent-teams":{teamId,role:"lead"}}` +
   * principal-owner stamp, no tool restriction, NO `initialPrompt`). Pass `spawnToken` (mint it, persist
   * `Team.leadSpawnToken` FIRST) so the spawn can be aborted by token. `{ok:false}` when the mode has no lead spawn.
   */
  spawn(team: Team, opts: LeadSpawnOptions): Promise<SpawnOutcome>;
  /** Kill a spawn / its session by token (`host.abortSpawnedRun`); never throws, no-op on a host without it. */
  abort(spawnToken: string): void;
}

/** Plugin-owned counters (not part of core's `Telemetry` snapshot shape); `get()` for stats/tests. */
export interface PluginCounters {
  /** Increment `name` (per team when `teamId` is given, always also the `*` total). */
  inc(name: string, teamId?: string, n?: number): void;
  get(name: string, teamId?: string): number;
  snapshot(): Record<string, number>;
  /** Non-zero counters of one team keyed by counter name (the snapshot `stats` extension). */
  forTeam(teamId: string): Record<string, number>;
}

export function createPluginCounters(): PluginCounters {
  const m = new Map<string, number>();
  const bump = (k: string, n: number): void => void m.set(k, (m.get(k) ?? 0) + n);
  return {
    inc(name, teamId, n = 1) {
      bump(`*:${name}`, n);
      if (teamId !== undefined) bump(`${teamId}:${name}`, n);
    },
    get: (name, teamId) => m.get(`${teamId ?? "*"}:${name}`) ?? 0,
    snapshot: () => Object.fromEntries(m),
    forTeam(teamId) {
      const prefix = `${teamId}:`;
      const out: Record<string, number> = {};
      for (const [k, v] of m) if (k.startsWith(prefix) && v !== 0) out[k.slice(prefix.length)] = v;
      return out;
    },
  };
}

/** Host capabilities consumed through `ctx.consume` (absent ⇒ safe defaults; tests inject them). */
export interface TemplatesHooksHost {
  /** `host.isProjectTrusted`, resolved per call; FAIL-CLOSED: `false` when the host does not publish it. */
  isProjectTrusted: (cwd: string) => boolean;
  /** `host.knownFolderCwds`; default `() => []`. */
  knownFolderCwds: () => string[];
  /** pi agent dir (`PI_CODING_AGENT_DIR` or `~/.pi/agent`); user-tier agents/templates live below it. */
  resolvePiAgentDir: () => string;
  /** `ctx.onShutdown`. */
  onShutdown: (fn: () => void) => () => void;
}

/** The one stable dependency bag every module registrar receives. */
export interface TemplatesHooksDeps {
  ops: Ops;
  store: TeamStore;
  ext: ExtensionPoints;
  /** Limits are read PER CALL (`config()`), never cached. */
  config: ConfigReader;
  logger: Logger;
  clock: Clock;
  /** Plugin data dir (`<dataDir>/hook-trust.json`, `<dataDir>/prompts/<teamId>/…`). */
  dataDir: string;
  hostSession: HostSessionLookup;
  host: TemplatesHooksHost;
  modes: ModeRegistry;
  /** Lead spawn / abort (D4b). */
  leads: LeadSpawner;
  /** Core telemetry (structured logs + core counters). */
  telemetry: Telemetry;
  /** Plugin-owned counters (hook outcomes, plan decisions, template starts…). */
  counters: PluginCounters;
  /** Run `fn` when the runtime is disposed (timers, child processes). */
  onDispose(fn: () => void): void;
}

export type Registrar = (deps: TemplatesHooksDeps) => void;

/**
 * Fixed order. Edit ONLY by adding a module; a module that does not exist yet is a no-op stub in its own
 * file. (Command lane `bridge/command.ts` and plan mode `bridge/plan-mode.ts` are the bridge-side twins,
 * wired from `bridge/index.ts` through `bridge/context.ts`.)
 */
export const REGISTRARS: ReadonlyArray<readonly [name: string, register: Registrar]> = [
  ["templates", registerTemplates],
  ["agents", registerAgents],
  ["hooks", registerHooks],
  ["hook-trust", registerHookTrust],
  ["plans", registerPlans],
  ["start", registerStart],
  ["spawn-resolve", registerSpawnResolve],
];

const wired = new WeakSet<ExtensionPoints>();

/**
 * Run every registrar once per extension-points registry (a process-wide registry shared by several
 * runtimes, as in tests, is wired once). A registry that is already sealed is skipped with a warning
 * (registration after the first lane request is impossible by design). A registrar that throws is
 * logged and skipped: a broken optional feature must not stop core teams.
 */
export function registerTemplatesHooks(deps: TemplatesHooksDeps): void {
  if (wired.has(deps.ext)) return;
  if (deps.ext.sealed) {
    deps.logger.warn("agent-teams: templates/hooks not registered: extension points are already sealed");
    return;
  }
  wired.add(deps.ext);
  for (const [name, register] of REGISTRARS) {
    try {
      register(deps);
    } catch (err) {
      deps.logger.error(`agent-teams: templates-hooks module ${name} failed to register: ${(err as Error).message}`);
    }
  }
}
