/**
 * Composition root of the OpenSpec profiles (design D1-D3): `initOpenspec(deps, opts)` wires the foundation
 * once per runtime —
 *  - the `bundled` template source and the two start profiles (`openspec-group`, `openspec-apply`),
 *  - the sidecar store (loaded, reconciled, pruned),
 *  - the validated config reader and the structured log/counters,
 *  - the spawn contributor (env `PI_EXT_AGENT_TEAMS_OPENSPEC_PROFILE`) for members of a profile team,
 *  - the init self-check of the seams it consumes (missing ⇒ templates stay listed, a start fails
 *    `profile_unavailable` with ONE error log),
 * and then runs the slice registrations of `slices.ts` with the returned `OpenspecApi`.
 * It touches core only through its registries and events; with no bundled template present it is inert.
 * See change: add-agent-teams-openspec.
 */
import { fileURLToPath } from "node:url";
import type { OpenspecProfileKind } from "../../shared/openspec-profile.js";
import { EXT_KEY_OPENSPEC_PROFILE, OPENSPEC_TEMPLATE_PROFILES, profileKindOfTemplate } from "../../shared/openspec-profile.js";
import type { Team } from "../../shared/types.js";
import { registerStartProfile } from "../start-profiles.js";
import type { StoreEventMap } from "../store.js";
import type { TemplatesHooksDeps } from "../templates-hooks.js";
import { registerBundledTemplates, resolveTemplatesDir } from "./bundled.js";
import { createOpenspecConfigReader, type OpenspecConfigResult } from "./config.js";
import type { InjectFn } from "./inject.js";
import { createOpenspecLog, OPENSPEC_COUNTERS } from "./log.js";
import { createStartProfile, type OpenspecApi, type OpenspecKindImpl, type SeamName, safeRealpath, selfCheckSeams, TRUST_CHECK_TIMEOUT_MS } from "./profiles.js";
import { seedIncompleteText } from "./seed-core.js";
import { createSidecarStore, type SidecarFs, type SidecarInit } from "./sidecar.js";
import { SLICES } from "./slices.js";

/** Group-member Git addendum (package `prompts/`, shipped in `files`): the module lives at `<package>/src/server/openspec/`. */
const GROUP_MEMBER_PROMPT = fileURLToPath(new URL("../../../prompts/openspec-group-member.md", import.meta.url));

export * from "./config.js";
export * from "./inputs.js";
export * from "./log.js";
export * from "./profiles.js";
export * from "./seed-core.js";
export * from "./sidecar.js";

export interface OpenspecInitOptions {
  /** Raw project-trust answer (may be async or non-boolean); default: `deps.host.isProjectTrusted`. Only strict `true` passes. */
  trust?: (cwd: string) => unknown;
  /** Skill resolver; default: core `ops.resolveSkillPaths([name], cwd)`. */
  resolveSkill?: (name: string, cwd: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Override single seam probes (tests). */
  seamProbes?: Partial<Record<SeamName, boolean>>;
  /** Directory of the bundled templates (default: the package `templates/`). */
  templatesDir?: string | undefined;
  /** Sidecar file operations (fault injection). */
  sidecarFs?: SidecarFs;
  /** Loopback REST inject (default: `createLoopbackInject(host.fastify)` wired by the runtime). */
  inject?: InjectFn;
  /** The team store is hydrated (the runtime hydrates before any registrar runs); `false` defers pruning. Default true. */
  storeHydrated?: boolean;
}

/**
 * Runtime entry: wires the module unless `opts === false`. The raw trust answer (possibly async or non-boolean)
 * comes from the consumed host service unless the runtime was given a sync `templatesHost` override; the
 * preflight treats only a strict `true` as trusted.
 */
export function initOpenspecForHost(
  deps: TemplatesHooksDeps,
  consume: (<T>(name: string) => T | undefined) | undefined,
  opts: false | OpenspecInitOptions | undefined,
  trustOverride?: (cwd: string) => unknown,
): OpenspecApi | undefined {
  if (opts === false) return undefined;
  const trust = trustOverride ?? ((cwd: string): unknown => consume?.<(c: string) => unknown>("host.isProjectTrusted")?.(cwd));
  return initOpenspec(deps, { trust, ...(opts ?? {}) });
}

/** `bundled` profile kind of a team (template source `bundled` + a registered name), else undefined. */
function profileKindOfTeam(team: Team): OpenspecProfileKind | undefined {
  const snap = team.template;
  return snap && snap.source === "bundled" ? profileKindOfTemplate(snap.name) : undefined;
}

function initOpenspec(deps: TemplatesHooksDeps, opts: OpenspecInitOptions = {}): OpenspecApi {
  const { logger, store, ext, ops } = deps;
  const log = createOpenspecLog({ logger, counters: deps.counters });
  const disposers: Array<() => void> = [];
  const onDispose = (fn: () => void): void => void disposers.push(fn);

  const sidecar = createSidecarStore({ dir: `${deps.dataDir}/openspec`, logger, ...(opts.sidecarFs ? { fs: opts.sidecarFs } : {}) });
  const readConfig = createOpenspecConfigReader(() => deps.config().openspecRaw, logger);
  const kinds = new Map<OpenspecProfileKind, OpenspecKindImpl>();
  const missingSeams = selfCheckSeams({ ops, ext }, opts.seamProbes);
  if (missingSeams.length > 0) logger.error(`agent-teams: openspec profiles unavailable, missing seams: ${missingSeams.join(", ")}`);

  const rawTrust = opts.trust ?? ((cwd: string) => deps.host.isProjectTrusted(cwd));
  const reported = new Set<string>();

  const api: OpenspecApi = {
    deps,
    log,
    sidecar,
    ...(opts.inject ? { inject: opts.inject } : {}),
    config: (o) => readConfig(o) as OpenspecConfigResult,
    registerOpenspecProfile(kind, impl) {
      kinds.set(kind, impl);
      return () => {
        if (kinds.get(kind) === impl) kinds.delete(kind);
      };
    },
    kindImpl: (kind) => kinds.get(kind),
    profileOf: profileKindOfTeam,
    teamState(team) {
      if (!profileKindOfTeam(team)) return "inactive";
      const d = sidecar.get(team.id);
      if (!d) return team.template?.seeded === true ? "sidecar_missing" : "pending";
      if (d.lost) return "sidecar_missing";
      if (d.seedIncomplete || (d.seeding && !d.seeded)) return "seed_incomplete";
      return d.seeded ? "active" : "pending";
    },
    unavailableSeams: () => missingSeams,
    async isTrusted(cwd) {
      let timer: unknown;
      const timeout = new Promise<false>((resolve) => {
        timer = deps.clock.setTimeout(() => resolve(false), TRUST_CHECK_TIMEOUT_MS);
      });
      try {
        const verdict = await Promise.race([Promise.resolve().then(() => rawTrust(cwd)), timeout]);
        return verdict === true;
      } catch {
        return false;
      } finally {
        deps.clock.clearTimeout(timer);
      }
    },
    async skillStatus(name, cwd) {
      try {
        const res = opts.resolveSkill ? await opts.resolveSkill(name, cwd) : await ops.resolveSkillPaths([name], cwd);
        if (res.ok) return "found";
        return res.error === "skill_not_found" ? "missing" : "resolver_unavailable";
      } catch {
        return "resolver_unavailable";
      }
    },
    onStoreEvent<E extends keyof StoreEventMap>(event: E, fn: (e: StoreEventMap[E]) => void | Promise<void>) {
      const off = store.on(event, (payload) => {
        const failed = (err: unknown): void => {
          const key = `${event}:${(err as Error)?.message}`;
          if (reported.has(key)) return;
          reported.add(key);
          log.event("error", "listener_failed", undefined, { event, error: (err as Error)?.name ?? "error" });
        };
        try {
          const out = fn(payload);
          if (out && typeof (out as Promise<void>).catch === "function") (out as Promise<void>).catch(failed);
        } catch (err) {
          failed(err);
        }
      });
      onDispose(off);
      return off;
    },
    onDispose,
  };

  if (ext.sealed) {
    logger.warn("agent-teams: openspec profiles not registered: extension points are already sealed");
    return api;
  }

  // bundled source + start profiles (a profile exists for the NAME; it only acts for the `bundled` source)
  const bundled = registerBundledTemplates("templatesDir" in opts ? opts.templatesDir : resolveTemplatesDir(), logger);
  onDispose(() => bundled.dispose());
  for (const name of Object.keys(OPENSPEC_TEMPLATE_PROFILES)) onDispose(registerStartProfile(name, createStartProfile(api, name)));

  // spawn contributor: the profile hint env for every member of a profile team; a group member that got the
  // per-member committer switch also gets the group addendum, appended after core's member-commit protocol so
  // its Git rule (commit, push and merge in the own worktree through the ship skill) is the last word
  ext.registerSpawnContributor(({ team, member }) => {
    const kind = api.profileOf(team);
    if (!kind) return undefined;
    const addendum = kind === "group" && member.committer === "member" ? [GROUP_MEMBER_PROMPT] : [];
    return { env: { [EXT_KEY_OPENSPEC_PROFILE]: kind }, ...(addendum.length > 0 ? { promptFiles: addendum } : {}) };
  });

  loadAndReconcile(api, opts.storeHydrated !== false);

  for (const [name, register] of SLICES) {
    try {
      register(api);
    } catch (err) {
      logger.error(`agent-teams: openspec module ${name} failed to register: ${(err as Error).message}`);
    }
  }
  deps.onDispose(() => {
    for (const fn of disposers.splice(0).reverse()) {
      try {
        fn();
      } catch (err) {
        logger.warn(`agent-teams: openspec dispose hook failed: ${(err as Error).message}`);
      }
    }
  });
  return api;
}

const LOST_TEXT = (reason: string): string =>
  `OpenSpec state of this team was lost (${reason}). The launcher, checkbox sync and resource lock are OFF for this team and nothing is relaunched; close the team or continue by hand.`;

/** A seeded live profile team whose sidecar is gone/bad: stub it `lost` (machinery off) and tell the lead once. */
function reconcileLost(api: OpenspecApi, team: Team, init: SidecarInit, reason: "missing" | "corrupt" | "future"): void {
  const res = api.sidecar.markLost(init, reason);
  api.log.record("error", "sidecar_missing", OPENSPEC_COUNTERS.sidecarMissing, team.id, { reason, persisted: res.ok });
  api.deps.ops.enqueueLeadNotice(team, { text: LOST_TEXT(reason), wake: true });
}

/** A half-done seed is `seed_incomplete` (never re-seeded); the lead hears of it once (persisted `noticed`). */
function reconcileSeed(api: OpenspecApi, team: Team): void {
  const d = api.sidecar.get(team.id);
  if (d?.seeding && !d.seeded && !d.seedIncomplete) api.sidecar.update(team.id, (x) => void (x.seedIncomplete = { code: "crash" }));
  const now = api.sidecar.get(team.id);
  if (!now?.seedIncomplete || !api.sidecar.noticeOnce(team.id, "seed_incomplete")) return;
  api.log.record("error", "seed_incomplete", OPENSPEC_COUNTERS.seedIncomplete, team.id, { code: now.seedIncomplete.code });
  api.deps.ops.enqueueLeadNotice(team, { text: seedIncompleteText(now.seedIncomplete.code, Object.keys(now.refs).length), wake: true });
}

function reconcileTeam(api: OpenspecApi, team: Team, kind: OpenspecProfileKind, unusable: "corrupt" | "future" | undefined): void {
  const { sidecar } = api;
  const init: SidecarInit = { teamId: team.id, kind, goal: team.template?.goal ?? "", repo: safeRealpath(team.leadCwd) };
  const reason = unusable ?? (!sidecar.has(team.id) && team.template?.seeded === true ? "missing" : undefined);
  if (reason) reconcileLost(api, team, init, reason);
  else if (sidecar.state(team.id) === "lost") {
    if (sidecar.noticeOnce(team.id, "sidecar_missing")) api.deps.ops.enqueueLeadNotice(team, { text: LOST_TEXT("lost"), wake: true });
  } else if (sidecar.has(team.id)) reconcileSeed(api, team);
}

/**
 * Startup pass over the sidecars and the live profile teams: load the files, mark a missing / corrupt /
 * future sidecar of a seeded live profile team `sidecar_missing` (never rebuilt from empty state), mark a
 * half-done seed `seed_incomplete`, tell the lead ONCE per condition (persisted `noticed`), then prune
 * sidecars of unknown or closed teams (only when the store is hydrated).
 */
function loadAndReconcile(api: OpenspecApi, hydrated: boolean): void {
  const { store } = api.deps;
  const report = api.sidecar.load();
  const bad = new Map<string, "corrupt" | "future">([...report.corrupt.map((id) => [id, "corrupt"] as const), ...report.future.map((id) => [id, "future"] as const)]);
  for (const team of store.list()) {
    const kind = profileKindOfTeam(team);
    if (kind && team.status !== "closed") reconcileTeam(api, team, kind, bad.get(team.id));
  }
  const pruned = api.sidecar.prune((id) => {
    const t = store.get(id);
    return t !== undefined && t.status !== "closed";
  }, hydrated);
  if (pruned > 0) api.log.event("info", "sidecars_pruned", undefined, { n: pruned });
}
