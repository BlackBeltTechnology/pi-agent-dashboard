/**
 * Profile registry and the SHARED part of preflight (design D1/D2). A profile is selected by template NAME
 * and only when the resolved source is `bundled`; a shadowing project/user template runs as a plain
 * template (no preflight, no seed). Preflight runs inside `team.start` before anything exists and evaluates
 * its checks in ONE fixed precedence (first failing check wins):
 *
 *   invalid_args → project_untrusted → profile_unavailable → invalid_config →
 *   [stage resolve: group_* / groups_invalid / change_unknown / tasks_unreadable] → [repo_root: lead_not_repo_root] →
 *   [batch: batch_runner_active] → [skills: ship_skill_missing / review_skill_missing] → [base: base_not_found] →
 *   [limits: too_many_tasks] → [nothing: nothing_to_do] → [in_use: change_in_use]
 *
 * The kind implementations (`group`, `apply`) only supply the bracketed stage checks and `plan`; this module
 * owns the order, so no kind can reorder it. `plan` returns the SNAPSHOT the seed consumes: the seed never
 * reads a repository file again.
 * See change: add-agent-teams-openspec.
 */
import fs from "node:fs";
import path from "node:path";
import { type OpenspecProfileKind, profileKindOfTemplate } from "../../shared/openspec-profile.js";
import type { Team } from "../../shared/types.js";
import type { TeamsConfig } from "../config.js";
import { createSpawnPlanner } from "../spawn.js";
import type { StartProfile } from "../start-profiles.js";
import { entryExists, resolveSourceDir } from "../template-fs.js";
import type { TemplatesHooksDeps } from "../templates-hooks.js";
import type { OpenspecConfig } from "./config.js";
import type { InjectFn } from "./inject.js";
import { isChangeName, MAX_NAME_CHARS } from "./inputs.js";
import { OPENSPEC_COUNTERS, type OpenspecLog } from "./log.js";
import { type SeedOutcome, type SeedPlan, seedCore } from "./seed-core.js";
import type { SidecarData, SidecarInit, SidecarStore } from "./sidecar.js";

export const TRUST_CHECK_TIMEOUT_MS = 2000;
const PLAN_TTL_MS = 10 * 60_000;
const PLAN_MAX_ENTRIES = 50;

/** A typed refusal; `error` is one of the spec's start codes (kept a string: later codes pass through verbatim). */
export interface Refusal {
  error: string;
  message?: string;
  details?: Record<string, unknown>;
}

/** The profile-specific checks, in their fixed precedence (after the four shared checks). */
export const PREFLIGHT_STAGES = ["resolve", "repo_root", "batch", "skills", "base", "limits", "nothing", "in_use"] as const;
export type PreflightStage = (typeof PREFLIGHT_STAGES)[number];

export interface PreflightCtx {
  kind: OpenspecProfileKind;
  /** The normalised goal (already past the shared `invalid_args` check). */
  goal: string;
  cwd: string;
  /** Validated and clamped `openspec*` config. */
  config: OpenspecConfig;
  /** Effective `maxTeammates` / `maxTasks` of the core config. */
  maxTeammates: number;
  maxTasks: number;
  api: OpenspecApi;
  /** Scratch space shared by the stages and `plan` of ONE preflight (the data they read). */
  scratch: Record<string, unknown>;
}

export type StageCheck = (ctx: PreflightCtx) => Refusal | undefined | Promise<Refusal | undefined>;

/** What a profile kind (`group` / `apply`) supplies. */
export interface OpenspecKindImpl {
  /** Syntax of the goal (default: a change name). The shared check also bounds length and control characters. */
  goalValid?(goal: string): boolean;
  /** Checks keyed by stage; a missing stage is skipped. */
  stages?: Partial<Record<PreflightStage, StageCheck>>;
  /** Build the snapshot plan once every check passed (everything read is frozen into it). */
  plan(ctx: PreflightCtx): SeedPlan | Promise<SeedPlan>;
  /** After the seed (launcher start, sync reconcile): errors are logged, never thrown into the start flow. */
  afterSeed?(input: { team: Team; plan: SeedPlan; outcome: SeedOutcome }): void | Promise<void>;
}

/** The seams the profiles consume; a missing one fails the start `profile_unavailable` (task 1.12). */
export const SEAM_NAMES = ["registerStartProfile", "requestShutdown", "registerDispatchEligibility", "sendServerMail", "enqueueLeadNotice", "TrustedSpawnOptions.cwd"] as const;
export type SeamName = (typeof SEAM_NAMES)[number];

/** Handle the slices (group / apply / lock / launcher / sync) code against. Built by `initOpenspec`. */
export interface OpenspecApi {
  readonly deps: TemplatesHooksDeps;
  readonly log: OpenspecLog;
  readonly sidecar: SidecarStore;
  /** Loopback REST to the dashboard's own routes (git worktree, openspec tasks); absent when the host exposes no fastify. */
  readonly inject?: InjectFn;
  /** Validated config of this call (`invalid_config` result when a name/ref is bad). */
  config(opts?: { effectiveMaxTeammates?: number }): import("./config.js").OpenspecConfigResult;
  /** Register the implementation of one kind; returns a disposer. A second registration replaces the first. */
  registerOpenspecProfile(kind: OpenspecProfileKind, impl: OpenspecKindImpl): () => void;
  /** The kind implementation (undefined until its slice registered it). */
  kindImpl(kind: OpenspecProfileKind): OpenspecKindImpl | undefined;
  /** `group`/`apply` for a team started from the bundled template of that name, else `undefined`. */
  profileOf(team: Team): OpenspecProfileKind | undefined;
  /** Gate for launcher / sync / lock / guards: only `active` teams run profile machinery. */
  teamState(team: Team): TeamProfileState;
  /** Seams that failed the init self-check. */
  unavailableSeams(): readonly SeamName[];
  /** Strict-`true` trust check with a 2 s fail-closed bound. */
  isTrusted(cwd: string): Promise<boolean>;
  /** Skill resolution through the host; `resolver_unavailable` when it cannot answer. */
  skillStatus(name: string, cwd: string): Promise<"found" | "missing" | "resolver_unavailable">;
  /** Isolated store listener: a sync throw or an async rejection is logged once per event name and never reaches the store. */
  onStoreEvent<E extends keyof import("../store.js").StoreEventMap>(event: E, fn: (e: import("../store.js").StoreEventMap[E]) => void | Promise<void>): () => void;
  /** Run `fn` when the runtime is disposed. */
  onDispose(fn: () => void): void;
}

/**
 * `inactive`: not a profile team. `pending`: profile team, not seeded yet. `active`: seeded and the sidecar is
 * usable. `seed_incomplete` / `sidecar_missing`: launcher, sync and lock stay off.
 */
export type TeamProfileState = "inactive" | "pending" | "active" | "seed_incomplete" | "sidecar_missing";

// ── helpers ───────────────────────────────────────────────────────────────────

const refuse = (r: Refusal): { ok: false } & Refusal => ({ ok: false, ...r });

/** A goal is rejected before anything is read: empty, over 64 code points, control characters, surrounding space. */
function goalShapeOk(goal: unknown): goal is string {
  if (typeof goal !== "string" || goal === "" || goal !== goal.trim()) return false;
  let n = 0;
  for (const ch of goal) {
    const c = ch.codePointAt(0) as number;
    if (c < 0x20 || c === 0x7f || (c >= 0x80 && c <= 0x9f)) return false;
    if (++n > MAX_NAME_CHARS) return false;
  }
  return true;
}

/** Whether a project or user template of this name would shadow the bundled one (such a start is plain). */
export function isShadowed(deps: TemplatesHooksDeps, name: string, cwd: string): boolean {
  const file = `${name}.md`;
  try {
    const trusted = deps.host.isProjectTrusted(cwd) === true;
    if (trusted) {
      const proj = resolveSourceDir(cwd, path.join(".pi", "teams"));
      if (proj.ok && entryExists(proj.dir, file)) return true;
    }
    const user = resolveSourceDir(deps.host.resolvePiAgentDir(), "teams");
    if (user.ok && entryExists(user.dir, file)) return true;
  } catch {
    return false;
  }
  return false;
}

/** The seams that are NOT usable. `probes` overrides single answers (tests). */
export function selfCheckSeams(deps: Pick<TemplatesHooksDeps, "ops" | "ext">, probes: Partial<Record<SeamName, boolean>> = {}): SeamName[] {
  const fnOf = (v: unknown): boolean => typeof v === "function";
  const detected: Record<SeamName, boolean> = {
    registerStartProfile: true, // imported statically; probes can still simulate its absence
    requestShutdown: fnOf((deps.ops as { requestShutdown?: unknown }).requestShutdown),
    registerDispatchEligibility: fnOf((deps.ext as { registerDispatchEligibility?: unknown }).registerDispatchEligibility),
    sendServerMail: fnOf((deps.ops as { sendServerMail?: unknown }).sendServerMail),
    enqueueLeadNotice: fnOf((deps.ops as { enqueueLeadNotice?: unknown }).enqueueLeadNotice),
    "TrustedSpawnOptions.cwd": probeTrustedCwd(),
  };
  return SEAM_NAMES.filter((s) => (probes[s] ?? detected[s]) !== true);
}

/** Does the spawn planner honour `TrustedSpawnOptions.cwd` (a worktree path outside confinement)? */
function probeTrustedCwd(): boolean {
  try {
    const out = createSpawnPlanner({}).prepare({ leadCwd: "/probe-lead", args: { name: "probe", prompt: "p" }, trusted: { cwd: "/probe-worktree" }, config: { extraCwdRoots: [] } as unknown as TeamsConfig });
    return out.ok && out.data.cwd === "/probe-worktree";
  } catch {
    return false;
  }
}

/**
 * Pending-plan registry: the changes a successful preflight snapshot is about to seed. A started team has no
 * sidecar (and no refs) until its lead binds and the seed runs, so without this a second start in that window
 * would pass `change_in_use`. A claim ends when the seed takes its snapshot (the sidecar owns the change from
 * there) or after `PENDING_CLAIM_TTL_MS`: a start that never binds (or failed after preflight) must not block
 * the changes for good, and a lead that binds later than that re-opens the window (accepted, the harm is a
 * second team on the same change, never a lost one). Per runtime: keyed by its sidecar store.
 */
export const PENDING_CLAIM_TTL_MS = 60_000;
interface PendingClaim {
  repo: string;
  changes: readonly string[];
  at: number;
}
const pendingByStore = new WeakMap<object, Set<PendingClaim>>();

function freshClaims(api: Pick<OpenspecApi, "sidecar" | "deps">): Set<PendingClaim> {
  let set = pendingByStore.get(api.sidecar);
  if (!set) pendingByStore.set(api.sidecar, (set = new Set()));
  const now = api.deps.clock.now();
  for (const c of set) if (now - c.at >= PENDING_CLAIM_TTL_MS) set.delete(c);
  return set;
}

/** Number of live pending claims (tests). */
export const pendingClaimCount = (api: Pick<OpenspecApi, "sidecar" | "deps">): number => freshClaims(api).size;

/** The changes one sidecar record drives: the apply goal, or the group's refs (the change name, or `{kind:"group", change}` as the group seed writes). */
function changesOfRecord(d: Readonly<SidecarData>): string[] {
  if (d.kind === "apply") return [d.goal];
  const out: string[] = [];
  for (const v of Object.values(d.refs)) {
    const change = typeof v === "string" ? v : (v as { change?: unknown } | null)?.change;
    if (typeof change === "string") out.push(change);
  }
  return out;
}

/** `git`-free: change names currently driven by an ACTIVE profile team of the same repo (sidecars) or claimed by a pending preflight snapshot. */
export function changesInUse(api: Pick<OpenspecApi, "sidecar" | "deps">, repo: string): Set<string> {
  const out = new Set<string>();
  const realRepo = safeRealpath(repo);
  for (const c of freshClaims(api)) if (c.repo === realRepo) for (const change of c.changes) out.add(change);
  for (const id of api.sidecar.ids()) {
    const team = api.deps.store.get(id);
    const d = api.sidecar.get(id);
    if (!team || team.status === "closed" || !d || d.lost || safeRealpath(d.repo) !== realRepo) continue;
    for (const change of changesOfRecord(d)) out.add(change);
  }
  return out;
}

export function safeRealpath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * The `skills` stage check kind implementations share: the skill must resolve through the host. A missing
 * skill is `ship_skill_missing` (group) / `review_skill_missing` (apply); a resolver that is absent or throws
 * fails closed with the same code and `details.detail = "resolver_unavailable"`.
 */
export async function checkSkillStage(api: Pick<OpenspecApi, "skillStatus">, which: "ship" | "review", skill: string, cwd: string): Promise<Refusal | undefined> {
  const error = which === "ship" ? "ship_skill_missing" : "review_skill_missing";
  const status = await api.skillStatus(skill, cwd);
  if (status === "found") return undefined;
  return status === "missing"
    ? { error, message: `the skill "${skill}" was not found`, details: { skill } }
    : { error, message: `the skill "${skill}" could not be checked`, details: { skill, detail: "resolver_unavailable" } };
}

// ── preflight ─────────────────────────────────────────────────────────────────

export type PreflightResult = { ok: true; plan: SeedPlan } | ({ ok: false } & Refusal);

/** The four shared checks in their fixed order; a refusal, or the context the stage checks run with. */
async function sharedChecks(api: OpenspecApi, kind: OpenspecProfileKind, impl: OpenspecKindImpl | undefined, goal: string, cwd: string): Promise<Refusal | PreflightCtx> {
  const goalOk = goalShapeOk(goal) && (impl?.goalValid ? impl.goalValid(goal) : isChangeName(goal));
  if (!goalOk) return { error: "invalid_args", message: `the goal must be a ${kind === "group" ? "group id or name" : "change name"} of at most ${MAX_NAME_CHARS} characters` };
  if (!(await api.isTrusted(cwd))) return { error: "project_untrusted", message: "profile templates need a trusted project" };
  const seams = api.unavailableSeams();
  if (!impl || seams.length > 0) {
    return { error: "profile_unavailable", message: "the OpenSpec profile is not available on this server", details: { missing: impl ? [...seams] : [`profile:${kind}`, ...seams] } };
  }
  const cfg = api.deps.config();
  const resolved = api.config({ effectiveMaxTeammates: cfg.maxTeammates });
  if (!resolved.ok) return { error: "invalid_config", message: resolved.message, details: { key: resolved.key } };
  return { kind, goal, cwd, config: resolved.config, maxTeammates: cfg.maxTeammates, maxTasks: cfg.maxTasks, api, scratch: {} };
}

/**
 * The fixed-precedence preflight of one profile start. `impl` undefined (slice not installed) ⇒
 * `profile_unavailable`. Nothing outside the goal string is touched before `invalid_args` and the trust
 * check pass.
 */
export async function runPreflight(api: OpenspecApi, kind: OpenspecProfileKind, goal: string, cwd: string): Promise<PreflightResult> {
  const impl = api.kindImpl(kind);
  const ctx = await sharedChecks(api, kind, impl, goal, cwd);
  if ("error" in ctx) return refuse(ctx);
  for (const stage of PREFLIGHT_STAGES) {
    const verdict = await impl?.stages?.[stage]?.(ctx);
    if (verdict) return refuse(verdict);
  }
  return { ok: true, plan: await (impl as OpenspecKindImpl).plan(ctx) };
}

// ── start-profile glue ────────────────────────────────────────────────────────

interface StoredPlan {
  plan: SeedPlan;
  kind: OpenspecProfileKind;
  at: number;
  claim: PendingClaim;
}

/** Build the `StartProfile` registered under a bundled template name (`preflight` + `seed`). */
export function createStartProfile(api: OpenspecApi, name: string): StartProfile {
  const kind = profileKindOfTemplate(name) as OpenspecProfileKind;
  const plans = new Map<string, StoredPlan[]>();
  const keyOf = (goal: string, cwd: string): string => `${cwd}\u0000${goal}`;
  const { clock } = api.deps;

  const remember = (goal: string, cwd: string, plan: SeedPlan): void => {
    const now = clock.now();
    for (const [k, list] of plans) {
      const fresh = list.filter((p) => now - p.at < PLAN_TTL_MS);
      if (fresh.length === 0) plans.delete(k);
      else plans.set(k, fresh);
    }
    while (plans.size >= PLAN_MAX_ENTRIES) plans.delete(plans.keys().next().value as string);
    const k = keyOf(goal, cwd);
    // apply claims its goal change; a group claims every change it seeds (the task keys are the change names)
    const claim: PendingClaim = { repo: safeRealpath(cwd), changes: kind === "apply" ? [goal] : plan.tasks.map((t) => t.key), at: now };
    freshClaims(api).add(claim);
    plans.set(k, [...(plans.get(k) ?? []), { plan, kind, at: now, claim }]);
  };
  const take = (goal: string, cwd: string): SeedPlan | undefined => {
    const k = keyOf(goal, cwd);
    const list = plans.get(k);
    const next = list?.shift();
    if (list && list.length === 0) plans.delete(k);
    if (next) freshClaims(api).delete(next.claim); // the seed owns the change from here (its sidecar record)
    return next && clock.now() - next.at < PLAN_TTL_MS ? next.plan : undefined;
  };

  return {
    async preflight(goal, cwd) {
      if (isShadowed(api.deps, name, cwd)) return { ok: true }; // a project/user template of this name is a plain template
      const res = await runPreflight(api, kind, goal, cwd);
      if (!res.ok) {
        api.log.record("info", "preflight_refused", OPENSPEC_COUNTERS.preflightRefused, undefined, { template: name, code: res.error });
        return { ok: false, error: res.error, ...(res.message !== undefined ? { message: res.message } : {}), ...(res.details ? { details: res.details } : {}) };
      }
      remember(goal, cwd, res.plan);
      return { ok: true };
    },
    async seed(team) {
      const snap = team.template;
      if (snap?.source !== "bundled" || snap.name !== name) return; // shadowing template: plain team
      const init: SidecarInit = { teamId: team.id, kind, goal: snap.goal, repo: safeRealpath(team.leadCwd) };
      const plan = take(snap.goal, team.leadCwd);
      const impl = api.kindImpl(kind);
      // A second call (rebind, racing path) finds the record and the consumed snapshot: nothing to do, never a plan_missing verdict.
      if (!plan && api.sidecar.has(team.id)) return;
      if (!plan || !impl) {
        // The snapshot is gone (restart between preflight and bind): never read the repo again, never seed blind.
        api.sidecar.create(init, (d) => {
          d.seedIncomplete = { code: "plan_missing" };
          d.noticed.seed_incomplete = true;
        });
        api.log.record("error", "seed_incomplete", OPENSPEC_COUNTERS.seedIncomplete, team.id, { code: "plan_missing" });
        api.deps.ops.enqueueLeadNotice(team, { text: "OpenSpec seed incomplete (plan_missing): no tasks were created and no launcher or checkbox sync runs for this team.", wake: true });
        return;
      }
      const outcome = seedCore({ ops: api.deps.ops, sidecar: api.sidecar, log: api.log, clock }, team, init, plan);
      if (outcome.status === "refused") throw new Error(outcome.error);
      try {
        await impl.afterSeed?.({ team, plan, outcome });
      } catch (err) {
        api.log.event("error", "after_seed_failed", team.id, { error: (err as Error).name });
      }
    },
  };
}
