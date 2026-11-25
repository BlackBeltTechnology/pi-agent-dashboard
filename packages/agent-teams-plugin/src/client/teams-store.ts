/**
 * Module-level snapshot cache of the Team view (design D3; tasks 7.1, 7.3, 7.4).
 * No React: views subscribe through `teams-hooks.ts`, frames and reconnects are
 * pushed by the mounted feeder (`teams-feeder.tsx`).
 *
 * - Cache keyed by team id; session → team lookup via `GET /teams?sessionId=`.
 * - Single-flight CONDITIONAL refetch (`If-None-Match`, 304 keeps the cache).
 *   First use fetches at once; every other trigger (stale frame, reconnect, tab
 *   visible) waits a 500 ms debounce with a 2 000 ms max-wait so continuous
 *   frames cannot starve it. The 60 s safety timer fires its request at once so a
 *   visible view converges within 60 s. A hidden tab never polls and defers its
 *   fetches until it is visible again.
 * - A frame is an idempotent hint: `(epoch differs) or (rev greater)` than the
 *   cache marks it stale; a frame that arrives while a request is in flight
 *   schedules exactly ONE follow-up after it settles.
 * - A failed refresh keeps the last snapshot (stale flag), retries 1 s / 2 s / 4 s
 *   then every 30 s; 429 honours `Retry-After` (delta-seconds or HTTP-date,
 *   clamped to [1 s, 120 s]; invalid or absent ⇒ normal backoff). Nothing — a
 *   frame, the safety timer, a reconnect — ever shortens a wait.
 * - Control POSTs (`stopMember`, `shutdownTeam`) time out after 15 s, refetch the
 *   truth and are never retried automatically.
 * See change: add-agent-teams-ui.
 */
import { snapshotEtag, type TeamUiSnapshot } from "../shared/ui-protocol.js";
import { TEAMS_API } from "./routes.js";

export const FIRST_DEBOUNCE_MS = 500;
export const MAX_WAIT_MS = 2000;
export const SAFETY_TIMER_MS = 60_000;
export const CONTROL_TIMEOUT_MS = 15_000;
/** Retry delays after the 1st, 2nd, 3rd … consecutive failure; the last repeats. */
export const BACKOFF_MS: readonly number[] = [1000, 2000, 4000, 30_000];
export const RETRY_AFTER_MIN_MS = 1000;
export const RETRY_AFTER_MAX_MS = 120_000;

export type FailureKind = "network" | "http" | "invalid" | "rate_limited";
export interface FetchFailure {
  kind: FailureKind;
  status?: number;
  /** Epoch ms of the next automatic attempt. */
  retryAt: number;
}

export interface TeamEntry {
  teamId: string;
  /**
   * `loading` first fetch pending · `ready` snapshot present (maybe `stale`) · `error` first fetch failed ·
   * `not_found` a previously resolved team now answers 404 · `absent` the team never resolved (404 on first load).
   */
  phase: "loading" | "ready" | "error" | "not_found" | "absent";
  snapshot?: TeamUiSnapshot;
  /** The last refresh failed; `snapshot` is the previous one. */
  stale: boolean;
  error?: FetchFailure;
}

export interface LookupEntry {
  sessionId: string;
  phase: "loading" | "resolved" | "error";
  /** `null` = the session has no (visible) team — an empty lookup, no existence oracle. */
  teamId?: string | null;
  /** The team lead's session id (frames are scoped to it); absent when the summary has none. */
  leadSessionId?: string;
  error?: FetchFailure;
}

export interface ChangedFrame {
  epoch: string;
  rev: number;
  closed?: boolean;
}

export type ControlResult =
  | { kind: "ok"; status: number }
  | { kind: "rejected"; status: number; code?: string }
  /** No answer within 15 s: the store refetched; the caller says "no response — checking state". */
  | { kind: "timeout" }
  /** The connection dropped after the request was sent: outcome unknown, the store refetched. */
  | { kind: "unconfirmed" };

export interface TeamsStoreOptions {
  fetch?: typeof fetch;
  now?: () => number;
  isVisible?: () => boolean;
}

export interface TeamsStore {
  subscribe(listener: () => void): () => void;
  getTeam(teamId: string): TeamEntry | undefined;
  getLookup(sessionId: string): LookupEntry | undefined;
  /** Look the session's team up (first use at once) and keep its snapshot fresh. Returns the release function. */
  watchSession(sessionId: string): () => void;
  watchTeam(teamId: string): () => void;
  /** Feeder: a newest `agent-teams:changed` frame for a watched team. */
  ingestFrame(teamId: string, frame: ChangedFrame): void;
  /** Feeder: the shell socket reconnected. */
  signalReconnect(): void;
  /** User "Retry": bypasses the failure backoff, never a `Retry-After` wait. */
  retryTeam(teamId: string): void;
  retrySession(sessionId: string): void;
  stopMember(teamId: string, name: string): Promise<ControlResult>;
  shutdownTeam(teamId: string): Promise<ControlResult>;
  dispose(): void;
}

/** `Retry-After` → wait in ms, clamped to [1 s, 120 s]; `undefined` (invalid, absent, 0, past) ⇒ normal backoff. */
export function parseRetryAfter(value: string | null | undefined, nowMs: number): number | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  if (v === "") return undefined;
  let ms: number;
  if (/^\d+$/.test(v)) ms = Number(v) * 1000;
  else if (/[A-Za-z]/.test(v)) ms = Date.parse(v) - nowMs;
  else return undefined;
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  return Math.min(RETRY_AFTER_MAX_MS, Math.max(RETRY_AFTER_MIN_MS, ms));
}

function isSnapshot(body: unknown): body is TeamUiSnapshot {
  if (body === null || typeof body !== "object") return false;
  const s = body as Record<string, unknown>;
  return (
    typeof s.id === "string" &&
    typeof s.epoch === "string" &&
    typeof s.rev === "number" &&
    Number.isFinite(s.rev) &&
    typeof s.status === "string" &&
    Array.isArray(s.members) &&
    Array.isArray(s.tasks) &&
    Array.isArray(s.mail)
  );
}

/** A failed HTTP status as a `RunResult` (429 carries its clamped `Retry-After`). */
function httpFailure(res: Response, nowMs: number): RunResult {
  if (res.status === 429) return { ok: false, kind: "rate_limited", status: 429, retryAfterMs: parseRetryAfter(res.headers.get("retry-after"), nowMs) };
  return { ok: false, kind: "http", status: res.status };
}

/** Parsed JSON body, or `undefined` when it is not JSON (HTML, truncated, empty). */
async function jsonBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

type RunResult = { ok: true } | { ok: false; kind: FailureKind; status?: number; retryAfterMs?: number };
const FAIL_NETWORK: RunResult = { ok: false, kind: "network" };

interface Env {
  now(): number;
  isVisible(): boolean;
}

/** One refresh job (a team snapshot or a session lookup): single-flight, debounced, backed off. */
class Slot {
  watchers = 0;
  inflight = false;
  private dirty = false;
  private started = false;
  private failures = 0;
  private waitUntil = 0;
  private hardUntil = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private firstTrigger: number | undefined;
  private hiddenDeferred = false;

  private readonly env: Env;
  private readonly run: () => Promise<RunResult>;
  private readonly onSettled: (result: RunResult) => void;
  private readonly onFailure: (failure: FetchFailure) => void;

  constructor(env: Env, run: () => Promise<RunResult>, onSettled: (result: RunResult) => void, onFailure: (failure: FetchFailure) => void) {
    this.env = env;
    this.run = run;
    this.onSettled = onSettled;
    this.onFailure = onFailure;
  }

  private arm(at: number): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.fire(), Math.max(0, at - this.env.now()));
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.firstTrigger = undefined;
  }

  private fire(): void {
    this.timer = undefined;
    this.firstTrigger = undefined;
    if (this.watchers === 0) return;
    if (this.started && !this.env.isVisible()) {
      this.hiddenDeferred = true; // no polling while hidden; the visibility trigger picks it up
      return;
    }
    this.start(false);
  }

  /** Debounced trigger (500 ms, 2 000 ms max-wait). */
  trigger(): void {
    if (this.watchers === 0) return;
    if (this.inflight) {
      this.dirty = true;
      return;
    }
    const now = this.env.now();
    this.firstTrigger ??= now;
    this.arm(Math.max(Math.min(now + FIRST_DEBOUNCE_MS, this.firstTrigger + MAX_WAIT_MS), this.waitUntil));
  }

  /** Immediate fetch (first use, safety timer); joins an in-flight request. */
  fetchNow(): void {
    if (this.watchers === 0 || this.inflight) return;
    this.start(false);
  }

  /** User retry: skips the failure backoff but never a 429 wait. */
  retryNow(): void {
    if (this.watchers === 0 || this.inflight) return;
    this.start(true);
  }

  onVisible(): void {
    this.hiddenDeferred = false;
    this.trigger();
  }

  /** Last watcher left: no timer may outlive the view. */
  idle(): void {
    this.clearTimer();
    this.dirty = false;
    this.hiddenDeferred = false;
  }

  private start(bypassBackoff: boolean): void {
    if (this.inflight) return;
    const until = bypassBackoff ? this.hardUntil : this.waitUntil;
    if (this.env.now() < until) {
      this.arm(until); // a frame, the first use or the timer never bypasses a wait
      return;
    }
    this.clearTimer();
    this.inflight = true;
    this.dirty = false;
    this.started = true;
    let job: Promise<RunResult>;
    try {
      job = this.run();
    } catch {
      job = Promise.resolve(FAIL_NETWORK);
    }
    void job.then(
      (r) => this.settle(r),
      () => this.settle(FAIL_NETWORK),
    );
  }

  private settle(result: RunResult): void {
    this.inflight = false;
    if (result.ok) {
      this.failures = 0;
      this.waitUntil = 0;
      this.hardUntil = 0;
      this.onSettled(result);
      if (this.dirty) {
        this.dirty = false;
        this.trigger();
      }
      return;
    }
    this.failures += 1;
    const delay = result.retryAfterMs ?? (BACKOFF_MS[Math.min(this.failures, BACKOFF_MS.length) - 1] as number);
    this.waitUntil = this.env.now() + delay;
    this.hardUntil = result.retryAfterMs !== undefined ? this.waitUntil : 0;
    this.dirty = false;
    this.onFailure({ kind: result.kind, status: result.status, retryAt: this.waitUntil });
    this.onSettled(result);
    if (this.watchers > 0) this.arm(this.waitUntil);
  }
}

interface TeamRec {
  slot: Slot;
  pendingFrame?: ChangedFrame;
}
interface SessionRec {
  slot: Slot;
  /** Team this session's watch currently holds. */
  held?: { teamId: string; release: () => void };
}

export function createTeamsStore(options: TeamsStoreOptions = {}): TeamsStore {
  const fetchFn: typeof fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const env: Env = {
    now: options.now ?? (() => Date.now()),
    isVisible: options.isVisible ?? (() => typeof document === "undefined" || document.visibilityState !== "hidden"),
  };

  const teams = new Map<string, TeamEntry>();
  const lookups = new Map<string, LookupEntry>();
  const teamRecs = new Map<string, TeamRec>();
  const sessionRecs = new Map<string, SessionRec>();
  const listeners = new Set<() => void>();
  const controls = new Map<string, Promise<ControlResult>>();
  const resolvedTeams = new Set<string>();

  const notify = (): void => {
    for (const l of [...listeners]) l();
  };
  const setTeam = (teamId: string, next: TeamEntry): void => {
    teams.set(teamId, next);
    notify();
  };
  const patchTeam = (teamId: string, patch: Partial<TeamEntry>): void => {
    const cur = teams.get(teamId) ?? { teamId, phase: "loading", stale: false };
    setTeam(teamId, { ...cur, ...patch });
  };

  /** One request; `undefined` when the connection failed (offline, reset, DNS). */
  const attempt = async (url: string, init?: RequestInit): Promise<Response | undefined> => {
    try {
      return await fetchFn(url, init);
    } catch {
      return undefined;
    }
  };

  // ---- shared timers: one safety interval + one visibility listener while anything is watched

  let watchedTotal = 0;
  let interval: ReturnType<typeof setInterval> | undefined;
  let visibilityBound = false;
  const allSlots = (): Slot[] => [...[...teamRecs.values()].map((r) => r.slot), ...[...sessionRecs.values()].map((r) => r.slot)];

  const stopInterval = (): void => {
    if (interval !== undefined) clearInterval(interval);
    interval = undefined;
  };
  const startInterval = (): void => {
    if (interval !== undefined || watchedTotal === 0) return;
    interval = setInterval(() => {
      if (!env.isVisible()) return;
      for (const s of allSlots()) s.fetchNow();
    }, SAFETY_TIMER_MS);
  };
  const onVisibility = (): void => {
    if (env.isVisible()) {
      startInterval();
      for (const s of allSlots()) s.onVisible();
    } else stopInterval();
  };
  const acquireGlobal = (): void => {
    watchedTotal += 1;
    if (watchedTotal !== 1) return;
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
      visibilityBound = true;
    }
    if (env.isVisible()) startInterval();
  };
  const releaseGlobal = (): void => {
    watchedTotal -= 1;
    if (watchedTotal !== 0) return;
    stopInterval();
    if (visibilityBound && typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    visibilityBound = false;
  };

  // ---- team snapshot job

  const failed = (failure: FetchFailure, teamId: string): void => {
    const cur = teams.get(teamId);
    if (cur?.snapshot) patchTeam(teamId, { phase: "ready", stale: true, error: failure });
    else patchTeam(teamId, { phase: "error", stale: false, error: failure });
  };

  const markFresh = (teamId: string): void => {
    const cur = teams.get(teamId);
    if (cur && (cur.stale || cur.error || cur.phase !== "ready")) patchTeam(teamId, { phase: "ready", stale: false, error: undefined });
  };

  async function runTeam(teamId: string): Promise<RunResult> {
    const cached = teams.get(teamId)?.snapshot;
    const res = await attempt(`${TEAMS_API}/teams/${encodeURIComponent(teamId)}`, cached ? { headers: { "If-None-Match": snapshotEtag(cached.epoch, cached.rev) } } : undefined);
    return res ? onTeamResponse(teamId, cached, res) : FAIL_NETWORK;
  }

  async function onTeamResponse(teamId: string, cached: TeamUiSnapshot | undefined, res: Response): Promise<RunResult> {
    if (res.status === 304 && cached) {
      markFresh(teamId);
      return { ok: true };
    }
    if (res.status === 404) {
      patchTeam(teamId, { phase: resolvedTeams.has(teamId) ? "not_found" : "absent", snapshot: undefined, stale: false, error: undefined });
      return { ok: true };
    }
    if (!res.ok) return httpFailure(res, env.now());
    const body = await jsonBody(res);
    if (!isSnapshot(body)) return { ok: false, kind: "invalid", status: res.status };
    acceptSnapshot(teamId, cached, body);
    return { ok: true };
  }

  /** Store a fetched snapshot; never regress inside one epoch (a slow, older response). */
  function acceptSnapshot(teamId: string, cached: TeamUiSnapshot | undefined, body: TeamUiSnapshot): void {
    if (cached && cached.epoch === body.epoch && body.rev < cached.rev) {
      markFresh(teamId);
      return;
    }
    resolvedTeams.add(teamId);
    setTeam(teamId, { teamId, phase: "ready", snapshot: body, stale: false });
  }

  function teamRec(teamId: string): TeamRec {
    let rec = teamRecs.get(teamId);
    if (rec) return rec;
    const made: TeamRec = {
      slot: new Slot(
        env,
        () => runTeam(teamId),
        (result) => {
          const pending = made.pendingFrame;
          made.pendingFrame = undefined;
          const snap = teams.get(teamId)?.snapshot;
          if (result.ok && pending && snap && (pending.epoch !== snap.epoch || pending.rev > snap.rev)) made.slot.trigger();
        },
        (failure) => failed(failure, teamId),
      ),
    };
    rec = made;
    teamRecs.set(teamId, rec);
    return rec;
  }

  function watchTeam(teamId: string): () => void {
    const rec = teamRec(teamId);
    rec.slot.watchers += 1;
    acquireGlobal();
    if (!teams.has(teamId)) setTeam(teamId, { teamId, phase: "loading", stale: false });
    rec.slot.fetchNow();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      rec.slot.watchers -= 1;
      if (rec.slot.watchers === 0) rec.slot.idle();
      releaseGlobal();
    };
  }

  // ---- session → team lookup job

  const setLookup = (sessionId: string, next: LookupEntry): void => {
    lookups.set(sessionId, next);
    notify();
  };

  async function runLookup(sessionId: string, rec: SessionRec): Promise<RunResult> {
    const res = await attempt(`${TEAMS_API}/teams?sessionId=${encodeURIComponent(sessionId)}`);
    if (!res) return FAIL_NETWORK;
    if (!res.ok) return httpFailure(res, env.now());
    const list = ((await jsonBody(res)) as { teams?: unknown } | null | undefined)?.teams;
    if (!Array.isArray(list)) return { ok: false, kind: "invalid", status: res.status };
    const first = list[0] as { id?: unknown; leadSessionId?: unknown } | undefined;
    applyLookup(sessionId, rec, typeof first?.id === "string" ? first.id : null, typeof first?.leadSessionId === "string" && first.leadSessionId !== "" ? first.leadSessionId : undefined);
    return { ok: true };
  }

  /** Record the lookup result and move the session's team watch when the team changed. */
  function applyLookup(sessionId: string, rec: SessionRec, teamId: string | null, leadSessionId?: string): void {
    const prev = lookups.get(sessionId);
    if (prev?.phase !== "resolved" || prev.teamId !== teamId || prev.leadSessionId !== leadSessionId || prev.error) {
      setLookup(sessionId, { sessionId, phase: "resolved", teamId, ...(leadSessionId !== undefined ? { leadSessionId } : {}) });
    }
    if (rec.held?.teamId === teamId) return;
    rec.held?.release();
    rec.held = teamId === null ? undefined : { teamId, release: watchTeam(teamId) };
  }

  function watchSession(sessionId: string): () => void {
    let rec = sessionRecs.get(sessionId);
    if (!rec) {
      const made: SessionRec = {
        slot: new Slot(
          env,
          () => runLookup(sessionId, made),
          () => undefined,
          (failure) => {
            const cur = lookups.get(sessionId);
            setLookup(sessionId, cur && cur.phase === "resolved" ? { ...cur, error: failure } : { sessionId, phase: "error", error: failure });
          },
        ),
      };
      rec = made;
      sessionRecs.set(sessionId, rec);
    }
    const held = rec;
    held.slot.watchers += 1;
    acquireGlobal();
    if (!lookups.has(sessionId)) setLookup(sessionId, { sessionId, phase: "loading" });
    held.slot.fetchNow();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      held.slot.watchers -= 1;
      if (held.slot.watchers === 0) {
        held.slot.idle();
        held.held?.release();
        held.held = undefined;
      }
      releaseGlobal();
    };
  }

  // ---- feeder inputs

  function ingestFrame(teamId: string, frame: ChangedFrame): void {
    const rec = teamRecs.get(teamId);
    if (!rec || rec.slot.watchers === 0) return;
    const snap = teams.get(teamId)?.snapshot;
    if (snap && frame.epoch === snap.epoch && frame.rev <= snap.rev) return; // known state (also a replayed old frame)
    if (rec.slot.inflight) {
      rec.pendingFrame = frame;
      return;
    }
    rec.slot.trigger();
  }

  function signalReconnect(): void {
    for (const s of allSlots()) s.trigger();
  }

  // ---- control POSTs

  async function control(teamId: string, path: string): Promise<ControlResult> {
    const ac = typeof AbortController === "undefined" ? undefined : new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => {
        ac?.abort();
        resolve("timeout");
      }, CONTROL_TIMEOUT_MS);
    });
    const request = fetchFn(`${TEAMS_API}/teams/${encodeURIComponent(teamId)}${path}`, { method: "POST", signal: ac?.signal }).then(
      (res) => res,
      () => "unconfirmed" as const,
    );
    const outcome = await Promise.race([request, timeout]);
    if (timer !== undefined) clearTimeout(timer);
    const slot = teamRecs.get(teamId)?.slot;
    if (outcome === "timeout" || outcome === "unconfirmed") {
      slot?.fetchNow(); // learn the truth; never assume success or failure, never auto-retry the POST
      return { kind: outcome };
    }
    if (outcome.ok) {
      slot?.trigger();
      return { kind: "ok", status: outcome.status };
    }
    let code: string | undefined;
    try {
      const body = (await outcome.json()) as { error?: unknown };
      if (typeof body?.error === "string") code = body.error;
    } catch {
      /* non-JSON body: no code */
    }
    if (outcome.status !== 403) slot?.trigger();
    return { kind: "rejected", status: outcome.status, code };
  }

  function singleControl(key: string, teamId: string, path: string): Promise<ControlResult> {
    const pending = controls.get(key);
    if (pending) return pending; // never a second POST while one is pending
    const p = control(teamId, path).finally(() => controls.delete(key));
    controls.set(key, p);
    return p;
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getTeam: (teamId) => teams.get(teamId),
    getLookup: (sessionId) => lookups.get(sessionId),
    watchSession,
    watchTeam,
    ingestFrame,
    signalReconnect,
    retryTeam(teamId) {
      teamRecs.get(teamId)?.slot.retryNow();
    },
    retrySession(sessionId) {
      sessionRecs.get(sessionId)?.slot.retryNow();
    },
    stopMember: (teamId, name) => singleControl(`${teamId}\u0000stop\u0000${name}`, teamId, `/members/${encodeURIComponent(name)}/stop`),
    shutdownTeam: (teamId) => singleControl(`${teamId}\u0000shutdown`, teamId, "/shutdown"),
    dispose() {
      for (const s of allSlots()) s.idle();
      stopInterval();
      if (visibilityBound && typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
      visibilityBound = false;
      watchedTotal = 0;
      listeners.clear();
    },
  };
}

/** The shared instance the Team view and its feeder use. */
export const teamsStore: TeamsStore = createTeamsStore();
