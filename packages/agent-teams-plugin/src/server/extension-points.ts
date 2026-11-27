/**
 * Typed registries later changes extend (task 2.10, design D17). Every registry
 * is EMPTY by default and inert: with nothing registered the plugin behaves as
 * the plain session-mode flow. Registration is only possible from the server
 * process before the first lane request (`seal()`), so a peer cannot extend
 * behaviour at runtime. `registerMailKind` lives in `shared/mail-format.ts`
 * (the bridge needs it too) and is re-exported here for one import surface.
 * See change: add-agent-teams-core.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ErrorCode, HelloPayload, HelloReply, OpResult, TeammateSpawnArgs, TeamRole } from "../shared/protocol.js";
import type { Committer, Member, MemberDegraded, PlanApprovalPolicy, PlanApprovalState, Team } from "../shared/types.js";
import type { ResolvedSpawnSpec } from "./driver.js";
import type { Logger } from "./types.js";

export { registerMailKind } from "../shared/mail-format.js";

/**
 * Options only an in-process server caller can pass to `spawnMember`; never
 * reachable from the request lane. `cwd` skips confinement (worktrees);
 * `committer:"member"` is PER MEMBER (`Team.committer` stays `lead`).
 */
export interface TrustedSpawnOptions {
  cwd?: string;
  committer?: Committer;
}

/** A contributor may append prompt files and env keys and NARROW `tools`/`skills`; its `cwd` is ignored. */
export interface SpawnContribution {
  tools?: string[];
  skills?: string[];
  promptFiles?: string[];
  env?: Record<string, string | string[]>;
  /** Ignored (and logged once): contributors cannot change where a session runs. */
  cwd?: string;
}
export type SpawnContributor = (input: { team: Team; member: Member; spec: Readonly<ResolvedSpawnSpec> }) => SpawnContribution | undefined;

/**
 * Thrown by a contributor to FAIL this member's spawn (`message` should start with a stable code); any
 * other throw is logged and the contributor skipped. The member goes `failed`, nothing is started.
 */
export class SpawnContributorError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "SpawnContributorError";
    this.code = code;
  }
}

/** The op name the idle report's gates are registered under (`ext.registerOpGate(IDLE_GATE_OP, …)`). */
export const IDLE_GATE_OP = "TeammateIdle";

/** What an `OpGate` receives. `idle`/`wakeSeq` are set only for the `TeammateIdle` gate. */
export interface OpGateInput {
  op: string;
  team: Team;
  callerName: string;
  args: unknown;
  /** `TeammateIdle` only: the idle report (the gate reads state from the store, never from agent text). */
  idle?: { settleId: number; finalText?: string; error?: string };
  /** `TeammateIdle` only: the member's wake sequence at REPORT time and a live reader (see `Ops.wakeSeq`). */
  wakeSeq?: { at: number; read(): number };
}

/**
 * A gate veto. `feedback` becomes the op error `message`; `code` (default `op_blocked`) is the
 * error returned to the agent (e.g. `hook_blocked`). For the `TeammateIdle` gate, `afterBlock` runs once
 * AFTER core has kept the member `busy` (use it to deliver feedback mail); it is not called when
 * the idle was dropped as superseded, and it is ignored by every other op.
 */
export interface OpGateBlock {
  block: true;
  feedback: string;
  code?: ErrorCode;
  afterBlock?: () => void;
}

/** An async pre-commit gate for an op; it may veto with `{block, feedback, code?}`. */
export type OpGateResult = OpGateBlock | undefined | void;
export type OpGate = (input: OpGateInput) => Promise<OpGateResult> | OpGateResult;

/** Hello handshake contribution (plans module): merged into the member's `hello` reply. */
export interface HelloContribution {
  /** Extra reply fields; `role`/`teamId`/`member` can never be overridden. */
  reply?: Pick<HelloReply, "planMode">;
  /** Mark the member degraded from the handshake (member only; core `guardVerdict` failures win). */
  degraded?: MemberDegraded;
}
export type HelloContributor = (input: { team: Team; member: Member | undefined; role: TeamRole; payload: HelloPayload }) => HelloContribution | undefined;

/** Where a spawn request came from: the agent tool (`lane`) or an in-process server caller (`server`, e.g. eager start). */
export type SpawnSource = "lane" | "server";

/** Per-member fields persisted on the `Member` record by the spawn resolver. */
export interface MemberSpawnExtras {
  agent?: string;
  requirePlanApproval?: PlanApprovalPolicy;
  /** `"planning"` for a plan-mode member; pair it with `hold` so the dispatcher skips it. */
  planApproval?: PlanApprovalState;
  hold?: string;
}

export interface SpawnResolveInput {
  /** `undefined` while a plain session's `TeammateSpawn` is about to create its team implicitly. */
  team: Team | undefined;
  /** The lead session cwd (`team.leadCwd` when a team exists). */
  leadCwd: string;
  /** The parsed + bounded args (`agent` and `requirePlanApproval` included). */
  args: TeammateSpawnArgs;
  trusted?: TrustedSpawnOptions;
  source: SpawnSource;
  callerSessionId?: string;
}

/** The effective spawn: core continues with `args` (name/resume are re-pinned), plans with it, persists `member`. */
export interface SpawnResolution {
  args: TeammateSpawnArgs;
  /** Canonical thinking level passed to the host spawn (`PluginSpawnOptions.thinkingLevel`). */
  thinkingLevel?: string;
  member?: MemberSpawnExtras;
}
/** Synchronous (agent files are read before; keep it pure). An `{ok:false}` refuses the spawn before anything is created. */
export type SpawnResolver = (input: SpawnResolveInput) => OpResult<SpawnResolution>;

/** Return `true` to suppress the lead's idle notice for this settle (e.g. a member with a pending plan). */
export type IdleNoticeFilter = (team: Team, member: Member, idle: { settleId: number; finalText?: string }) => boolean;

/** What a route extension gets from core's REST scope (same limiter, error handler, visibility and control rules). */
export interface RouteHelpers {
  /** `/api/plugins/agent-teams`. */
  prefix: string;
  /** Visibility hook (fails closed). */
  visible(team: Team, req: FastifyRequest): Promise<boolean>;
  /** Owner/control rule (`canControlTeam`); `true` when no access rule is wired. */
  controllable(team: Team, req: FastifyRequest): boolean;
  /** `team` only when visible AND controllable (counts the filtered 404), else `undefined` → answer `notFound`. */
  reachable(team: Team | undefined, req: FastifyRequest): Promise<Team | undefined>;
  /** `{ config: writeLimit }` route option: the stricter write limiter. */
  writeLimit: { rateLimit: { max: number; timeWindow: number } };
  /** The one body of an unknown/invisible/not-controllable team. */
  notFound: { error: "not_found" };
  /** Limiter key (principal when known, else client address). */
  clientKey(req: FastifyRequest): string;
  /** Owner key (`ownerKeyOf`) of the request principal; `undefined` when there is none (`Team.owner` for a REST start). */
  ownerOf(req: FastifyRequest): string | undefined;
}
/** Mounts extra routes inside core's REST scope, after the core routes. Each route needs its `ROUTE_TIERS` row. */
export type RouteExtension = (scope: FastifyInstance, helpers: RouteHelpers) => void | Promise<void>;

/** Per member (not per task); any `false` skips the member (`Member.hold` is the stored reason). */
export type DispatchEligibility = (team: Team, member: Member) => boolean;

/** `GET /teams` visibility; the default is allow-all. */
export type RouteVisibility = (team: Team, req: unknown) => boolean | Promise<boolean>;

export interface ExtensionPoints {
  registerSpawnContributor(fn: SpawnContributor): void;
  registerOpGate(op: string, gate: OpGate): void;
  registerDispatchEligibility(fn: DispatchEligibility): void;
  setRouteVisibility(fn: RouteVisibility): void;
  /** Contributors run in registration order; their `reply` objects are merged in that order, the first `degraded` wins. */
  registerHelloContributor(fn: HelloContributor): void;
  /** ONE resolver (the spawn-resolve module); a second registration throws. */
  setSpawnResolver(fn: SpawnResolver): void;
  /** Any filter returning `true` suppresses the lead's idle notice. */
  registerIdleNoticeFilter(fn: IdleNoticeFilter): void;
  /** Extra REST routes mounted in core's scope (in registration order). */
  registerRoutes(fn: RouteExtension): void;
  readonly routeExtensions: readonly RouteExtension[];
  readonly helloContributors: readonly HelloContributor[];
  readonly spawnResolver: SpawnResolver | undefined;
  /** Whether a filter suppresses the lead notice for this idle. */
  suppressIdleNotice(team: Team, member: Member, idle: { settleId: number; finalText?: string }): boolean;
  readonly spawnContributors: readonly SpawnContributor[];
  gatesFor(op: string): readonly OpGate[];
  /** Whether every registered eligibility hook allows the member. */
  isEligible(team: Team, member: Member): boolean;
  readonly routeVisibility: RouteVisibility | undefined;
  /** Close registration (called on the first lane request). */
  seal(): void;
  readonly sealed: boolean;
}

export function createExtensionPoints(): ExtensionPoints {
  const contributors: SpawnContributor[] = [];
  const gates = new Map<string, OpGate[]>();
  const eligibility: DispatchEligibility[] = [];
  const helloContribs: HelloContributor[] = [];
  const idleFilters: IdleNoticeFilter[] = [];
  const routeExts: RouteExtension[] = [];
  let resolver: SpawnResolver | undefined;
  let visibility: RouteVisibility | undefined;
  let sealed = false;
  const guard = (what: string) => {
    if (sealed) throw new Error(`agent-teams: ${what} must be registered before the first request`);
  };
  return {
    registerSpawnContributor(fn) {
      guard("a spawn contributor");
      contributors.push(fn);
    },
    registerOpGate(op, gate) {
      guard("an op gate");
      const list = gates.get(op) ?? [];
      list.push(gate);
      gates.set(op, list);
    },
    registerDispatchEligibility(fn) {
      guard("a dispatch eligibility hook");
      eligibility.push(fn);
    },
    setRouteVisibility(fn) {
      guard("the route visibility hook");
      visibility = fn;
    },
    registerHelloContributor(fn) {
      guard("a hello contributor");
      helloContribs.push(fn);
    },
    setSpawnResolver(fn) {
      guard("the spawn resolver");
      if (resolver) throw new Error("agent-teams: a spawn resolver is already registered");
      resolver = fn;
    },
    registerIdleNoticeFilter(fn) {
      guard("an idle notice filter");
      idleFilters.push(fn);
    },
    registerRoutes(fn) {
      guard("a route extension");
      routeExts.push(fn);
    },
    get routeExtensions() {
      return routeExts;
    },
    get helloContributors() {
      return helloContribs;
    },
    get spawnResolver() {
      return resolver;
    },
    suppressIdleNotice(team, member, idle) {
      return idleFilters.some((fn) => {
        try {
          return fn(team, member, idle) === true;
        } catch {
          return false;
        }
      });
    },
    get spawnContributors() {
      return contributors;
    },
    gatesFor: (op) => gates.get(op) ?? [],
    isEligible: (team, member) => eligibility.every((fn) => fn(team, member)),
    get routeVisibility() {
      return visibility;
    },
    seal() {
      sealed = true;
    },
    get sealed() {
      return sealed;
    },
  };
}

/** Process-wide registry later changes register on; the plugin composition uses it by default. */
export const extensionPoints: ExtensionPoints = createExtensionPoints();
export const registerSpawnContributor = (fn: SpawnContributor): void => extensionPoints.registerSpawnContributor(fn);
export const registerOpGate = (op: string, gate: OpGate): void => extensionPoints.registerOpGate(op, gate);
export const registerDispatchEligibility = (fn: DispatchEligibility): void => extensionPoints.registerDispatchEligibility(fn);
export const setRouteVisibility = (fn: RouteVisibility): void => extensionPoints.setRouteVisibility(fn);
export const registerRoutes = (fn: RouteExtension): void => extensionPoints.registerRoutes(fn);
export const registerHelloContributor = (fn: HelloContributor): void => extensionPoints.registerHelloContributor(fn);
export const setSpawnResolver = (fn: SpawnResolver): void => extensionPoints.setSpawnResolver(fn);
export const registerIdleNoticeFilter = (fn: IdleNoticeFilter): void => extensionPoints.registerIdleNoticeFilter(fn);

function intersect(base: readonly string[] | undefined, narrow: readonly string[] | undefined): string[] | undefined {
  if (narrow === undefined) return base ? [...base] : undefined;
  if (base === undefined) return [...narrow];
  const allowed = new Set(base);
  return narrow.filter((x) => allowed.has(x));
}

/**
 * Apply contributors to a resolved spec: `tools`/`skills` are INTERSECTED (narrow
 * only — widening is dropped), prompt files and env keys are appended, a
 * contributor `cwd` is ignored and logged once. A throwing contributor is
 * skipped. The returned spec is always re-validated by the server afterwards.
 */
export function applySpawnContributors(
  spec: ResolvedSpawnSpec,
  contributors: readonly SpawnContributor[],
  ctx: { team: Team; member: Member; logger: Logger },
): ResolvedSpawnSpec {
  const out: ResolvedSpawnSpec = {
    ...spec,
    promptFiles: [...spec.promptFiles],
    env: { ...spec.env },
  };
  let cwdLogged = false;
  for (const fn of contributors) {
    let c: SpawnContribution | undefined;
    try {
      c = fn({ team: ctx.team, member: ctx.member, spec: out });
    } catch (err) {
      if (err instanceof SpawnContributorError) throw err;
      ctx.logger.error(`agent-teams: spawn contributor threw: ${(err as Error).message}`);
      continue;
    }
    if (!c) continue;
    if (c.cwd !== undefined && !cwdLogged) {
      cwdLogged = true;
      ctx.logger.warn("agent-teams: a spawn contributor tried to change cwd; ignored");
    }
    const tools = intersect(out.tools, c.tools);
    if (tools !== undefined) out.tools = tools;
    const skills = intersect(out.skills, c.skills);
    if (skills !== undefined) out.skills = skills;
    if (c.promptFiles) out.promptFiles.push(...c.promptFiles.filter((p) => !out.promptFiles.includes(p)));
    if (c.env) for (const [k, v] of Object.entries(c.env)) if (!(k in out.env)) out.env[k] = v;
  }
  return out;
}

/** Outcome of the gate pipeline: `veto` carries the gate's own block (code/feedback/afterBlock), `failed` a throw/timeout/budget. */
export type GateOutcome =
  | { kind: "pass" }
  | { kind: "veto"; veto: OpGateBlock; refusal: OpResult<never> }
  | { kind: "failed"; refusal: OpResult<never> };

interface GateClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

/**
 * Run the gates registered for an op in registration order under ONE shared
 * budget (`budgetMs`, total — not per gate). The first veto wins; a gate that
 * throws or exhausts the budget `failed`s (fail-closed for task ops via
 * `runOpGates`; the idle path treats it as fail-open).
 */
export async function runOpGatePipeline(gates: readonly OpGate[], input: OpGateInput, budgetMs: number, clock: GateClock): Promise<GateOutcome> {
  if (gates.length === 0) return { kind: "pass" };
  const deadline = clock.now() + budgetMs;
  for (const gate of gates) {
    const remaining = deadline - clock.now();
    if (remaining <= 0) return { kind: "failed", refusal: { ok: false, error: "op_blocked", message: "op gate budget exhausted" } };
    let timer: unknown;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = clock.setTimeout(() => resolve("timeout"), remaining);
    });
    try {
      const res = await Promise.race([Promise.resolve(gate(input)), timeout]);
      if (res === "timeout") return { kind: "failed", refusal: { ok: false, error: "op_blocked", message: "op gate timed out" } };
      if (res && (res as { block?: boolean }).block) {
        const veto = res as OpGateBlock;
        return { kind: "veto", veto, refusal: { ok: false, error: veto.code ?? "op_blocked", message: veto.feedback } };
      }
    } catch (err) {
      return { kind: "failed", refusal: { ok: false, error: "op_blocked", message: `op gate failed: ${(err as Error).message}` } };
    } finally {
      clock.clearTimeout(timer);
    }
  }
  return { kind: "pass" };
}

/**
 * `runOpGatePipeline` mapped to a refusal: a veto answers with its own `code` (default
 * `op_blocked`) and `feedback` as `message`; a throw, timeout or exhausted budget answers
 * `op_blocked`. `ops.callAsync` runs it for `TaskCreate` / `TaskUpdate{completed}` only when a
 * gate is registered, so with empty registries core ops never await it.
 */
export async function runOpGates(gates: readonly OpGate[], input: OpGateInput, budgetMs: number, clock: GateClock): Promise<OpResult<never> | undefined> {
  const out = await runOpGatePipeline(gates, input, budgetMs, clock);
  return out.kind === "pass" ? undefined : out.refusal;
}
