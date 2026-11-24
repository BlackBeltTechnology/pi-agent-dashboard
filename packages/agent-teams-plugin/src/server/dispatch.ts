/**
 * Dispatcher (tasks 4.6–4.7, design D8): for each member that is eligible — team
 * `active`, member `idle`, not on hold or degraded, owning no `in_progress` task,
 * every registered eligibility hook agrees — claim (1) its lowest-id pending
 * OWNED unblocked task, else (2) the lowest-id unowned unblocked task (unless
 * `autoDispatch` is off), then push the FULL task as a waking `task_assigned`
 * mail. The claim is the same synchronous store check-and-set as a member claim.
 * Runs on settle, `TaskCreate`, unblock, owner assignment, hello and lead re-bind.
 * See change: add-agent-teams-core.
 */
import type { Mail, Member, Task, Team } from "../shared/types.js";
import type { ConfigReader } from "./config.js";
import { compareTaskIds } from "./op-util.js";
import type { TeamStore } from "./store.js";
import { assignmentText } from "./tasks.js";
import type { Telemetry } from "./telemetry.js";

export interface DispatcherDeps {
  store: TeamStore;
  config: ConfigReader;
  telemetry: Telemetry;
  /** Team `active`, member idle/not held/not degraded/no in_progress, hooks agree (ops-owned predicate). */
  isEligible(team: Team, member: Member): boolean;
  /** Append a mail and try to deliver it (ops `mailTo`). */
  mailTo(team: Team, to: string, input: { from: string; kind: string; text: string; wake: boolean; details?: Record<string, unknown> }): Mail | undefined;
  /** A claim committed (pair counters reset). */
  onClaim(team: Team): void;
}

export function createDispatcher(deps: DispatcherDeps) {
  const { store, config } = deps;

  function autoDispatch(team: Team): boolean {
    return team.overrides?.autoDispatch ?? config().autoDispatch;
  }

  function nextFor(team: Team, member: Member): { task: Task; preOwned: boolean } | undefined {
    const open = team.tasks.filter((t) => t.status === "pending" && !store.isBlocked(team, t)).sort((a, b) => compareTaskIds(a.id, b.id));
    const owned = open.find((t) => t.owner === member.name);
    if (owned) return { task: owned, preOwned: true };
    if (!autoDispatch(team)) return undefined;
    const free = open.find((t) => t.owner === undefined);
    return free ? { task: free, preOwned: false } : undefined;
  }

  /** Claim the next task for one member; returns it when a claim happened. */
  function dispatchMember(team: Team, member: Member): Task | undefined {
    if (!deps.isEligible(team, member)) return undefined;
    const next = nextFor(team, member);
    if (!next) return undefined;
    const claimed = store.patchTask(team.id, next.task.id, { status: "in_progress", owner: member.name });
    if (!claimed) return undefined;
    deps.telemetry.count(team.id, "claims");
    deps.telemetry.log("claim", team.id, { task: claimed.id, by: member.name, dispatched: true });
    deps.onClaim(team);
    deps.mailTo(team, member.name, {
      from: "server",
      kind: "task_assigned",
      text: assignmentText(store, team, claimed, config().maxResultChars),
      wake: true,
      details: { taskId: claimed.id, preOwned: next.preOwned },
    });
    return claimed;
  }

  /** One pass over the team; returns how many tasks were dispatched. */
  function run(team: Team): number {
    if (team.status !== "active") return 0;
    let n = 0;
    for (const member of [...team.members]) if (dispatchMember(team, member)) n++;
    return n;
  }

  return { run, dispatchMember };
}
