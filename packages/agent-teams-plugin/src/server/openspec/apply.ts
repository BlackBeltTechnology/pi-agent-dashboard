/**
 * Slice entry of the `openspec-apply` profile (`slices.ts`): registers the kind implementation
 * (`seed-apply.ts`), the reviewer dispatch rule, the `Review` owner assignment and the checkbox sync
 * (`sync.ts`). Core is touched through its registries and events only.
 *
 *  - Dispatch rule (`registerDispatchEligibility`, design D7): in an apply team the member `reviewer` is
 *    eligible only while it OWNS an unblocked pending task. Core's dispatcher hands an eligible idle member the
 *    lowest-id unowned task when it owns none, so without this rule the idle reviewer would receive an
 *    implementation task (also a late one the lead created after `Review` unblocked).
 *  - `Review` owner: core accepts an owner only when it is a live member and the roster spawns after the seed,
 *    so the seed leaves `Review` unowned and the owner is set the moment `reviewer` joins the roster
 *    (server actor; isolated store listener, deferred out of the store event).
 * See change: add-agent-teams-openspec.
 */
import type { Member, Team } from "../../shared/types.js";
import type { TeamStore } from "../store.js";
import type { OpenspecApi } from "./profiles.js";
import { createApplyKindImpl, isReviewRef, REVIEWER_NAME } from "./seed-apply.js";
import { type ApplySync, createApplySync } from "./sync.js";

/** The reviewer rule as a pure predicate (the unit under test of 7.31). `false` only for an apply-team reviewer. */
export function reviewerEligible(store: Pick<TeamStore, "isBlocked">, team: Team, member: Member, isApply: boolean): boolean {
  if (!isApply || member.name !== REVIEWER_NAME) return true;
  return team.tasks.some((t) => t.status === "pending" && t.owner === REVIEWER_NAME && !store.isBlocked(team, t));
}

const syncs = new WeakMap<OpenspecApi, ApplySync>();

/** The checkbox sync of a module handle (tests drive and await it; `undefined` before `registerApply`). */
export const applySyncOf = (api: OpenspecApi): ApplySync | undefined => syncs.get(api);

export function registerApply(api: OpenspecApi): void {
  const { deps, sidecar, log } = api;
  const { store, ops, ext } = deps;
  api.registerOpenspecProfile("apply", { ...createApplyKindImpl(api), afterSeed: ({ team }) => assignReviewOwner(team.id) });

  ext.registerDispatchEligibility((team, member) => reviewerEligible(store, team, member, api.profileOf(team) === "apply"));

  const refused = new Set<string>();
  /** The `reviewer` member when it can still take work. */
  const liveReviewer = (team: Team): Member | undefined => {
    const m = store.member(team, REVIEWER_NAME);
    return m && m.status !== "gone" && m.status !== "failed" && m.status !== "shutdown_pending" ? m : undefined;
  };
  /** Ids of the unowned pending `Review` task(s) of an apply team. */
  const unownedReviewTasks = (team: Team, refs: Readonly<Record<string, unknown>>): string[] =>
    Object.entries(refs)
      .filter(([taskId, ref]) => isReviewRef(ref) && store.task(team, taskId)?.status === "pending" && store.task(team, taskId)?.owner === undefined)
      .map(([taskId]) => taskId);

  /** Give the `Review` task to `reviewer` once that member exists; idempotent, never throws. */
  function assignReviewOwner(teamId: string): void {
    const team = store.get(teamId);
    const d = sidecar.get(teamId);
    if (team?.status !== "active" || !d || api.profileOf(team) !== "apply" || api.teamState(team) !== "active" || !liveReviewer(team)) return;
    for (const taskId of unownedReviewTasks(team, d.refs)) {
      const res = ops.updateTask(team, { id: taskId, owner: REVIEWER_NAME }, { actor: "server" });
      if (!res.ok && !refused.has(teamId)) {
        refused.add(teamId);
        log.event("warn", "review_owner_refused", teamId, { code: res.error });
      }
    }
  }

  api.onStoreEvent("change", ({ team }) => {
    if (team.status !== "active") return;
    // Deferred: the event fires inside a store mutation; the owner write is a mutation of its own.
    void Promise.resolve().then(() => assignReviewOwner(team.id));
  });

  syncs.set(api, createApplySync(api));
}
