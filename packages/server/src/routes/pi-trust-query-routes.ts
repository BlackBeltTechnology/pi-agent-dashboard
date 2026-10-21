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
export const LOCAL_QUERIES_PER_WINDOW = 200;
export const DEVICE_QUERIES_PER_WINDOW = 20;
export const GLOBAL_PROOF_PERMITS = 4;
export const DEVICE_PROOF_PERMITS = 1;
const MAX_TRACKED_REQUESTERS = 1000;

/** Strip control characters (incl. ESC / newlines) and cap the length of anything logged. */
export function sanitizeForLog(value: unknown, max = 200): string {
  return String(value)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: this IS the control-character filter
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

  fastify.post(
    PI_TRUST_QUERY_PATH,
    { bodyLimit: PI_TRUST_QUERY_MAX_BODY_BYTES, onRequest: admit },
    async (request, reply): Promise<PiTrustLiveAnswer | { success: false; error: string }> => {
      const started = (request as unknown as Record<symbol, Started | undefined>)[STARTED];
      const requester: Requester = started?.requester ?? { kind: "local" };
      const startedAt = started?.startedAt ?? nowMs();
      const remote = requester.kind === "device";

      const finish = (answer: PiTrustLiveAnswer): PiTrustLiveAnswer => {
        if (answer.covered) counters.covered += 1;
        else counters.notCovered += 1;
        const cfg = deps.getConfig();
        if (nowMs() - startedAt > effectiveLiveQueryTimeoutMs(cfg, remote)) counters.budgetMissed += 1;
        return answer;
      };

      const checked = validatePiTrustQueryBody(request.body);
      if (!checked.ok) {
        reply.code(checked.status);
        return { success: false, error: checked.error };
      }
      let key: string | null;
      try {
        key = safePiTrustKey(checked.cwd, home);
      } catch {
        key = null;
      }
      if (key === null) {
        reply.code(400);
        return { success: false, error: "cwd malformed" };
      }
      // A symlink or `..` confusion: the bridge's key must be OUR key for that path.
      if (key !== checked.cwd) return finish({ covered: false });

      const cfg = deps.getConfig();
      if (!cfg.enabled || !cfg.liveQuery) return finish({ covered: false });
      const deny = deps.denyRules ? deps.denyRules() : mirrorDenyRules({ homedir: home });
      if (isMirrorDenied(key, deny)) return finish({ covered: false });

      const cover = findCover(key);
      if (!cover) return finish({ covered: false });

      if (requester.kind === "local") {
        if (cover.live && !deps.live()?.isStillLive(cover.live)) return finish({ covered: false });
        return finish({
          covered: true,
          key: cover.key,
          sourceKind: cover.sourceKind,
          dev: cover.dev,
          ino: cover.ino,
          ...(cover.birthtimeMs !== undefined ? { birthtimeMs: cover.birthtimeMs } : {}),
        });
      }

      // Remote: salted digest of pi's trust-requiring resources, under permits.
      if (!permits.tryAcquire(requester.id)) {
        const rl = limiter.allow(`permit:${requester.id}`, 0, nowMs());
        if (!rl.ok && rl.firstInWindow) {
          log(`[pi-trust-query] proof permits exhausted requester=${sanitizeForLog(requester.id)} cwd=${sanitizeForLog(key)}`);
        }
        counters.rateLimited += 1;
        reply.code(429);
        return { success: false, error: "rate_limited" };
      }
      let manifest: string | null;
      try {
        manifest = await manifestOf(key, { home });
      } finally {
        permits.release(requester.id);
      }
      if (manifest === null) return finish({ covered: false });
      // The entry may have ended while the proof was being built (YOLO expiry / end).
      if (cover.live && !deps.live()?.isStillLive(cover.live)) return finish({ covered: false });
      const salt = newTrustSalt();
      return finish({ covered: true, salt, digest: trustResourceDigest(salt, key, manifest) });
    },
  );

  return { counters: () => ({ ...counters }) };
}
