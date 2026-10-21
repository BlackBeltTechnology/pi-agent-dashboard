/**
 * `POST /api/pi-trust/query` — the live trust query a bridge sends at pi's
 * `project_trust` when its snapshot does not cover the cwd.
 *
 * Order (design D1): authenticate (before any trust state is read) → per-requester
 * rate limit → body cap + validation → server switches and deny rules → cover
 * lookup → proof → YOLO liveness re-check.
 *
 *   - Admission: a genuinely local requester (loopback, no forwarding headers, a
 *     VERIFIED endpoint-bound local-credential proof — the raw legacy token and a
 *     login cookie do not suffice) or a paired device at `operate` (tier enforced
 *     by the global `route-tier-gate` through `ROUTE_TIERS`).
 *   - Local answer: the covering folder + the identity recorded when the entry was
 *     created. Remote (device) answer: `{covered, salt, digest}` only — a salted
 *     digest of pi's trust-requiring resources, run under a global semaphore of 4
 *     (1 per device). Anything that cannot be bound answers `{covered:false}`.
 *   - Limits: 20 queries / 10 s per device, 200 / 10 s for the local user; one log
 *     line per window. Counters feed `/api/health` `piTrustMirror.live`.
 *
 * No new secret and no new credential type. Nothing here writes pi's trust store.
 *
 * See change: mirror-dashboard-trust-live-remote (D1, D3–D6).
 */
import os from "node:os";
import { effectiveLiveQueryTimeoutMs, type PiTrustMirrorConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { isLoopbackHost } from "@blackbelt-technology/pi-dashboard-shared/loopback-host.js";
import {
  PI_TRUST_QUERY_MAX_BODY_BYTES,
  PI_TRUST_QUERY_PATH,
  type PiTrustLiveAnswer,
  validatePiTrustQueryBody,
} from "@blackbelt-technology/pi-dashboard-shared/pi-trust-live-query.js";
import { isMirrorDenied, type MirrorDenyRules, mirrorDenyRules } from "@blackbelt-technology/pi-dashboard-shared/pi-trust-mirror.js";
import { coverSnapshot, safePiTrustKey } from "@blackbelt-technology/pi-dashboard-shared/pi-trust-mirror-snapshot.js";
import type { PiTrustSnapshot } from "@blackbelt-technology/pi-dashboard-shared/pi-trust-mirror-types.js";
import {
  newTrustSalt,
  trustResourceDigest,
  trustResourceManifest,
} from "@blackbelt-technology/pi-dashboard-shared/pi-trust-resource-digest.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { LiveEntry, PiTrustLiveProvider } from "../access/pi-trust-live.js";
import { credentialVerdict } from "../auth/local-credential.js";
import { hasProxyForwardingHeaders } from "../auth/localhost-guard.js";

export interface PiTrustLiveCounters {
  covered: number;
  notCovered: number;
  refused: number;
  rateLimited: number;
  budgetMissed: number;
}

export interface PiTrustQueryDeps {
  getConfig: () => PiTrustMirrorConfig;
  /** Live (server-lifetime) entries, when the provider exists. */
  live: () => PiTrustLiveProvider | undefined;
  /** The durable snapshot as written (recorded identities), or null. */
  readSnapshot: () => PiTrustSnapshot | null;
  home?: string;
  denyRules?: () => MirrorDenyRules;
  /** Test seams. */
  manifest?: typeof trustResourceManifest;
  nowMs?: () => number;
  log?: (line: string) => void;
  /** Hook-hash probe for durable worktree-init entries (default: reads `.pi/settings.json`). */
  hookHash?: (configRoot: string) => string | null;
}

const WINDOW_MS = 10_000;
const LOCAL_QUERIES_PER_WINDOW = 200;
const DEVICE_QUERIES_PER_WINDOW = 20;
const GLOBAL_PROOF_PERMITS = 4;
const DEVICE_PROOF_PERMITS = 1;
const MAX_TRACKED_REQUESTERS = 1000;

/** Strip control characters (incl. ESC / newlines) and cap the length of anything logged. */
function sanitizeForLog(value: unknown, max = 200): string {
  return String(value)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "?")
    .slice(0, max);
}

type Requester = { kind: "local" } | { kind: "device"; id: string };

interface Started {
  requester: Requester;
  startedAt: number;
}

const STARTED = Symbol("pi-trust-query-started");

/** Fixed-window counter per requester key; reports only the first refusal of each window. */
class WindowLimiter {
  private readonly windows = new Map<string, { start: number; count: number; logged: boolean }>();

  allow(key: string, limit: number, now: number): { ok: true } | { ok: false; firstInWindow: boolean } {
    let w = this.windows.get(key);
    if (!w || now - w.start >= WINDOW_MS) {
      if (this.windows.size >= MAX_TRACKED_REQUESTERS) this.prune(now);
      w = { start: now, count: 0, logged: false };
      this.windows.set(key, w);
    }
    if (w.count < limit) {
      w.count += 1;
      return { ok: true };
    }
    const firstInWindow = !w.logged;
    w.logged = true;
    return { ok: false, firstInWindow };
  }

  private prune(now: number): void {
    for (const [k, w] of this.windows) if (now - w.start >= WINDOW_MS) this.windows.delete(k);
  }
}

/** Global + per-device permits for remote proof computation. */
class ProofPermits {
  private total = 0;
  private readonly perDevice = new Map<string, number>();

  tryAcquire(device: string): boolean {
    if (this.total >= GLOBAL_PROOF_PERMITS) return false;
    if ((this.perDevice.get(device) ?? 0) >= DEVICE_PROOF_PERMITS) return false;
    this.total += 1;
    this.perDevice.set(device, (this.perDevice.get(device) ?? 0) + 1);
    return true;
  }

  release(device: string): void {
    this.total = Math.max(0, this.total - 1);
    const n = (this.perDevice.get(device) ?? 1) - 1;
    if (n <= 0) this.perDevice.delete(device);
    else this.perDevice.set(device, n);
  }
}

/** A covering entry, durable or live, with the identity a LOCAL answer carries. */
interface Cover {
  key: string;
  sourceKind: PiTrustLiveAnswerSource;
  dev: string;
  ino: string;
  birthtimeMs?: number;
  live?: LiveEntry;
}
type PiTrustLiveAnswerSource = Extract<PiTrustLiveAnswer, { sourceKind: string }>["sourceKind"];

function classify(request: FastifyRequest): Requester | null {
  const headers = request.headers as Record<string, unknown>;
  // Genuinely local: loopback peer, no forwarding header, and a fully VERIFIED proof
  // (MAC, endpoint + method + path binding, freshness, replay cache). The raw legacy
  // token (`kind: "legacy"`) is deliberately not enough here.
  if (
    credentialVerdict(headers).kind === "proof" &&
    isLoopbackHost(request.ip ?? "") &&
    !hasProxyForwardingHeaders(headers)
  ) {
    return { kind: "local" };
  }
  const via = (request as unknown as { authVia?: string }).authVia;
  if (via === "device") {
    const id = (request as unknown as { principalDeviceId?: string }).principalDeviceId;
    return { kind: "device", id: typeof id === "string" && id ? id : "device" };
  }
  return null;
}

export function registerPiTrustQueryRoutes(
  fastify: FastifyInstance,
  deps: PiTrustQueryDeps,
): { counters: () => PiTrustLiveCounters } {
  const home = deps.home ?? os.homedir();
  const nowMs = deps.nowMs ?? (() => Date.now());
  const log = deps.log ?? ((line: string) => console.warn(line));
  const manifestOf = deps.manifest ?? trustResourceManifest;
  const counters: PiTrustLiveCounters = { covered: 0, notCovered: 0, refused: 0, rateLimited: 0, budgetMissed: 0 };
  const limiter = new WindowLimiter();
  const permits = new ProofPermits();

  /** Authenticate first, then rate-limit — all before the body is parsed or any trust state is read. */
  async function admit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const who = classify(request);
    if (!who) {
      counters.refused += 1;
      reply.code(401).send({ success: false, error: "unauthorized" });
      return;
    }
    const limit = who.kind === "local" ? LOCAL_QUERIES_PER_WINDOW : DEVICE_QUERIES_PER_WINDOW;
    const key = who.kind === "local" ? "local" : `device:${who.id}`;
    const verdict = limiter.allow(key, limit, nowMs());
    if (!verdict.ok) {
      if (verdict.firstInWindow) {
        log(
          `[pi-trust-query] rate limited requester=${sanitizeForLog(key)} limit=${limit}/${WINDOW_MS / 1000}s ` +
            `(further refusals in this window are not logged)`,
        );
      }
      counters.rateLimited += 1;
      reply.code(429).send({ success: false, error: "rate_limited" });
      return;
    }
    (request as unknown as Record<symbol, Started>)[STARTED] = { requester: who, startedAt: nowMs() };
  }

  /** The nearest counted entry covering `key`, durable or live (live wins only when nearer). */
  function findCover(key: string): Cover | null {
    let best: Cover | null = null;
    const snapshotCover = coverSnapshot(deps.readSnapshot(), key, deps.hookHash ? { currentHookHash: deps.hookHash } : {});
    if (snapshotCover.covered) {
      const e = snapshotCover.entry;
      best = {
        key: e.key,
        sourceKind: e.sourceKind,
        dev: e.dev,
        ino: e.ino,
        ...(e.birthtimeMs !== undefined ? { birthtimeMs: e.birthtimeMs } : {}),
      };
    }
    const live = deps.live()?.covering(key);
    if (live && (!best || live.key.length > best.key.length)) {
      best = {
        key: live.key,
        sourceKind: live.sourceKind,
        dev: live.identity.dev,
        ino: live.identity.ino,
        ...(live.identity.birthtimeMs !== undefined ? { birthtimeMs: live.identity.birthtimeMs } : {}),
        live,
      };
    }
    return best;
  }

  /** Body → the server's own canonical key, or a 400 / an immediate "not covered". */
  function canonicalKey(body: unknown): { key: string } | { status: number; error: string } | { notCovered: true } {
    const checked = validatePiTrustQueryBody(body);
    if (!checked.ok) return { status: checked.status, error: checked.error };
    let key: string | null;
    try {
      key = safePiTrustKey(checked.cwd, home);
    } catch {
      key = null;
    }
    if (key === null) return { status: 400, error: "cwd malformed" };
    // A symlink or `..` confusion: the bridge's key must be OUR key for that path.
    return key === checked.cwd ? { key } : { notCovered: true };
  }

  /** The server's own switches and deny rules: may this folder be answered at all? */
  function mayAnswer(key: string): boolean {
    const cfg = deps.getConfig();
    if (!cfg.enabled || !cfg.liveQuery) return false;
    const deny = deps.denyRules ? deps.denyRules() : mirrorDenyRules({ homedir: home });
    return !isMirrorDenied(key, deny);
  }

  /** The entry may have ended since the lookup (YOLO expiry / end): never answer from a dead one. */
  const stillLive = (cover: Cover): boolean => !cover.live || deps.live()?.isStillLive(cover.live) === true;

  function localAnswer(cover: Cover): PiTrustLiveAnswer {
    if (!stillLive(cover)) return { covered: false };
    return {
      covered: true,
      key: cover.key,
      sourceKind: cover.sourceKind,
      dev: cover.dev,
      ino: cover.ino,
      ...(cover.birthtimeMs !== undefined ? { birthtimeMs: cover.birthtimeMs } : {}),
    };
  }

  /** Remote: salted digest of pi's trust-requiring resources, under permits. `null` = permits exhausted. */
  async function remoteAnswer(deviceId: string, key: string, cover: Cover): Promise<PiTrustLiveAnswer | null> {
    if (!permits.tryAcquire(deviceId)) {
      const rl = limiter.allow(`permit:${deviceId}`, 0, nowMs());
      if (!rl.ok && rl.firstInWindow) {
        log(`[pi-trust-query] proof permits exhausted requester=${sanitizeForLog(deviceId)} cwd=${sanitizeForLog(key)}`);
      }
      return null;
    }
    let manifest: string | null;
    try {
      manifest = await manifestOf(key, { home });
    } finally {
      permits.release(deviceId);
    }
    if (manifest === null || !stillLive(cover)) return { covered: false };
    const salt = newTrustSalt();
    return { covered: true, salt, digest: trustResourceDigest(salt, key, manifest) };
  }

  type Outcome = { answer: PiTrustLiveAnswer } | { status: number; error: string };

  async function evaluate(requester: Requester, body: unknown): Promise<Outcome> {
    const notCovered: Outcome = { answer: { covered: false } };
    const canonical = canonicalKey(body);
    if ("status" in canonical) return canonical;
    if ("notCovered" in canonical || !mayAnswer(canonical.key)) return notCovered;
    const cover = findCover(canonical.key);
    if (!cover) return notCovered;
    if (requester.kind === "local") return { answer: localAnswer(cover) };
    const answer = await remoteAnswer(requester.id, canonical.key, cover);
    return answer ? { answer } : { status: 429, error: "rate_limited" };
  }

  fastify.post(
    PI_TRUST_QUERY_PATH,
    { bodyLimit: PI_TRUST_QUERY_MAX_BODY_BYTES, onRequest: admit },
    async (request, reply): Promise<PiTrustLiveAnswer | { success: false; error: string }> => {
      const started = (request as unknown as Record<symbol, Started | undefined>)[STARTED];
      const requester: Requester = started?.requester ?? { kind: "local" };
      const startedAt = started?.startedAt ?? nowMs();

      const outcome = await evaluate(requester, request.body);
      if ("status" in outcome) {
        if (outcome.status === 429) counters.rateLimited += 1;
        reply.code(outcome.status);
        return { success: false, error: outcome.error };
      }
      if (outcome.answer.covered) counters.covered += 1;
      else counters.notCovered += 1;
      const budget = effectiveLiveQueryTimeoutMs(deps.getConfig(), requester.kind === "device");
      if (nowMs() - startedAt > budget) counters.budgetMissed += 1;
      return outcome.answer;
    },
  );

  return { counters: () => ({ ...counters }) };
}
