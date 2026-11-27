/**
 * `ResourceLock` (design D6): a tiny server-owned named mutex for the `openspec-group` teams (resource
 * `harness`). The server answers the `ResourceLock {action, name}` op registered through `ops.registerOp`;
 * state (holder, grant time, `grantMailed`, FIFO queue) lives ONLY in the sidecar `locks` field, so a
 * failed write (`sidecar_write_failed`) leaves memory and disk unchanged and a restart reloads it.
 *
 *  - `acquire` → `{granted:true}` (free, or held by the caller: TTL refresh) or `{granted:false, holder,
 *    position}` and the caller is queued once (FIFO, cap = team `maxTeammates`, else `queue_full`).
 *  - `release` by the holder hands the lock over SYNCHRONOUSLY to the oldest live waiter (gone / failed /
 *    shutdown_pending waiters are skipped and dropped, a disconnected one keeps its place) and sends it a
 *    waking `lock_grant` mail; `release` by a waiter dequeues it; anyone else gets `not_holder`.
 *  - Automatic release: holder gone/failed, SETTLED idle (a new `lastSettleId` with the member idle — the host
 *    reports idle only at `agent_settled`, never at `agent_end` before a retry), TTL (`openspecLockTtlMs`,
 *    clamped timer, lead notice naming the holder), team close. A disconnected holder keeps the lock.
 *  - Restart: holders/waiters that are gone are dropped and the next waiter granted, the grant is re-sent to a
 *    holder with `grantMailed:false` and the TTL is re-armed from `grantedAt` (elapsed ⇒ released at once).
 * The lock is advisory (see `lockBriefingText`). A member `SendMessage` of kind `lock_grant` is refused by
 * core with `kind_reserved` (members may only send kind `message`).
 * See change: add-agent-teams-openspec.
 */
import { CUSTOM_TYPE_MAIL, registerMailKind } from "../../shared/mail-format.js";
import type { ErrorCode, OpResult } from "../../shared/protocol.js";
import { RELEASED_MEMBER_STATUSES, type Team } from "../../shared/types.js";
import { isRecord, own } from "../args.js";
import { OPENSPEC_DEFAULTS } from "./config.js";
import { OPENSPEC_COUNTERS } from "./log.js";
import type { OpenspecApi } from "./profiles.js";

/** Mail kind of the server's hand-over notice (sender `server`; rendered through the generic mail fallback). */
export const LOCK_GRANT_KIND = "lock_grant";
/** Resources a group team declares. */
export const GROUP_RESOURCES: readonly string[] = ["harness"];
export const LOCK_NAME_RE = /^[a-z0-9-]{1,40}$/;
/** The largest delay `setTimeout` accepts (2^31 − 1); longer values fire immediately in Node. */
export const MAX_TIMER_MS = 2 ** 31 - 1;
/** Delay before a TTL release that failed on a sidecar write is tried again. */
const TTL_RETRY_MS = 5000;

/** Codes new with the lock; core's closed `ErrorCode` union does not list them (the lane passes any string through). */
type LockErrorCode = "no_resources" | "unknown_resource" | "not_holder" | "queue_full" | "sidecar_write_failed" | "sidecar_missing";

type LockResult =
  | { granted: true }
  | { granted: false; holder: string; position: number }
  | { released: true; next?: string }
  | { holder: string | null; position: number | null; queued: number };

const lockFail = (error: LockErrorCode | ErrorCode, message?: string): OpResult<never> => ({ ok: false, error: error as ErrorCode, ...(message !== undefined ? { message } : {}) });

/** Briefing paragraph of a group teammate (the launcher briefing embeds it). */
export function lockBriefingText(resources: readonly string[] = GROUP_RESOURCES): string {
  const names = resources.map((r) => `"${r}"`).join(", ");
  return [
    `Shared resource lock (${names}): take it with ResourceLock {action:"acquire", name} only around the step that needs it, and give it back with {action:"release", name} right after.`,
    "If the answer is granted:false you are queued: do NOT start that step and end your turn instead of polling; a lock_grant message wakes you when the lock is yours.",
    "Do not end your turn while you hold the lock: an idle teammate loses it.",
    "The lock is advisory: it does not stop a direct harness start, and the harness start script's own memory guard remains the hard backstop.",
  ].join("\n");
}

const keyOf = (teamId: string, name: string): string => `${teamId}\u0000${name}`;
const isReleased = (status: string): boolean => (RELEASED_MEMBER_STATUSES as readonly string[]).includes(status);

interface ResourceLocks {
  /** Reconcile one team's locks against its members (drop dead waiters/holders, settled-idle release, arm TTL, resend a grant). */
  reconcile(team: Team): void;
  /** Clear every timer. */
  dispose(): void;
  /** Number of armed TTL timers (tests). */
  readonly timers: number;
  /** The `ResourceLock` op (caller identity comes from the lane, never from `raw`). */
  handle(raw: unknown, caller: { role: string; name: string; team?: Team }): OpResult<LockResult>;
}

function createResourceLocks(api: OpenspecApi): ResourceLocks {
  const { deps, sidecar, log } = api;
  const { store, ops, clock } = deps;
  const ttlTimers = new Map<string, unknown>();
  /** Holder's `lastSettleId` when it was granted (a later settle with the member idle releases the lock). */
  const settleBase = new Map<string, number>();
  /** `<key>@<grantedAt>` whose grant mail was already tried in this process. */
  const mailTried = new Set<string>();
  const reconciling = new Set<string>();
  const again = new Set<string>();

  const ttlMs = (): number => {
    const res = api.config({ effectiveMaxTeammates: 10 });
    return res.ok ? res.config.lockTtlMs : OPENSPEC_DEFAULTS.lockTtlMs;
  };

  const writeFailed = (team: Team, name: string, what: string, message: string): OpResult<never> => {
    log.record("error", "lock_sidecar_write_failed", OPENSPEC_COUNTERS.sidecarWriteFailed, team.id, { lock: name, op: what });
    return lockFail("sidecar_write_failed", message);
  };

  function clearState(key: string): void {
    const t = ttlTimers.get(key);
    if (t !== undefined) clock.clearTimeout(t);
    ttlTimers.delete(key);
    settleBase.delete(key);
  }

  /** A waiter may receive the lock: it exists and is not gone / failed / shutdown_pending. */
  function liveWaiter(team: Team, name: string): boolean {
    const m = store.member(team, name);
    return m !== undefined && !isReleased(m.status) && m.status !== "shutdown_pending";
  }

  // ── grant side effects ──────────────────────────────────────────────────────

  function sendGrant(team: Team, name: string, holder: string, grantedAt: number): void {
    const key = keyOf(team.id, name);
    mailTried.add(`${key}@${grantedAt}`);
    const text = `You now hold the "${name}" lock. Start the step that needs it now and release it right after (ResourceLock {action:"release", name:"${name}"}). Do not end your turn while you hold it.`;
    const sent = ops.sendServerMail(team, holder, { kind: LOCK_GRANT_KIND, text, wake: true, details: { resource: name } });
    if (!sent.ok) {
      log.event("warn", "lock_grant_mail_failed", team.id, { lock: name, code: sent.error });
      return;
    }
    const res = sidecar.update(team.id, (d) => {
      const rec = d.locks[name];
      if (rec?.holder === holder && rec.grantedAt === grantedAt) rec.grantMailed = true;
    });
    if (!res.ok) log.event("warn", "lock_grantmailed_write_failed", team.id, { lock: name, code: res.error });
  }

  /** A new holder: baseline for the settle detection, TTL timer, and (when `mail`) the waking grant mail. */
  function onGranted(team: Team, name: string, holder: string, grantedAt: number, mail: boolean): void {
    const key = keyOf(team.id, name);
    clearState(key);
    const m = store.member(team, holder);
    settleBase.set(key, m?.lastSettleId ?? 0);
    log.record("info", "lock_granted", OPENSPEC_COUNTERS.lockGranted, team.id, { lock: name, member: holder, mailed: mail });
    if (mail) sendGrant(team, name, holder, grantedAt);
    armTtl(team, name, grantedAt);
  }

  // ── release / handoff ───────────────────────────────────────────────────────

  /** Release the lock and hand it to the oldest live waiter in ONE sidecar write; a failed write changes nothing. */
  function release(team: Team, name: string, reason: string): { ok: true; from?: string; next?: string } | { ok: false; error: string; message: string } {
    let from: string | undefined;
    let next: string | undefined;
    let grantedAt = 0;
    const res = sidecar.update(team.id, (d) => {
      const rec = d.locks[name];
      if (!rec) return;
      from = rec.holder;
      const rest: string[] = [];
      for (const w of rec.queue) {
        if (next === undefined && w !== from && liveWaiter(team, w)) next = w;
        else if (next !== undefined) rest.push(w);
      }
      rec.queue = rest;
      if (next !== undefined) {
        rec.holder = next;
        rec.grantedAt = clock.now();
        rec.grantMailed = false;
        grantedAt = rec.grantedAt;
      } else {
        delete d.locks[name];
      }
    });
    if (!res.ok) return { ok: false, error: res.error, message: res.message };
    const key = keyOf(team.id, name);
    clearState(key);
    log.event("info", "lock_released", team.id, { lock: name, reason, ...(from ? { member: from } : {}), ...(next ? { next } : {}) });
    if (next !== undefined) onGranted(team, name, next, grantedAt, true);
    return { ok: true, ...(from !== undefined ? { from } : {}), ...(next !== undefined ? { next } : {}) };
  }

  // ── TTL ─────────────────────────────────────────────────────────────────────

  function armTtl(team: Team, name: string, grantedAt: number): void {
    const key = keyOf(team.id, name);
    const prev = ttlTimers.get(key);
    if (prev !== undefined) clock.clearTimeout(prev);
    ttlTimers.delete(key);
    const ttl = ttlMs();
    const remaining = grantedAt + ttl - clock.now();
    if (remaining <= 0) {
      onTtl(team.id, name, grantedAt, ttl);
      return;
    }
    ttlTimers.set(key, clock.setTimeout(() => onTtl(team.id, name, grantedAt, ttl), Math.min(remaining, MAX_TIMER_MS)));
  }

  function onTtl(teamId: string, name: string, grantedAt: number, ttl: number): void {
    const key = keyOf(teamId, name);
    ttlTimers.delete(key);
    const team = store.get(teamId);
    const rec = sidecar.get(teamId)?.locks[name];
    if (!team || team.status === "closed" || !rec?.holder || rec.grantedAt !== grantedAt) return;
    if (clock.now() < grantedAt + ttl) {
      armTtl(team, name, grantedAt); // fired early (clamped delay): wait the rest
      return;
    }
    const holder = rec.holder;
    const out = release(team, name, "ttl");
    if (!out.ok) {
      log.event("error", "lock_ttl_release_failed", teamId, { lock: name, code: out.error });
      ttlTimers.set(key, clock.setTimeout(() => onTtl(teamId, name, grantedAt, ttl), TTL_RETRY_MS));
      return;
    }
    log.record("warn", "lock_expired", OPENSPEC_COUNTERS.lockExpired, teamId, { lock: name, member: holder });
    const handover = out.next ? ` ${out.next} now holds it.` : "";
    ops.enqueueLeadNotice(team, { text: `Resource lock "${name}" held by ${holder} was released after the ${Math.round(ttl / 1000)} s time limit (holder did not release it).${handover}`, wake: true });
  }

  // ── reconcile ───────────────────────────────────────────────────────────────

  function closeTeam(team: Team): void {
    const prefix = `${team.id}\u0000`;
    for (const k of [...ttlTimers.keys(), ...settleBase.keys()]) if (k.startsWith(prefix)) clearState(k);
    for (const k of [...mailTried]) if (k.startsWith(prefix)) mailTried.delete(k);
    const d = sidecar.get(team.id);
    if (d && Object.keys(d.locks).length > 0) sidecar.update(team.id, (x) => void (x.locks = {}));
  }

  function reconcileOnce(team: Team): void {
    if (team.status === "closed") return closeTeam(team);
    const d = sidecar.get(team.id);
    if (!d || d.lost) return;
    for (const name of Object.keys(d.locks)) {
      let rec = sidecar.get(team.id)?.locks[name];
      if (!rec) continue;
      const key = keyOf(team.id, name);
      const holder = rec.holder;
      const hm = holder === undefined ? undefined : store.member(team, holder);
      if (holder !== undefined && (!hm || isReleased(hm.status))) {
        const out = release(team, name, "holder_gone");
        if (!out.ok) log.event("warn", "lock_release_deferred", team.id, { lock: name, code: out.error });
        continue;
      }
      if (rec.queue.some((w) => !store.member(team, w) || isReleased(store.member(team, w)?.status ?? "gone"))) {
        const res = sidecar.update(team.id, (x) => {
          const r = x.locks[name];
          if (r) r.queue = r.queue.filter((w) => {
            const m = store.member(team, w);
            return m !== undefined && !isReleased(m.status);
          });
        });
        if (!res.ok) log.event("warn", "lock_queue_prune_failed", team.id, { lock: name, code: res.error });
        rec = sidecar.get(team.id)?.locks[name] ?? rec;
      }
      if (holder === undefined || !hm) continue;
      if (!settleBase.has(key)) settleBase.set(key, hm.lastSettleId);
      const base = settleBase.get(key) as number;
      if (hm.lastSettleId !== base) {
        if (hm.status === "idle" || hm.status === "shutdown_pending") {
          const out = release(team, name, "holder_idle");
          if (!out.ok) log.event("warn", "lock_release_deferred", team.id, { lock: name, code: out.error });
          continue;
        }
        settleBase.set(key, hm.lastSettleId); // a settle the gates turned back into busy: consumed
      }
      if (rec.grantedAt !== undefined && !ttlTimers.has(key)) armTtl(team, name, rec.grantedAt);
      const after = sidecar.get(team.id)?.locks[name];
      if (after?.holder === holder && after.grantMailed === false && after.grantedAt !== undefined && !mailTried.has(`${key}@${after.grantedAt}`)) sendGrant(team, name, holder, after.grantedAt);
    }
  }

  function reconcile(team: Team): void {
    if (api.profileOf(team) !== "group") return;
    const d = sidecar.get(team.id);
    if (!d || d.lost || (Object.keys(d.locks).length === 0 && team.status !== "closed")) return;
    if (reconciling.has(team.id)) {
      again.add(team.id);
      return;
    }
    reconciling.add(team.id);
    try {
      do reconcileOnce(team);
      while (again.delete(team.id));
    } catch (err) {
      log.event("error", "lock_reconcile_failed", team.id, { error: (err as Error).name });
    } finally {
      reconciling.delete(team.id);
    }
  }

  return {
    reconcile,
    dispose() {
      for (const t of ttlTimers.values()) clock.clearTimeout(t);
      ttlTimers.clear();
      settleBase.clear();
      mailTried.clear();
    },
    get timers() {
      return ttlTimers.size;
    },
    handle,
  };

  // ── the op ──────────────────────────────────────────────────────────────────

  function handle(raw: unknown, caller: { role: string; name: string; team?: Team }): OpResult<LockResult> {
    const team = caller.team;
    if (caller.role !== "member" || !team) return lockFail("not_in_team", "ResourceLock is a teammate tool");
    if (!isRecord(raw) || Object.keys(raw).some((k) => k !== "action" && k !== "name")) return lockFail("invalid_args", "args must be {action, name}");
    const action = own(raw, "action");
    const name = own(raw, "name");
    if (action !== "acquire" && action !== "release" && action !== "status") return lockFail("invalid_args", "action must be acquire, release or status");
    if (typeof name !== "string" || !LOCK_NAME_RE.test(name)) return lockFail("invalid_args", "name must be 1-40 characters of a-z, 0-9 and -");
    if (api.profileOf(team) !== "group") return lockFail("no_resources", "this team declares no resources");
    const state = api.teamState(team);
    if (state === "sidecar_missing") return lockFail("sidecar_missing", "the OpenSpec state of this team was lost; the lock is off");
    if (state !== "active") return lockFail("no_resources", `the resource lock is off for this team (${state})`);
    if (!GROUP_RESOURCES.includes(name)) return lockFail("unknown_resource", name);
    const me = caller.name;
    const rec = sidecar.get(team.id)?.locks[name];
    if (action === "status") {
      const at = rec?.queue.indexOf(me) ?? -1;
      return { ok: true, data: { holder: rec?.holder ?? null, position: at >= 0 ? at + 1 : null, queued: rec?.queue.length ?? 0 } };
    }
    return action === "acquire" ? acquire(team, name, me, rec) : releaseOp(team, name, me, rec);
  }

  function acquire(team: Team, name: string, me: string, rec: { holder?: string; queue: string[] } | undefined): OpResult<LockResult> {
    if (rec?.holder !== undefined && rec.holder !== me) {
      const at = rec.queue.indexOf(me);
      if (at >= 0) return { ok: true, data: { granted: false, holder: rec.holder, position: at + 1 } };
      if (rec.queue.length >= team.maxTeammates) return lockFail("queue_full", `at most ${team.maxTeammates} waiters`);
      const res = sidecar.update(team.id, (d) => {
        (d.locks[name] ??= { queue: [] }).queue.push(me);
      });
      if (!res.ok) return writeFailed(team, name, "acquire", res.message);
      log.count(OPENSPEC_COUNTERS.lockWaited, team.id);
      return { ok: true, data: { granted: false, holder: rec.holder, position: rec.queue.length + 1 } };
    }
    const now = clock.now();
    const res = sidecar.update(team.id, (d) => {
      const r = (d.locks[name] ??= { queue: [] });
      r.queue = r.queue.filter((w) => w !== me);
      r.holder = me;
      r.grantedAt = now;
      r.grantMailed = true; // answered directly: no mail
    });
    if (!res.ok) return writeFailed(team, name, "acquire", res.message);
    const refreshed = rec?.holder === me;
    if (refreshed) armTtl(team, name, now);
    else onGranted(team, name, me, now, false);
    return { ok: true, data: { granted: true } };
  }

  function releaseOp(team: Team, name: string, me: string, rec: { holder?: string; queue: string[] } | undefined): OpResult<LockResult> {
    if (rec?.holder === me) {
      const out = release(team, name, "released");
      if (!out.ok) return writeFailed(team, name, "release", out.message);
      return { ok: true, data: { released: true, ...(out.next ? { next: out.next } : {}) } };
    }
    if (rec?.queue.includes(me)) {
      const res = sidecar.update(team.id, (d) => {
        const r = d.locks[name];
        if (r) r.queue = r.queue.filter((w) => w !== me);
      });
      if (!res.ok) return writeFailed(team, name, "dequeue", res.message);
      return { ok: true, data: { released: true } };
    }
    return lockFail("not_holder", `${me} neither holds nor waits for ${name}`);
  }
}

/** Slice entry: register the op and the mail kind, follow member/team changes, reload persisted locks. */
export function register(api: OpenspecApi): void {
  const { deps } = api;
  registerMailKind(LOCK_GRANT_KIND, CUSTOM_TYPE_MAIL);
  const locks = createResourceLocks(api);
  deps.ops.registerOp("ResourceLock", (args, caller) => {
    try {
      return locks.handle(args, caller);
    } catch (err) {
      api.log.event("error", "lock_op_failed", caller.team?.id, { error: (err as Error).name });
      return lockFail("invalid_args", "ResourceLock failed");
    }
  });
  api.onStoreEvent("change", ({ team }) => locks.reconcile(team));
  api.onStoreEvent("team_closed", ({ team }) => locks.reconcile(team));
  api.onDispose(() => locks.dispose());
  for (const team of deps.store.list()) locks.reconcile(team); // restart: drop dead holders/waiters, re-arm TTL, resend grants
}
