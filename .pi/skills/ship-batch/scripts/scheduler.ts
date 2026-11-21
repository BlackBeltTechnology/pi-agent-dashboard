/**
 * ship-batch scheduler — PURE (no I/O). `planQueue` builds the queue from the
 * group, `nextActions` advances the per-change state machine and returns the
 * side effects the runner must execute, `settled` is the D5 settle rule,
 * `adopt` is the exact session-adoption rule (D4).
 *
 * `nextActions` applies its deterministic transitions to the passed state in
 * place (and records them in `item.history`); the runner executes the returned
 * actions and persists.
 *
 * See change: add-ship-batch-orchestrator (D2, D3, D4, D5).
 */
import { archivedChangeName } from "../../../../packages/shared/src/openspec-dependencies.ts";
import { DEFAULT_SETTLE_MS, DEFAULT_START_TIMEOUT_MS } from "./args.ts";
import {
  ACTIVE_STATES,
  type Action,
  type BatchState,
  type Item,
  type ItemState,
  isTerminal,
  nudgeText,
  type Observations,
  type Params,
  type SessionObs,
} from "./types.ts";

// ── Group resolution ────────────────────────────────────────────────

export interface GroupRef {
  id: string;
  name: string;
}

export type GroupResolution = { ok: true; group: GroupRef } | { ok: false; error: string };

/** Match by id, then case-insensitive name; unknown or ambiguous → error listing the groups. */
export function resolveGroup(groups: readonly GroupRef[], query: string): GroupResolution {
  const byId = groups.find((g) => g.id === query);
  if (byId) return { ok: true, group: byId };
  const q = query.trim().toLowerCase();
  const byName = groups.filter((g) => g.name.trim().toLowerCase() === q);
  if (byName.length === 1) return { ok: true, group: byName[0] };
  if (byName.length > 1) {
    return { ok: false, error: `group "${query}" is ambiguous; matches ids: ${byName.map((g) => g.id).join(", ")}` };
  }
  const listing = groups.length ? groups.map((g) => g.id).join(", ") : "(none)";
  return { ok: false, error: `unknown group "${query}"; available group ids: ${listing}` };
}

// ── Plan ────────────────────────────────────────────────────────────

export interface PlanChange {
  name: string;
  status: string;
}

export interface PlanEdge {
  change: string;
  state: "open" | "satisfied";
}

export interface PlanInput {
  groupId: string;
  assignments: Record<string, string>;
  changeOrder?: Record<string, string[]>;
  /** `openspec list` (active changes only). */
  active: readonly PlanChange[];
  /** Computed `blockedBy` edges per active change (any state; only `open` gate). */
  edges: Readonly<Record<string, readonly PlanEdge[]>>;
  /** Archive directory names on `origin/develop` at plan time. */
  archiveDirs: readonly string[];
  now: number;
}

export interface PlanResult {
  items: Item[];
  alreadyShipped: string[];
}

export function newItem(change: string, now: number, state: ItemState = "queued"): Item {
  return {
    change,
    state,
    blockedBy: [],
    outOfBatch: [],
    nudgesUsed: 0,
    streamedSincePrompt: false,
    idleSince: null,
    history: [{ at: now, from: null, to: state }],
  };
}

/** Record + apply a transition (no-op when unchanged). */
export function setState(item: Item, to: ItemState, now: number, reason?: string): void {
  if (item.state === to) {
    if (reason !== undefined) item.reason = reason;
    return;
  }
  item.history.push({ at: now, from: item.state, to, ...(reason ? { reason } : {}) });
  item.state = to;
  if (reason !== undefined) item.reason = reason;
}

/** Default board order: in-progress → others → complete, then name. */
const statusRank = (s: string): number => (s === "in-progress" ? 0 : s === "complete" ? 2 : 1);

/** Members of the cycle(s) in the in-batch edge set (nodes that can reach themselves). */
export function cycleMembers(edges: ReadonlyMap<string, readonly string[]>): Set<string> {
  const members = new Set<string>();
  for (const start of edges.keys()) {
    const seen = new Set<string>();
    const stack = [...(edges.get(start) ?? [])];
    while (stack.length) {
      const n = stack.pop() as string;
      if (n === start) {
        members.add(start);
        break;
      }
      if (seen.has(n)) continue;
      seen.add(n);
      stack.push(...(edges.get(n) ?? []));
    }
  }
  return members;
}

/** Names of the active, unshipped members of the group (before ordering). */
export function batchMembers(input: Pick<PlanInput, "groupId" | "assignments" | "active" | "archiveDirs">): {
  eligible: PlanChange[];
  alreadyShipped: string[];
} {
  const archivedNames = new Set(
    input.archiveDirs.map((d) => archivedChangeName(d)).filter((n): n is string => n !== null),
  );
  const members = input.active.filter((c) => input.assignments[c.name] === input.groupId);
  return {
    eligible: members.filter((c) => !archivedNames.has(c.name)),
    alreadyShipped: members.filter((c) => archivedNames.has(c.name)).map((c) => c.name).sort(),
  };
}

export function planQueue(input: PlanInput): PlanResult {
  const { eligible, alreadyShipped } = batchMembers(input);
  const byName = new Map(eligible.map((c) => [c.name, c]));

  const persisted = (input.changeOrder?.[input.groupId] ?? []).filter((n) => byName.has(n));
  const persistedSet = new Set(persisted);
  const rest = eligible
    .filter((c) => !persistedSet.has(c.name))
    .sort((a, b) => statusRank(a.status) - statusRank(b.status) || a.name.localeCompare(b.name))
    .map((c) => c.name);
  const order = [...new Set([...persisted, ...rest])];

  const memberSet = new Set(order);
  const items = order.map((name) => {
    const item = newItem(name, input.now);
    const open = (input.edges[name] ?? []).filter((e) => e.state === "open").map((e) => e.change);
    item.blockedBy = [...new Set(open.filter((b) => memberSet.has(b)))];
    item.outOfBatch = [...new Set(open.filter((b) => !memberSet.has(b)))];
    return item;
  });

  const graph = new Map(items.map((i) => [i.change, i.blockedBy]));
  for (const name of cycleMembers(graph)) {
    const item = items.find((i) => i.change === name) as Item;
    setState(item, "skipped", input.now, "cycle");
  }
  return { items, alreadyShipped };
}

// ── Settle rule (D5) ────────────────────────────────────────────────

export interface SettleObs {
  status: SessionObs["status"];
  hasQuestion: boolean;
}

const DEFAULT_PARAMS = { settleMs: DEFAULT_SETTLE_MS, startTimeoutMs: DEFAULT_START_TIMEOUT_MS };

/**
 * Settled when, with no pending question, the session is `ended`, or `idle`
 * continuously for the settle window AND (it streamed since the last prompt OR
 * the last prompt is older than `--start-timeout`).
 */
export function settled(
  item: Pick<Item, "idleSince" | "streamedSincePrompt" | "lastPromptAt">,
  obs: SettleObs,
  now: number,
  params: Pick<Params, "settleMs" | "startTimeoutMs"> = DEFAULT_PARAMS,
): boolean {
  if (obs.hasQuestion) return false;
  if (obs.status === "ended") return true;
  if (obs.status !== "idle" || item.idleSince === null) return false;
  if (now - item.idleSince < params.settleMs) return false;
  if (item.streamedSincePrompt) return true;
  return item.lastPromptAt !== undefined && now - item.lastPromptAt >= params.startTimeoutMs;
}

/** Update the per-item observation tracking from one session reading. */
export function track(item: Item, session: SessionObs, now: number): void {
  if (session.status === "streaming") {
    item.streamedSincePrompt = true;
    item.idleSince = null;
  } else if (session.status === "idle") {
    if (item.idleSince === null) item.idleSince = now;
  } else {
    item.idleSince = null;
  }
}

// ── Adoption (D4) ───────────────────────────────────────────────────

export type Adoption =
  | { kind: "adopted"; sessionId: string }
  | { kind: "none" }
  | { kind: "ambiguous"; sessionIds: string[] };

/**
 * Adopt only when EXACTLY ONE resident, non-ended session has
 * `realpath(cwd) === realpath(worktree)` and started at or after `spawnRequestedAt`.
 */
export function adopt(input: {
  worktree: string;
  spawnRequestedAt: number;
  sessions: readonly SessionObs[];
  realpath: (p: string) => string;
}): Adoption {
  const target = input.realpath(input.worktree);
  const matches = input.sessions.filter(
    (s) => s.status !== "ended" && s.startedAt >= input.spawnRequestedAt && input.realpath(s.cwd) === target,
  );
  if (matches.length === 1) return { kind: "adopted", sessionId: matches[0].id };
  if (matches.length === 0) return { kind: "none" };
  return { kind: "ambiguous", sessionIds: matches.map((s) => s.id) };
}

// ── Actions ─────────────────────────────────────────────────────────

export function isDone(state: Pick<BatchState, "items">): boolean {
  return state.items.every((i) => isTerminal(i.state));
}

const itemOf = (state: BatchState, change: string): Item | undefined => state.items.find((i) => i.change === change);

/** Gate one queued / waiting item on its in-batch blockers. Returns whether anything changed. */
function gateOne(state: BatchState, item: Item, now: number, actions: Action[]): boolean {
  const blockers = item.blockedBy.map((b) => itemOf(state, b)).filter((b): b is Item => b !== undefined);
  const dead = blockers.find((b) => isTerminal(b.state) && b.state !== "shipped");
  if (dead) {
    const reason = `blocker ${dead.change} ${dead.state}`;
    setState(item, "skipped", now, reason);
    actions.push({ kind: "skip", change: item.change, reason });
    return true;
  }
  const blocked = blockers.some((b) => b.state !== "shipped");
  if (blocked && item.state !== "waiting_dep") {
    setState(item, "waiting_dep", now);
    return true;
  }
  if (!blocked && item.state === "waiting_dep") {
    setState(item, "queued", now);
    return true;
  }
  return false;
}

/** Re-evaluate `queued` / `waiting_dep` items against their in-batch blockers (to a fixpoint). */
function gateDependencies(state: BatchState, now: number, actions: Action[]): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of state.items) {
      if (item.state === "queued" || item.state === "waiting_dep") changed = gateOne(state, item, now, actions) || changed;
    }
  }
}

interface Tick {
  state: BatchState;
  obs: Observations;
  now: number;
  /** The bus has been up for a settle window: settle / teardown / nudge may be decided. */
  settleOk: boolean;
  actions: Action[];
}

/** `running` ↔ `question`, and `running` → `settled`. */
function stepWatched(item: Item, t: Tick, session: SessionObs | undefined): void {
  const id = item.sessionId as string;
  if (t.obs.questions.has(id)) {
    setState(item, "question", t.now);
    return;
  }
  if (item.state === "question") setState(item, "running", t.now);
  if (!t.settleOk) return;
  // A recorded session missing from the snapshot is `ended` only when the
  // archived listing shows it; otherwise there is no view → no decision.
  if (!session && !t.obs.archived.has(id)) return;
  if (settled(item, { status: session ? session.status : "ended", hasQuestion: false }, t.now, t.state.params)) {
    setState(item, "settled", t.now);
    t.actions.push({ kind: "classify", change: item.change });
  }
}

/** A settled item: classify, then nudge (once per budget) or tear down. */
function stepSettled(item: Item, t: Tick, session: SessionObs | undefined): void {
  const id = item.sessionId as string;
  if (!item.outcome) {
    t.actions.push({ kind: "classify", change: item.change });
    return;
  }
  if (!session && !t.obs.archived.has(id)) return; // no live view → no decision
  const status = session ? session.status : "ended";
  if (item.outcome === "incomplete" && status === "idle" && item.nudgesUsed < t.state.params.nudges) {
    item.nudgesUsed += 1;
    item.lastPromptAt = t.now;
    item.streamedSincePrompt = false;
    item.idleSince = null;
    item.outcome = undefined;
    setState(item, "running", t.now, "nudged");
    t.actions.push({ kind: "nudge", change: item.change, sessionId: id, text: nudgeText(item.change) });
    return;
  }
  if (item.outcome === "incomplete" && status !== "idle" && status !== "ended") {
    // The session woke up again (operator or a late turn): keep watching.
    item.outcome = undefined;
    setState(item, "running", t.now, "session active again");
    return;
  }
  setState(item, "teardown", t.now);
  t.actions.push({ kind: "teardown", change: item.change });
}

/** Items with no session yet: a restart's pending spawn, or a failed start the runner put into teardown. */
function stepSessionless(item: Item, t: Tick): void {
  if (item.state === "starting" && item.spawnRequestedAt !== undefined) t.actions.push({ kind: "adopt", change: item.change });
  else if (item.state === "teardown" && t.settleOk) t.actions.push({ kind: "teardown", change: item.change });
}

function stepItem(item: Item, t: Tick): void {
  const id = item.sessionId;
  if (!id) return stepSessionless(item, t);
  const session = t.obs.sessions[id];
  if (session) track(item, session, t.now);
  if (item.state === "running" || item.state === "question") stepWatched(item, t, session);
  else if (item.state === "settled" && t.obs.questions.has(id)) {
    // A question arrived after classification: the outcome is stale; re-settle after the answer.
    item.outcome = undefined;
    setState(item, "question", t.now);
  } else if (item.state === "settled" && t.settleOk) stepSettled(item, t, session);
  else if (item.state === "teardown" && t.settleOk && !t.obs.questions.has(id)) {
    t.actions.push({ kind: "teardown", change: item.change });
  }
}

/** Start queued items while `active < N` and `live < --max-live` (queue order). */
function startQueued(state: BatchState, now: number, actions: Action[]): void {
  if (state.halted) return;
  const { params } = state;
  let active = state.items.filter((i) => ACTIVE_STATES.has(i.state)).length;
  let live = active + state.items.filter((i) => i.state === "question").length;
  for (const item of state.items) {
    if (item.state !== "queued") continue;
    if (active >= params.parallel || live >= params.maxLive) break;
    item.spawnRequestedAt = now;
    setState(item, "starting", now);
    actions.push({ kind: "start", change: item.change });
    active++;
    live++;
  }
}

/**
 * Advance the state machine one tick. Returns the side effects to execute, in
 * order. While the bus is down it decides nothing; settle / teardown / nudge
 * decisions additionally wait until the bus has been connected for one settle
 * window (D5 observation precondition).
 */
export function nextActions(state: BatchState, obs: Observations, now: number): Action[] {
  const actions: Action[] = [];
  if (!obs.connected) return actions;
  const settleOk = obs.connectedSince !== null && now - obs.connectedSince >= state.params.settleMs;
  const tick: Tick = { state, obs, now, settleOk, actions };
  for (const item of state.items) stepItem(item, tick);
  gateDependencies(state, now, actions);
  startQueued(state, now, actions);
  skipRemainingWhenHalted(state, now, actions);
  return actions;
}

/**
 * A halted run (untrusted init hook) starts nothing more. Once no item is still
 * live, the not-yet-started ones can never run in this process: end them so the
 * runner exits (code 2) instead of ticking forever.
 */
function skipRemainingWhenHalted(state: BatchState, now: number, actions: Action[]): void {
  if (!state.halted) return;
  if (state.items.some((i) => ACTIVE_STATES.has(i.state) || i.state === "question")) return;
  for (const item of state.items) {
    if (item.state !== "queued" && item.state !== "waiting_dep") continue;
    const reason = `scheduling halted: ${state.halted}`;
    setState(item, "skipped", now, reason);
    actions.push({ kind: "skip", change: item.change, reason });
  }
}
