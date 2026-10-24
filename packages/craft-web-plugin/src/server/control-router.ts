/**
 * Server router of live agent control (design D1, D2, D7): one `craft_control` request runs in at most ONE
 * live, visible editor instance, and the answer is bounded in time.
 *
 *   request(lane) ─ resolve path ─ probe (session-scoped) ─ claims ─ choose ─ run (session-scoped) ─ result
 *
 * Trust: claims and results are plugin message types, so they reach this router only from `operate`-tier
 * sockets. A result is accepted only from the socket OBJECT that claimed the instance, once, within the TTL.
 * Probe / run are `broadcastToSubscribers` frames carrying `sessionId`; the router never sends on a retained
 * socket. Claims are self-reports of the session's principal (accepted, see the design's Risks).
 *
 * See change: add-craft-live-control (D1, D2, D7).
 */
import { randomUUID } from "node:crypto";
import {
  CLAIM_GRACE_MS,
  CLAIM_WINDOW_MS,
  CLIENT_ERROR_CODES,
  type ClaimStatus,
  CONTROL_PROBE,
  CONTROL_RUN,
  type ControlErrorCode,
  type ControlPathForms,
  ERROR_MAX_BYTES,
  FOCUS_RECENT_MS,
  jsonBytes,
  RATE_LIMIT,
  RATE_WINDOW_MS,
  REPLY_MAX_BYTES,
  SERVER_TTL_MS,
  truncateUtf8,
} from "../shared/control-protocol.js";

/** What the bridge tool gets back: always a value, never a throw (the lane maps its own failures). */
export type ControlRouterReply =
  | { ok: true; instance: string; app: string; result: unknown; saveRequested?: boolean; saveSeq?: number }
  | { ok: false; code: ControlErrorCode; message: string; instance?: string };

export interface ControlRouterDeps {
  /** `ctx.broadcastToSubscribers`. */
  broadcast(msg: unknown): void;
  /** Working directory of a session, or `undefined` when unknown. */
  sessionCwd(sessionId: string): string | undefined;
  /** `plugins['craft-web'].liveControl !== false`. */
  liveControlEnabled(): boolean;
  /** `fs.realpathSync` or a test double; `undefined` when the path does not exist. */
  realpath(p: string): string | undefined;
  caseInsensitive: boolean;
  /** CSPRNG uuid (`crypto.randomUUID`). */
  newId?: () => string;
  now?: () => number;
  /** App that claims a file extension (`.svg` → `vectorcraft`), for telemetry only. */
  appForPath(path: string): string | undefined;
  telemetry?(app: string, outcome: string, ms: number): void;
  log?: { info(msg: string): void; warn(msg: string): void };
}

interface Claim {
  ws: unknown;
  instanceId: string;
  status: ClaimStatus;
  msSinceFocus: number;
  at: number;
}

interface Pending {
  sessionId: string;
  claims: Claim[];
  seen: Claim[];
  closed: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
  graceStarted: boolean;
  close: () => void;
}

interface Inflight {
  sessionId: string;
  ws: unknown;
  instanceId: string;
  app: string;
  settle: (r: ControlRouterReply) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface Owner {
  ws: unknown;
  sessionId: string;
  app: string;
}

const OWNER_CAP = 256;
/** A browser socket that reports a `readyState` other than OPEN (1) is gone: its claim no longer counts. */
const socketOpen = (ws: unknown): boolean => !(typeof ws === "object" && ws !== null && typeof (ws as { readyState?: unknown }).readyState === "number" && (ws as { readyState: number }).readyState !== 1);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const nfc = (s: string): string => s.normalize("NFC");

/** Most specific reason when no instance is eligible (design D2): visible-but-hidden beats not-ready beats unsupported. */
function reasonFor(claims: readonly Claim[]): ControlRouterReply {
  const has = (s: ClaimStatus) => claims.some((c) => c.status === s);
  if (has("not-visible")) return fail("not-visible", "The file is open but its tab is not the active, visible one. Ask the user to bring it to the front.");
  if (has("not-ready")) return fail("not-ready", "The editor is still starting or has not opened the document yet. Try again in a few seconds.");
  if (has("unsupported"))
    return fail("unsupported", "The open editor does not support live control (no page API in this build). Update the app in Settings → Update, or use the headless pi-craft tools.");
  return fail("not-open", "The file is not open in a live editor. It must be open and visible on a device with full operating rights.");
}

function fail(code: ControlErrorCode, message: string, instance?: string): ControlRouterReply {
  return { ok: false, code, message, ...(instance ? { instance } : {}) };
}

export interface ControlRouter {
  /** Lane handler body of `craft-web/control`. */
  request(payload: unknown, meta: { sessionId: string }): Promise<ControlRouterReply>;
  /** `registerBrowserHandler("craft-web/control-claim")`. */
  onClaim(msg: unknown, ws: unknown): void;
  /** `registerBrowserHandler("craft-web/control-result")`. */
  onResult(msg: unknown, ws: unknown): void;
  /** `registerBrowserHandler("craft-web/control-gone")`. */
  onGone(msg: unknown, ws: unknown): void;
  /** Tests: drop all timers. */
  dispose(): void;
}

export function createControlRouter(deps: ControlRouterDeps): ControlRouter {
  const newId = deps.newId ?? (() => randomUUID());
  const now = deps.now ?? (() => Date.now());
  const pending = new Map<string, Pending>();
  const inflight = new Map<string, Inflight>();
  const owners = new Map<string, Owner>();
  const rate = new Map<string, number[]>();

  const remember = (instanceId: string, owner: Owner): void => {
    owners.delete(instanceId);
    owners.set(instanceId, owner);
    if (owners.size > OWNER_CAP) owners.delete(owners.keys().next().value as string);
  };

  /** Sliding window of routed requests per session; `host.state` never reaches this. */
  function admit(sessionId: string): boolean {
    const t = now();
    const recent = (rate.get(sessionId) ?? []).filter((x) => t - x < RATE_WINDOW_MS);
    if (recent.length >= RATE_LIMIT) {
      rate.set(sessionId, recent);
      return false;
    }
    recent.push(t);
    rate.set(sessionId, recent);
    return true;
  }

  function pathForms(rawPath: string, cwd: string): ControlPathForms {
    const abs = nfc(rawPath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(rawPath) ? rawPath : `${cwd}/${rawPath}`);
    const lexical = nfc(normalizeAbs(abs));
    const real = deps.realpath(lexical);
    const root = nfc(normalizeAbs(cwd));
    const under = (p: string) => p === root || p.startsWith(`${root}/`);
    return {
      path: lexical,
      ...(real ? { realPath: nfc(real) } : {}),
      ...(under(lexical) && lexical !== root ? { relPath: lexical.slice(root.length + 1) } : {}),
      caseInsensitive: deps.caseInsensitive,
    };
  }

  /** Broadcast a run and wait for its result (≤ SERVER_TTL_MS). */
  function run(args: { sessionId: string; ws: unknown; instanceId: string; app: string; method: string; params: unknown }): Promise<ControlRouterReply> {
    const reqId = newId();
    return new Promise<ControlRouterReply>((resolve) => {
      const timer = setTimeout(() => {
        if (!inflight.delete(reqId)) return;
        resolve(fail("timeout", "No answer within the time limit. The change may still have been applied (outcome unknown): inspect the document before retrying.", args.instanceId));
      }, SERVER_TTL_MS);
      inflight.set(reqId, { sessionId: args.sessionId, ws: args.ws, instanceId: args.instanceId, app: args.app, settle: resolve, timer });
      deps.broadcast({
        type: CONTROL_RUN,
        sessionId: args.sessionId,
        reqId,
        instanceId: args.instanceId,
        method: args.method,
        params: args.params,
        ttlMs: SERVER_TTL_MS,
      });
    });
  }

  function choose(claims: readonly Claim[]): Claim | "ambiguous" | undefined {
    const eligible = claims.filter((c) => c.status === "eligible" && socketOpen(c.ws));
    if (eligible.length === 0) return undefined;
    if (eligible.length === 1) return eligible[0];
    const best = [...eligible].sort((a, b) => a.msSinceFocus - b.msSinceFocus || a.at - b.at)[0];
    return best.msSinceFocus <= FOCUS_RECENT_MS ? best : "ambiguous";
  }

  function probe(sessionId: string, forms: ControlPathForms): Promise<{ claim: Claim } | { reply: ControlRouterReply }> {
    const reqId = newId();
    return new Promise((resolve) => {
      const p: Pending = {
        sessionId,
        claims: [],
        seen: [],
        closed: false,
        timer: undefined,
        graceStarted: false,
        close: () => {
          if (p.closed) return;
          p.closed = true;
          clearTimeout(p.timer);
          pending.delete(reqId);
          const chosen = choose(p.claims);
          if (chosen === "ambiguous") return resolve({ reply: fail("ambiguous", "The file is open and visible on several devices and none was used recently. Ask the user which one to use, then retry.") });
          if (chosen) return resolve({ claim: chosen });
          resolve({ reply: reasonFor(p.seen.filter((c) => socketOpen(c.ws))) });
        },
      };
      p.timer = setTimeout(p.close, CLAIM_WINDOW_MS);
      pending.set(reqId, p);
      deps.broadcast({ type: CONTROL_PROBE, sessionId, reqId, ...forms });
    });
  }

  interface Parsed {
    method: string;
    params: unknown;
    instance?: string;
    path?: string;
  }

  /** A string field within `1..max` characters, else `undefined`. */
  const text = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined);

  /** Shape of an agent request; a refusal is returned as the reply. */
  function parse(payload: unknown): Parsed | ControlRouterReply {
    const body = isRecord(payload) ? payload : {};
    const method = text(body.method, 64);
    if (!method) return fail("denied", "craft_control needs a `method` string.");
    const instance = text(body.instance, 4096);
    const path = text(body.path, 4096);
    if (!instance && !path) return fail("denied", "craft_control needs a `path` string (or an `instance` handle).");
    if (!instance && method === "host.state") return fail("denied", "host.state needs the `instance` handle returned by an earlier reply.");
    return { method, params: body.params, ...(instance ? { instance } : {}), ...(path ? { path } : {}) };
  }

  /** Follow-up on a known instance: no probe; `host.state` is exempt from the rate limit. */
  async function pinned(p: Parsed & { instance: string }, sessionId: string): Promise<{ reply: ControlRouterReply; app?: string }> {
    const owner = owners.get(p.instance);
    if (!owner || owner.sessionId !== sessionId) return { reply: fail("not-open", "That editor instance is no longer open.") };
    if (p.method !== "host.state" && !admit(sessionId)) return { reply: fail("rate_limited", "Too many craft_control requests; slow down."), app: owner.app };
    return { reply: await run({ sessionId, ws: owner.ws, instanceId: p.instance, app: owner.app, method: p.method, params: p.params }), app: owner.app };
  }

  /** First request on a file: probe the session's instances, choose one, run on it. */
  async function routed(p: Parsed & { path: string }, sessionId: string, app: string | undefined): Promise<ControlRouterReply> {
    if (!admit(sessionId)) return fail("rate_limited", "Too many craft_control requests; slow down.");
    const cwd = deps.sessionCwd(sessionId);
    if (!cwd) return fail("not-open", "The session has no working directory to resolve the path against.");
    const outcome = await probe(sessionId, pathForms(p.path, cwd));
    if ("reply" in outcome) return outcome.reply;
    const owner: Owner = { ws: outcome.claim.ws, sessionId, app: app ?? "unknown" };
    remember(outcome.claim.instanceId, owner);
    return run({ sessionId, ws: owner.ws, instanceId: outcome.claim.instanceId, app: owner.app, method: p.method, params: p.params });
  }

  async function request(payload: unknown, meta: { sessionId: string }): Promise<ControlRouterReply> {
    const started = now();
    const pathApp = isRecord(payload) && typeof payload.path === "string" ? deps.appForPath(payload.path) : undefined;
    const done = (r: ControlRouterReply, app: string | undefined = pathApp): ControlRouterReply => {
      deps.telemetry?.(app ?? "unknown", r.ok ? "ok" : r.code, now() - started);
      return r;
    };
    if (!deps.liveControlEnabled()) return done(fail("disabled", "Live control is switched off in the craft-web plugin settings (liveControl)."));
    const p = parse(payload);
    if ("ok" in p) return done(p);
    if (p.instance) {
      const out = await pinned({ ...p, instance: p.instance }, meta.sessionId);
      return done(out.reply, out.app);
    }
    return done(await routed({ ...p, path: p.path as string }, meta.sessionId, pathApp));
  }

  function onClaim(msg: unknown, ws: unknown): void {
    if (!isRecord(msg) || typeof msg.reqId !== "string" || typeof msg.instanceId !== "string") return;
    const p = pending.get(msg.reqId);
    if (!p || p.closed) return;
    const status = msg.status as ClaimStatus;
    if (!["eligible", "wrong-session", "unsupported", "not-ready", "not-visible"].includes(status)) return;
    const claim: Claim = {
      ws,
      instanceId: msg.instanceId.slice(0, 80),
      status,
      msSinceFocus: typeof msg.msSinceFocus === "number" && Number.isFinite(msg.msSinceFocus) && msg.msSinceFocus >= 0 ? msg.msSinceFocus : Number.MAX_SAFE_INTEGER,
      at: now(),
    };
    p.seen.push(claim);
    if (status !== "eligible") return;
    p.claims.push(claim);
    if (!p.graceStarted) {
      p.graceStarted = true;
      clearTimeout(p.timer);
      p.timer = setTimeout(p.close, CLAIM_GRACE_MS);
    }
  }

  /** A failed client answer: only known codes pass through; text capped at 2 KiB. */
  function failedReply(msg: Record<string, unknown>, instanceId: string): ControlRouterReply {
    const code = typeof msg.code === "string" && CLIENT_ERROR_CODES.has(msg.code) ? (msg.code as ControlErrorCode) : "app_error";
    const text = typeof msg.error === "string" ? truncateUtf8(msg.error, ERROR_MAX_BYTES) : "The app reported an error.";
    return fail(code, text, instanceId);
  }

  /** Shape and size re-check of a client result (design D4): never trust the browser's own validation. */
  function checkedReply(msg: Record<string, unknown>, instanceId: string, app: string): ControlRouterReply {
    if (typeof msg.ok !== "boolean") return fail("app_error", "The editor's reply was malformed.", instanceId);
    if (!msg.ok) return failedReply(msg, instanceId);
    const bytes = jsonBytes(msg.result);
    if (bytes === null) return fail("app_error", "The editor's reply was malformed.", instanceId);
    if (bytes > REPLY_MAX_BYTES) return fail("reply_too_large", `The reply is larger than ${REPLY_MAX_BYTES / 1024} KiB. Ask for less (filter, summary, a smaller selection).`, instanceId);
    return {
      ok: true,
      instance: instanceId,
      app,
      result: msg.result,
      ...(msg.saveRequested === true ? { saveRequested: true } : {}),
      ...(typeof msg.saveSeq === "number" && Number.isFinite(msg.saveSeq) ? { saveSeq: msg.saveSeq } : {}),
    };
  }

  function onResult(msg: unknown, ws: unknown): void {
    if (!isRecord(msg) || typeof msg.reqId !== "string") return;
    const f = inflight.get(msg.reqId);
    if (!f) {
      deps.log?.warn(`craft-web control: dropped a result for an unknown or expired request`);
      return;
    }
    if (ws !== f.ws || msg.instanceId !== f.instanceId) {
      deps.log?.warn(`craft-web control: dropped a result from a socket that did not claim the instance`);
      return;
    }
    inflight.delete(msg.reqId);
    clearTimeout(f.timer);
    f.settle(checkedReply(msg, f.instanceId, f.app));
  }

  function onGone(msg: unknown, ws: unknown): void {
    if (!isRecord(msg) || typeof msg.instanceId !== "string") return;
    const o = owners.get(msg.instanceId);
    if (o && o.ws === ws) owners.delete(msg.instanceId);
  }

  function dispose(): void {
    for (const p of pending.values()) clearTimeout(p.timer);
    for (const f of inflight.values()) clearTimeout(f.timer);
    pending.clear();
    inflight.clear();
  }

  return { request, onClaim, onResult, onGone, dispose };
}

/** Collapse `.`/`..` and duplicate slashes of an absolute path (POSIX or drive-lettered). */
function normalizeAbs(p: string): string {
  const s = p.replace(/\\/g, "/");
  const drive = /^[A-Za-z]:/.exec(s)?.[0] ?? "";
  const out: string[] = [];
  for (const seg of s.slice(drive.length).split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return `${drive}/${out.join("/")}`;
}
