/**
 * The two user controls (design D8): thin wrappers over core's actor operations
 * with actor `user`. They never call a host abort/shutdown themselves.
 *
 *  - `stopMember`: pre-checks the store (core would let an `idle` member with a
 *    live socket through, and conflates "no socket" with "host refused"), calls
 *    `abortMember(..., {actor:"user", notify:false})`, then queues the ONE waking
 *    lead notice itself — member plus the ids (never titles) of the tasks it
 *    still owns. Tasks stay `in_progress`; the member is not woken.
 *  - `shutdownTeam`: `teamDelete(..., {actor:"user", force:true})`; answers 202
 *    as soon as the team is `closing` without waiting out the grace; a repeat
 *    never reaches `teamDelete` again (core would re-post member mails).
 * Pure decisions: no HTTP, no logging (the route logs the outcome with ids only).
 * See change: add-agent-teams-ui (review-gate F1–F4).
 */
import type { Clock } from "../shared/clock.js";
import type { Team } from "../shared/types.js";
import type { ShutdownTeamResponse, StopMemberResponse, UiErrorBody } from "../shared/ui-protocol.js";
import { compareTaskIds } from "./op-util.js";
import type { Ops } from "./ops.js";
import type { TeamStore } from "./store.js";

/** At most this many task ids are named in the stop notice, then "+N more". */
const STOP_NOTICE_MAX_IDS = 10;
/** A busy member whose abort has not led to a settle after this long can be stopped again. */
const STOP_PENDING_MS = 15_000;
/** The lead notice after a user shutdown (non-waking, no member names). */
const SHUTDOWN_NOTICE_TEXT = "team shut down by the user";

type StopOutcome = "ok" | "repeat" | "not_busy" | "not_connected" | "team_closed" | "not_found";
type ShutdownOutcome = "ok" | "repeat" | "team_closed";

type ActionResult<T, O extends string> = { status: 200 | 202; body: T; outcome: O } | { status: 404 | 409; body: UiErrorBody; outcome: O };

export interface UserActions {
  stopMember(team: Team, name: string): ActionResult<StopMemberResponse, StopOutcome>;
  shutdownTeam(team: Team): Promise<ActionResult<ShutdownTeamResponse, ShutdownOutcome>>;
  dispose(): void;
}

export interface UserActionsDeps {
  store: TeamStore;
  ops: Pick<Ops, "abortMember" | "teamDelete" | "enqueueLeadNotice">;
  clock: Clock;
}

const fail = <O extends string>(status: 404 | 409, error: UiErrorBody["error"], outcome: O): ActionResult<never, O> => ({ status, body: { error }, outcome });

/** `alice was stopped by the user and still owns #3, #5` — ids only, numeric order, capped. */
function stopNoticeText(team: Team, name: string): string {
  const ids = team.tasks
    .filter((t) => t.owner === name && t.status !== "completed")
    .map((t) => t.id)
    .sort(compareTaskIds);
  const shown = ids.slice(0, STOP_NOTICE_MAX_IDS).map((id) => `#${id}`);
  const more = ids.length - shown.length;
  const owns = shown.length === 0 ? "" : ` and still owns ${shown.join(", ")}${more > 0 ? `, +${more} more` : ""}`;
  return `${name} was stopped by the user${owns}`;
}

export function createUserActions(deps: UserActionsDeps): UserActions {
  const { store, clock } = deps;
  /** `teamId\0member` → when the abort was dispatched; cleared when the member leaves `busy` or the team closes. */
  const pendingStops = new Map<string, number>();
  const inflightShutdowns = new Map<string, Promise<ActionResult<ShutdownTeamResponse, ShutdownOutcome>>>();
  const key = (teamId: string, name: string): string => `${teamId}\u0000${name}`;

  const offStatus = store.on("member_status", ({ team, member, to }) => {
    if (to !== "busy") pendingStops.delete(key(team.id, member.name));
  });
  const offClosed = store.on("team_closed", ({ team }) => {
    for (const k of pendingStops.keys()) if (k.startsWith(`${team.id}\u0000`)) pendingStops.delete(k);
  });

  /** Store pre-checks (core would let an `idle` member with a live socket through): a failure, or the busy member. */
  function stopPrecheck(team: Team, name: string): ActionResult<never, StopOutcome> | undefined {
    if (team.status === "closing" || team.status === "closed") return fail(409, "team_closed", "team_closed");
    const member = store.member(team, name);
    if (!member) return fail(404, "not_found", "not_found");
    if (member.status === "disconnected") return fail(409, "not_connected", "not_connected");
    if (member.status !== "busy") return fail(409, "not_busy", "not_busy");
    return undefined;
  }

  /** Core's refusal of `abortMember` mapped to the UI codes. */
  function abortRefusal(error: string): ActionResult<never, StopOutcome> {
    if (error === "unknown_recipient") return fail(404, "not_found", "not_found");
    if (error === "member_gone") return fail(409, "not_busy", "not_busy");
    return fail(409, "not_connected", "not_connected"); // interrupt_unavailable (and anything else): the abort was not dispatched
  }

  function stopMember(team: Team, name: string): ActionResult<StopMemberResponse, StopOutcome> {
    const refused = stopPrecheck(team, name);
    if (refused) return refused;
    const pendingSince = pendingStops.get(key(team.id, name));
    if (pendingSince !== undefined && clock.now() - pendingSince < STOP_PENDING_MS) return { status: 200, body: { aborted: true }, outcome: "repeat" };

    const res = deps.ops.abortMember(team, name, { actor: "user", notify: false });
    if (!res.ok) return abortRefusal(res.error);
    pendingStops.set(key(team.id, name), clock.now());
    deps.ops.enqueueLeadNotice(team, { text: stopNoticeText(team, name), wake: true, coalesce: true });
    return { status: 200, body: { aborted: true }, outcome: "ok" };
  }

  const repeat = (): ActionResult<ShutdownTeamResponse, ShutdownOutcome> => ({ status: 202, body: { closing: true }, outcome: "repeat" });

  async function shutdownTeam(team: Team): Promise<ActionResult<ShutdownTeamResponse, ShutdownOutcome>> {
    if (team.status === "closed") return fail(409, "team_closed", "team_closed");
    if (team.status === "closing") return repeat(); // core would re-post member mails: never call it again
    if (inflightShutdowns.has(team.id)) return repeat();
    // Check-and-set: nothing awaits between the checks above and the registration below.
    const run = (async (): Promise<ActionResult<ShutdownTeamResponse, ShutdownOutcome>> => {
      // Before the delete: a team without live members closes at once and refuses mail afterwards.
      deps.ops.enqueueLeadNotice(team, { text: SHUTDOWN_NOTICE_TEXT, wake: false });
      const res = await deps.ops.teamDelete(team, { actor: "user", force: true });
      if (!res.ok) return fail(409, "team_closed", "team_closed");
      return { status: 202, body: { closing: true }, outcome: "ok" };
    })();
    inflightShutdowns.set(team.id, run);
    const done = (): void => void inflightShutdowns.delete(team.id);
    run.then(done, done);
    return run;
  }

  return {
    stopMember,
    shutdownTeam,
    dispose() {
      offStatus();
      offClosed();
      pendingStops.clear();
      inflightShutdowns.clear();
    },
  };
}
