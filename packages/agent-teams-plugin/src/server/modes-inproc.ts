/**
 * Mode `in-process` (design D1/D3/D10): registration in core's `modes.ts` registry, the per-lead-session
 * availability map fed by the bridge's `inproc hello`, and the `agent-teams/inproc` lane handler.
 *
 * - `registerInProcessMode` adds `in-process` to the registry with a per-caller `available(sessionId?)`
 *   predicate (the caller's last hello; with no caller — a REST template listing — any connected session
 *   reporting availability). Reasons: `subagents_extension_missing`, `subagents_extension_outdated`,
 *   `no_context`, each followed by an install/update hint. Fail closed: no hello yet = `no_context`.
 * - `createInProcLane` handles `{op:"hello"}` (records availability + the command secret, persists
 *   `leadIncarnation`/`subagentsApi`, releases queued commands, closes the team `lead_reloaded` on a changed incarnation, re-binds members from
 *   the hello's `snapshot`, delivers pending stops), `{op:"ack"}` (to the driver) and `{op:"event"}` (lifecycle intake, `inproc-lifecycle.ts`).
 * - The lead's FIRST hello that reports the mode unavailable (not `no_context`) closes the team with
 *   `closeReason: mode_unavailable` before any command is sent (templated start mismatch, package removed).
 * - `closeInProcessTeamsWithoutMode` closes open in-process teams on load when the mode is not registered.
 * Core's session driver and session-mode paths are not touched.
 * See change: add-agent-teams-in-process.
 */
import type { Clock } from "../shared/clock.js";
import { IN_PROCESS_MODE, type InProcAck, type InProcAvailabilityReport, type InProcHelloPayload, type InProcSnapshot, type InProcSnapshotMember, LANE_INPROC } from "../shared/inproc-protocol.js";
import type { OpResult } from "../shared/protocol.js";
import { installHint, type SubagentsFeature } from "../shared/subagents-contract.js";
import type { Team } from "../shared/types.js";
import type { InProcDriver } from "./driver-inproc.js";
import type { InProcLead } from "./inproc-lead.js";
import type { InProcLifecycle } from "./inproc-lifecycle.js";
import type { ExtensionPoints } from "./extension-points.js";
import type { ModeRegistry } from "./modes.js";
import { isLive } from "./op-util.js";
import type { Ops } from "./ops.js";
import type { TeamStore } from "./store.js";
import type { PluginCounters } from "./templates-hooks.js";
import type { Logger } from "./types.js";


/** What the server remembers of one lead session's bridge (memory only; the secret is never persisted). */
interface InProcSessionRecord {
  report: InProcAvailabilityReport;
  incarnation: string;
  commandSecret: string;
  at: number;
}

export interface InProcAvailability {
  /** Record a hello; `first` is true when this session had none before (since the server started). */
  note(sessionId: string, hello: InProcHelloPayload): { first: boolean };
  get(sessionId: string): InProcSessionRecord | undefined;
  forget(sessionId: string): void;
  /** Whether a live connected session reports the mode available (`isConnected` filters stale records). */
  anyAvailable(isConnected: (sessionId: string) => boolean): boolean;
  /** Registry predicate result for `sessionId` (undefined = any connected session). */
  verdict(sessionId: string | undefined, isConnected: (sessionId: string) => boolean): { ok: true } | { ok: false; reason: string };
  hasFeature(sessionId: string, feature: SubagentsFeature): boolean;
}

function reasonText(report: Extract<InProcAvailabilityReport, { available: false }>): string {
  return `${report.reason}: ${installHint(report.reason, report.missing)}`;
}

/** No session reports availability: name the most informative reason (a definite one over `no_context`). */
function bestUnavailableReason(records: ReadonlyMap<string, InProcSessionRecord>, isConnected: (sessionId: string) => boolean): string {
  let best: Extract<InProcAvailabilityReport, { available: false }> | undefined;
  for (const [sid, rec] of records) {
    if (rec.report.available || !isConnected(sid)) continue;
    if (!best || (best.reason === "no_context" && rec.report.reason !== "no_context")) best = rec.report;
  }
  return best ? reasonText(best) : `no_context: ${installHint("no_context")}`;
}

export function createInProcAvailability(clock: Clock): InProcAvailability {
  const records = new Map<string, InProcSessionRecord>();
  return {
    note(sessionId, hello) {
      const first = !records.has(sessionId);
      records.set(sessionId, { report: hello.inProcess, incarnation: hello.incarnation, commandSecret: hello.commandSecret, at: clock.now() });
      return { first };
    },
    get: (sessionId) => records.get(sessionId),
    forget(sessionId) {
      records.delete(sessionId);
    },
    anyAvailable(isConnected) {
      for (const [sid, rec] of records) if (rec.report.available && isConnected(sid)) return true;
      return false;
    },
    verdict(sessionId, isConnected) {
      if (sessionId === undefined) return this.anyAvailable(isConnected) ? { ok: true } : { ok: false, reason: bestUnavailableReason(records, isConnected) };
      const rec = records.get(sessionId);
      if (!rec) return { ok: false, reason: `no_context: ${installHint("no_context")}` };
      return rec.report.available ? { ok: true } : { ok: false, reason: reasonText(rec.report) };
    },
    hasFeature(sessionId, feature) {
      const rec = records.get(sessionId);
      return rec?.report.available === true && rec.report.features.includes(feature);
    },
  };
}

/** Register `in-process` in core's registry (additive; throws when registered twice, like any mode). */
export function registerInProcessMode(modes: ModeRegistry, driver: InProcDriver, availability: InProcAvailability, isConnected: (sessionId: string) => boolean): void {
  modes.register(IN_PROCESS_MODE, { driver, available: (sessionId) => availability.verdict(sessionId, isConnected) });
}

// ── hello parsing ─────────────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
const get = (o: Record<string, unknown>, k: string): unknown => (Object.hasOwn(o, k) ? o[k] : undefined);
const MAX_ID_CHARS = 200;

type AvailableReport = Extract<InProcAvailabilityReport, { available: true }>;

function parseAvailableReport(report: Record<string, unknown>): AvailableReport | undefined {
  const apiVersion = get(report, "apiVersion");
  const features = get(report, "features");
  const limits = get(report, "limits");
  if (typeof apiVersion !== "number" || !Number.isInteger(apiVersion) || !Array.isArray(features) || !isRecord(limits)) return undefined;
  const maxConcurrent = get(limits, "maxConcurrent");
  // Fail closed server-side too: a bridge reporting `available` with an unusable pool size is not trusted.
  if (typeof maxConcurrent !== "number" || !Number.isInteger(maxConcurrent) || maxConcurrent < 1) return undefined;
  return { available: true, apiVersion, features: features.filter((f): f is SubagentsFeature => typeof f === "string").slice(0, 32), limits: { maxConcurrent } };
}

function parseUnavailableReport(report: Record<string, unknown>): InProcAvailabilityReport | undefined {
  const reason = get(report, "reason");
  if (reason !== "subagents_extension_missing" && reason !== "subagents_extension_outdated" && reason !== "no_context") return undefined;
  const missing = get(report, "missing");
  return { available: false, reason, ...(Array.isArray(missing) ? { missing: missing.filter((m): m is string => typeof m === "string").slice(0, 16) } : {}) };
}

const idField = (o: Record<string, unknown>, key: string): string | undefined => {
  const v = get(o, key);
  return typeof v === "string" && v.length > 0 && v.length <= MAX_ID_CHARS ? v : undefined;
};

/** Strict parse of `{op:"hello"}`; `undefined` = invalid. Features are filtered to strings; limits are re-checked here and by the verdict upstream. */
function parseInprocHello(payload: unknown): InProcHelloPayload | undefined {
  if (!isRecord(payload)) return undefined;
  const incarnation = idField(payload, "incarnation");
  const commandSecret = idField(payload, "commandSecret");
  const report = get(payload, "inProcess");
  if (incarnation === undefined || commandSecret === undefined || !isRecord(report) || typeof get(report, "available") !== "boolean") return undefined;
  const inProcess = get(report, "available") === true ? parseAvailableReport(report) : parseUnavailableReport(report);
  const snapshot = get(payload, "snapshot") === undefined ? undefined : parseSnapshot(get(payload, "snapshot"));
  return inProcess ? { op: "hello", incarnation, commandSecret, inProcess, ...(snapshot ? { snapshot } : {}) } : undefined;
}

/** The newest settle the server has not acknowledged (a hello's `snapshot` carries it so the outbox entry and the snapshot never count twice). */
function parseUnackedSettle(v: unknown): InProcSnapshotMember["unackedSettle"] | undefined {
  if (!isRecord(v)) return undefined;
  const run = get(v, "run");
  if (typeof run !== "number" || !Number.isInteger(run) || run < 0) return undefined;
  const finalText = get(v, "finalText");
  const error = get(v, "error");
  return {
    run,
    ...(typeof finalText === "string" ? { finalText: finalText.slice(0, 1_048_576) } : {}),
    ...(typeof error === "string" ? { error: error.slice(0, 1_048_576) } : {}),
    ...(get(v, "aborted") === true ? { aborted: true } : {}),
  };
}

/** Member rows of a `snapshot` ack, re-validated field by field (the bridge is trusted, its payload is not echoed anywhere). */
function parseSnapshot(v: unknown): InProcSnapshot | undefined {
  if (!isRecord(v) || !Array.isArray(v.members)) return undefined;
  const members: InProcSnapshotMember[] = [];
  const unreadable: string[] = [];
  for (const m of v.members.slice(0, 200)) {
    if (!isRecord(m)) continue;
    const member = idField(m, "member");
    const childId = idField(m, "childId");
    const agentId = idField(m, "agentId");
    const state = get(m, "state");
    const run = get(m, "run");
    const lastIdleRun = get(m, "lastIdleRun");
    const ids = get(m, "deliveredMailIds");
    const bad = (): void => {
      if (member) unreadable.push(member); // a row for a named member exists: its child may still run
    };
    if (!member || !childId || !agentId || (state !== "spawning" && state !== "busy" && state !== "idle")) {
      bad();
      continue;
    }
    if (typeof run !== "number" || !Number.isInteger(run) || typeof lastIdleRun !== "number" || !Number.isInteger(lastIdleRun)) {
      bad();
      continue;
    }
    const settle = get(m, "unackedSettle");
    const unackedSettle = parseUnackedSettle(settle);
    members.push({
      member,
      childId,
      agentId,
      state,
      run,
      lastIdleRun,
      deliveredMailIds: Array.isArray(ids) ? ids.filter((n): n is number => typeof n === "number" && Number.isInteger(n)).slice(0, 200) : [],
      ...(unackedSettle ? { unackedSettle } : {}),
    });
  }
  return { members, ...(unreadable.length > 0 ? { unreadable } : {}) };
}

function parseAck(payload: unknown): InProcAck | undefined {
  if (!isRecord(payload)) return undefined;
  const cmdId = get(payload, "cmdId");
  const ok = get(payload, "ok");
  if (typeof cmdId !== "string" || cmdId.length === 0 || cmdId.length > MAX_ID_CHARS || typeof ok !== "boolean") return undefined;
  const str = (k: string, max: number): string | undefined => {
    const v = get(payload, k);
    return typeof v === "string" ? v.slice(0, max) : undefined;
  };
  const status = get(payload, "status");
  const queuePosition = get(payload, "queuePosition");
  const error = str("error", 80);
  const message = str("message", 300);
  const childId = str("childId", MAX_ID_CHARS);
  const agentId = str("agentId", MAX_ID_CHARS);
  const result = str("result", 40);
  const run = get(payload, "run");
  const snapshot = parseSnapshot(get(payload, "snapshot"));
  return {
    op: "ack",
    cmdId,
    ok,
    ...(error !== undefined ? { error } : {}),
    ...(message !== undefined ? { message } : {}),
    ...(childId !== undefined ? { childId } : {}),
    ...(agentId !== undefined ? { agentId } : {}),
    ...(status === "queued" || status === "running" ? { status } : {}),
    ...(typeof queuePosition === "number" && Number.isInteger(queuePosition) && queuePosition >= 1 ? { queuePosition } : {}),
    ...(result !== undefined ? { result } : {}),
    ...(typeof run === "number" && Number.isInteger(run) && run >= 1 ? { run } : {}),
    ...(snapshot ? { snapshot } : {}),
  };
}

// ── lane handler ────────────────────────────────────────────────────────────────────────────

export interface InProcLaneDeps {
  ops: Pick<Ops, "resolveCaller" | "releaseMember" | "teamDelete">;
  /** Event intake + snapshot re-bind; absent ⇒ `{op:"event"}` is `unknown_op` and a snapshot is ignored (harness lanes). */
  lifecycle?: InProcLifecycle;
  /** Lead reload / pending stops; absent ⇒ a changed incarnation is only recorded. */
  lead?: InProcLead;
  ext: Pick<ExtensionPoints, "seal">;
  store: TeamStore;
  driver: InProcDriver;
  availability: InProcAvailability;
  counters: PluginCounters;
  logger: Logger;
}

type LaneMeta = { sessionId: string; origin?: { local?: boolean } };

/** `{ "agent-teams/inproc": handler }`, registered hub-local with the core lane handlers. */
export function createInProcLane(deps: InProcLaneDeps): Record<string, (payload: unknown, meta: LaneMeta) => OpResult<unknown> | Promise<OpResult<unknown>>> {
  const { ops, store, driver, availability, logger } = deps;

  /** The lead's first hello says the mode is unusable: fail the queued spawns, then close the team (no command was sent). */
  function closeUnavailable(teamId: string, reason: string): void {
    const team = store.get(teamId);
    if (!team || team.status === "closed") return;
    driver.failQueued(teamId, "mode_unavailable");
    for (const m of team.members.filter(isLive)) ops.releaseMember(team, m.name, m.status === "spawning" ? "failed" : "gone", "mode_unavailable");
    ops.teamDelete(team, { actor: "server", force: true, closeReason: "mode_unavailable" });
    logger.warn(`agent-teams: team ${teamId} closed: in-process mode unavailable (${reason})`);
  }

  /** Persist what the lead reported on its in-process team; an unusable FIRST report closes the team. Returns false when the hello stops here. */
  function recordOnTeam(team: Team, hello: InProcHelloPayload, first: boolean): boolean {
    const report = hello.inProcess;
    if (!report.available) {
      if (first && report.reason !== "no_context") closeUnavailable(team.id, report.reason);
      return false;
    }
    store.patchTeam(team.id, { leadIncarnation: hello.incarnation, subagentsApi: { apiVersion: report.apiVersion, features: [...report.features], limits: { ...report.limits } } }, { writeThrough: true });
    return true;
  }

  function onHello(payload: unknown, sessionId: string): OpResult<unknown> {
    const hello = parseInprocHello(payload);
    if (!hello) return { ok: false, error: "invalid_args", message: "invalid inproc hello" };
    const previous = availability.get(sessionId)?.incarnation; // this server run's memory first, then what the team persisted
    const { first } = availability.note(sessionId, hello);
    const caller = ops.resolveCaller({ sessionId });
    const team = caller.role === "lead" ? caller.team : undefined;
    if (team?.mode === IN_PROCESS_MODE && team.status !== "closed") {
      const before = previous ?? team.leadIncarnation;
      // A new bridge activation: the old children died with it (a reload / resume of the same id), the team closes `lead_reloaded`.
      if (before !== undefined && before !== hello.incarnation && deps.lead) {
        deps.lead.onReload(team);
        return { ok: true, data: { available: hello.inProcess.available } };
      }
      if (!recordOnTeam(team, hello, first)) return { ok: true, data: { available: false } };
      if (hello.snapshot) deps.lifecycle?.reconcile(team, sessionId, hello.snapshot);
    }
    if (hello.inProcess.available) {
      deps.lead?.onHello(sessionId, hello.incarnation); // pending stops of this lead's teams (the team may already be closed)
      driver.onHello(sessionId);
    }
    return { ok: true, data: { available: hello.inProcess.available } };
  }

  function onAck(payload: unknown, sessionId: string): OpResult<unknown> {
    const ack = parseAck(payload);
    return ack ? { ok: true, data: { matched: driver.onAck(sessionId, ack).matched } } : { ok: false, error: "invalid_args", message: "invalid inproc ack" };
  }

  /** A lifecycle report of the lead host: only the lead of an open in-process team may send one. */
  function onEvent(payload: unknown, sessionId: string): OpResult<unknown> | Promise<OpResult<unknown>> {
    const caller = ops.resolveCaller({ sessionId });
    const team = caller.role === "lead" ? caller.team : undefined;
    // A report for a team that already closed (or that never existed here) is stale: acknowledge it so the host's outbox drains.
    if (!team || team.mode !== IN_PROCESS_MODE) return { ok: true, data: { ignored: true } };
    return deps.lifecycle?.onEvent(team, sessionId, payload) ?? { ok: false, error: "invalid_args" };
  }

  return {
    [LANE_INPROC]: (payload, meta) => {
      deps.ext.seal();
      if (meta?.origin?.local !== true) return { ok: false, error: "origin_denied" };
      const op = isRecord(payload) ? get(payload, "op") : undefined;
      if (op === "hello") return onHello(payload, meta.sessionId);
      if (op === "ack") return onAck(payload, meta.sessionId);
      if (op === "event" && deps.lifecycle) return onEvent(payload, meta.sessionId);
      if (typeof op !== "string") return { ok: false, error: "invalid_args", message: "payload must be {op}" };
      return { ok: false, error: "unknown_op", message: op.slice(0, 40) };
    },
  };
}

/**
 * A new in-process team takes the lead bridge's `incarnation` and subagents API from the lead's last `inproc hello` (sent BEFORE the team
 * existed), so a later incarnation change is a reload even if no second hello ever arrived, and `pendingStops` know their incarnation.
 */
export function bindNewTeamToHello(store: TeamStore, availability: InProcAvailability): () => void {
  return store.on("team_created", ({ team }) => {
    if (team.mode !== IN_PROCESS_MODE || !team.leadSessionId) return;
    const rec = availability.get(team.leadSessionId);
    if (!rec) return;
    const api = rec.report.available ? { subagentsApi: { apiVersion: rec.report.apiVersion, features: [...rec.report.features], limits: { ...rec.report.limits } } } : {};
    store.patchTeam(team.id, { leadIncarnation: rec.incarnation, ...api }, { writeThrough: true });
  });
}

// ── load-time recovery ─────────────────────────────────────────────────────────────────────

/**
 * Server load while the in-process mode is not registered (rollback, mode removed): every open in-process team is closed
 * `mode_unavailable` with its members `gone` (tasks released). A registered mode never closes anything here: members stay
 * `disconnected` until the lead's hello. Returns the ids closed.
 */
export function closeInProcessTeamsWithoutMode(store: TeamStore, modes: ModeRegistry, ops: Pick<Ops, "releaseMember" | "teamDelete">, logger: Logger): string[] {
  if (modes.get(IN_PROCESS_MODE)) return [];
  const closed: string[] = [];
  for (const team of store.list()) {
    if (team.mode !== IN_PROCESS_MODE || team.status === "closed") continue;
    for (const m of team.members.filter(isLive)) ops.releaseMember(team, m.name, "gone", "mode_unavailable");
    ops.teamDelete(team, { actor: "server", force: true, closeReason: "mode_unavailable" });
    closed.push(team.id);
    logger.warn(`agent-teams: open in-process team ${team.id} closed: the mode is unavailable`);
  }
  return closed;
}

/**
 * A live member of an open in-process team without a persisted `proxyToken` (a record from a build that lacked it, or a
 * damaged file) cannot authenticate: every proxied call of its child is `forbidden`, so it is usable only after a respawn.
 * One warning per member at load flags it; returns `teamId/member` of each.
 */
export function flagMembersWithoutToken(store: TeamStore, logger: Logger): string[] {
  const flagged: string[] = [];
  for (const team of store.list()) {
    if (team.mode !== IN_PROCESS_MODE || team.status === "closed") continue;
    for (const m of team.members.filter(isLive)) {
      if (m.proxyToken !== undefined) continue;
      flagged.push(`${team.id}/${m.name}`);
      logger.warn(`agent-teams: in-process member ${m.name} of team ${team.id} has no proxy token; it can act only after a respawn`);
    }
  }
  return flagged;
}
