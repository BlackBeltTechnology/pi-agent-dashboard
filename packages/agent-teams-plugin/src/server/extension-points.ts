/**
 * Typed registries later changes extend (task 2.10, design D17). Every registry
 * is EMPTY by default and inert: with nothing registered the plugin behaves as
 * the plain session-mode flow. Registration is only possible from the server
 * process before the first lane request (`seal()`), so a peer cannot extend
 * behaviour at runtime. `registerMailKind` lives in `shared/mail-format.ts`
 * (the bridge needs it too) and is re-exported here for one import surface.
 * See change: add-agent-teams-core.
 */
import type { OpResult } from "../shared/protocol.js";
import type { Committer, Member, Team } from "../shared/types.js";
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

/** An async pre-commit gate for an op; it may veto with `{block, feedback}`. */
export type OpGateResult = { block: true; feedback: string } | undefined | void;
export type OpGate = (input: { op: string; team: Team; callerName: string; args: unknown }) => Promise<OpGateResult> | OpGateResult;

/** Per member (not per task); any `false` skips the member (`Member.hold` is the stored reason). */
export type DispatchEligibility = (team: Team, member: Member) => boolean;

/** `GET /teams` visibility; the default is allow-all. */
export type RouteVisibility = (team: Team, req: unknown) => boolean | Promise<boolean>;

export interface ExtensionPoints {
  registerSpawnContributor(fn: SpawnContributor): void;
  registerOpGate(op: string, gate: OpGate): void;
  registerDispatchEligibility(fn: DispatchEligibility): void;
  setRouteVisibility(fn: RouteVisibility): void;
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

/**
 * Run the gates registered for `op` in registration order under ONE shared
 * budget (`budgetMs`, total — not per gate). The first veto wins; a gate that
 * throws or exhausts the budget blocks the op fail-closed. Absent in this change
 * (no gate registers), so core ops never await it.
 */
export async function runOpGates(
  gates: readonly OpGate[],
  input: { op: string; team: Team; callerName: string; args: unknown },
  budgetMs: number,
  clock: { now(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: unknown): void },
): Promise<OpResult<never> | undefined> {
  if (gates.length === 0) return undefined;
  const deadline = clock.now() + budgetMs;
  for (const gate of gates) {
    const remaining = deadline - clock.now();
    if (remaining <= 0) return { ok: false, error: "op_blocked", message: "op gate budget exhausted" };
    let timer: unknown;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = clock.setTimeout(() => resolve("timeout"), remaining);
    });
    try {
      const res = await Promise.race([Promise.resolve(gate(input)), timeout]);
      if (res === "timeout") return { ok: false, error: "op_blocked", message: "op gate timed out" };
      if (res && (res as { block?: boolean }).block) {
        return { ok: false, error: "op_blocked", message: (res as { feedback: string }).feedback };
      }
    } catch (err) {
      return { ok: false, error: "op_blocked", message: `op gate failed: ${(err as Error).message}` };
    } finally {
      clock.clearTimeout(timer);
    }
  }
  return undefined;
}
