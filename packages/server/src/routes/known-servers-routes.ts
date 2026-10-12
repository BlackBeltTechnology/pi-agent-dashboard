/**
 * REST routes for known servers management and network discovery.
 *
 * Mutations (add / remove / accept-move) and the reachability probe are
 * OPERATOR-only (login, local proof, local token, genuinely-local request):
 * network trust alone and paired-device bearers are refused. GET stays on the
 * network guard and reports `canManage`.
 *
 * Every known-server write goes through ONE module-level serialized queue
 * ({@link enqueueKnownServersWrite}); identity challenges and probes run
 * BEFORE enqueueing (a hanging target must never block unrelated writes) and
 * each write re-reads config, re-validates, and aborts if its target entry has
 * since been removed.
 *
 * See change: stabilize-mdns-server-identity (D6, D7).
 */
import dns from "node:dns";
import net from "node:net";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { NetworkGuard } from "./route-deps.js";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { KnownServer } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { DiscoveredServer } from "@blackbelt-technology/pi-dashboard-shared/mdns-discovery.js";
import type {
  AcceptKnownServerMoveRequest,
  AddKnownServerRequest,
  DiscoveredServerInfo,
  KnownServerListEntry,
  KnownServerProbeResult,
  RemoveKnownServerRequest,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { formatHostPort, normalizeHostKey } from "@blackbelt-technology/pi-dashboard-shared/host-port.js";
import { type ProveResult, proveServerIdentity } from "@blackbelt-technology/pi-dashboard-shared/server-pinning.js";
import type { HostAdmissionOptions } from "../auth/host-admission.js";
import type { LocalTrustContext } from "../auth/local-proof.js";
import { writeConfigPartial } from "../config-api.js";
import type { KnownServerMoves } from "../known-server-moves.js";
import { createOperatorGuard } from "./pairing-routes.js";

/** Bounds of the add-time / move identity challenge. */
const CHALLENGE_TIMEOUT_MS = 2000;
/** Probe budgets: DNS and HTTP are separate so a slow negative `.local` lookup is not a "timeout". */
const PROBE_DNS_TIMEOUT_MS = 3000;
const PROBE_HTTP_TIMEOUT_MS = 2000;

let writeChain: Promise<unknown> = Promise.resolve();

/** The single serialized queue for known-server config writes. */
function enqueueKnownServersWrite<T>(fn: () => T | Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => undefined);
  return run;
}

export interface KnownServersRouteDeps {
  networkGuard: NetworkGuard;
  getPeerServers: () => Map<string, DiscoveredServer>;
  /** `X-Pi-Local-Token` expected value, when configured. */
  localToken?: string;
  localTrust?: LocalTrustContext;
  hostAdmission: () => HostAdmissionOptions;
  /** Identity-challenge seam (default: {@link proveServerIdentity}, 2 s). */
  prove?: (baseUrl: string) => Promise<ProveResult>;
  /** Name-resolution seam for the probe. */
  lookup?: (host: string) => Promise<unknown>;
  fetchImpl?: typeof fetch;
  moves?: KnownServerMoves;
  log?: (message: string) => void;
  /** Budget overrides (tests shrink them; production uses the defaults). */
  timeouts?: { challengeMs?: number; dnsMs?: number; httpMs?: number };
}

const sameAddress = (a: { host: string; port: number }, b: { host: string; port: number }) =>
  a.port === b.port && normalizeHostKey(a.host) === normalizeHostKey(b.host);

const short = (fingerprint: string) => fingerprint.replace(/^sha256:/, "").slice(0, 16);

/** Reject after `ms`, clearing its timer when the race settles. */
function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => resolve(onTimeout()), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export function registerKnownServersRoutes(fastify: FastifyInstance, deps: KnownServersRouteDeps) {
  const { networkGuard, getPeerServers, moves } = deps;
  const log = deps.log ?? ((m: string) => console.log(m));
  const operatorGuard = createOperatorGuard({
    localToken: deps.localToken,
    hostAdmission: deps.hostAdmission,
    localTrust: deps.localTrust,
  });
  const mutationGuard = [networkGuard, operatorGuard];

  /** Side-effect-free evaluation of the operator guard (same predicate as the mutations). */
  async function isOperator(request: FastifyRequest): Promise<boolean> {
    let denied = false;
    const stub = {
      code: () => stub,
      send: () => {
        denied = true;
        return stub;
      },
    };
    await operatorGuard(request, stub as unknown as FastifyReply);
    return !denied;
  }

  const challengeMs = deps.timeouts?.challengeMs ?? CHALLENGE_TIMEOUT_MS;
  const dnsMs = deps.timeouts?.dnsMs ?? PROBE_DNS_TIMEOUT_MS;
  const httpMs = deps.timeouts?.httpMs ?? PROBE_HTTP_TIMEOUT_MS;
  const proveRaw = deps.prove ?? ((baseUrl: string) => proveServerIdentity(baseUrl, { timeoutMs: challengeMs }));
  /** Bounded identity challenge: a hanging target cannot hold the request. */
  const prove = (host: string, port: number): Promise<ProveResult> =>
    withTimeout(proveRaw(`http://${formatHostPort(host, port)}`), challengeMs, () => ({
      refused: "challenge timed out",
    }));
  const provedFingerprint = (r: ProveResult): string | undefined => ("proven" in r ? r.proven : undefined);

  const readList = (): KnownServer[] => loadConfig().knownServers.map((e) => ({ ...e }));
  const writeList = (list: KnownServer[]): { success: boolean; error?: string } =>
    writeConfigPartial({ knownServers: list });

  // ── List ─────────────────────────────────────────────────────────────
  fastify.get("/api/known-servers", { preHandler: networkGuard }, async (request) => {
    const data: KnownServerListEntry[] = readList().map((entry) => {
      const movedTo = moves?.suggestionFor(entry);
      return movedTo ? { ...entry, movedTo } : entry;
    });
    return { success: true, data, canManage: await isOperator(request) };
  });

  // ── Add / update ─────────────────────────────────────────────────────
  fastify.post<{ Body: AddKnownServerRequest }>(
    "/api/known-servers",
    { preHandler: mutationGuard },
    async (request, reply): Promise<ApiResponse<{ updated?: boolean }> & Record<string, unknown>> => {
      const { host, port } = request.body ?? ({} as AddKnownServerRequest);
      const label = typeof request.body?.label === "string" ? request.body.label.trim() : "";
      if (!host || typeof host !== "string" || !Number.isInteger(port) || port < 1 || port > 65535) {
        return { success: false, error: "host and port are required" };
      }
      // Snapshot BEFORE the challenge: an entry that existed then but is gone when the
      // write runs was deleted meanwhile and must not be recreated.
      const snapshot = readList();
      // `fingerprint` in the body is a hint only and is never persisted unless proven.
      const proven = provedFingerprint(await prove(host, port));

      // The holder of (proven, port) at ANOTHER address, and whether it still answers.
      const target0 = snapshot.find((e) => sameAddress(e, { host, port }));
      const holder0 = proven
        ? snapshot.find((e) => e.fingerprint === proven && e.port === port && !sameAddress(e, { host, port }))
        : undefined;
      const holderStillProves = holder0 && !target0 ? provedFingerprint(await prove(holder0.host, holder0.port)) === proven : false;

      return enqueueKnownServersWrite((): ApiResponse<{ updated?: boolean }> & Record<string, unknown> => {
        const list = readList();
        const idx = list.findIndex((e) => sameAddress(e, { host, port }));
        if (target0 && idx < 0) return fail(reply, 409, "entry_removed");
        const target = idx >= 0 ? list[idx] : undefined;

        if (target?.fingerprint && proven && proven !== target.fingerprint) {
          reply.code(409);
          return { success: false, error: "identity_changed", expected: target.fingerprint, proven };
        }

        const holderIdx = proven
          ? list.findIndex((e) => e.fingerprint === proven && e.port === port && !sameAddress(e, { host, port }))
          : -1;

        if (target) {
          // Existing address: refresh label, pin when newly proven, merge a duplicate identity into it.
          if (label) target.label = label;
          if (proven && !target.fingerprint) {
            target.fingerprint = proven;
            if (holderIdx >= 0) {
              const dropped = list.splice(holderIdx, 1)[0];
              if (!target.label && dropped.label) target.label = dropped.label;
              log(`[known-servers] merged duplicate identity: dropped ${dropped.host}:${dropped.port}`);
            }
          }
          return persist(list, reply, false);
        }

        if (holderIdx >= 0) {
          if (holderStillProves) {
            reply.code(409);
            return { success: false, error: "already_known", host: list[holderIdx].host, port: list[holderIdx].port };
          }
          // The holder's stored address no longer proves the identity: move it here.
          list[holderIdx] = { ...list[holderIdx], host, ...(label ? { label } : {}) };
          return persist(list, reply, true);
        }

        list.push({
          host,
          port,
          ...(label ? { label } : {}),
          addedAt: new Date().toISOString(),
          ...(proven ? { fingerprint: proven } : {}),
        });
        return persist(list, reply, false);
      });
    },
  );

  function fail(reply: FastifyReply, status: number, error: string) {
    reply.code(status);
    return { success: false as const, error };
  }

  function persist(list: KnownServer[], reply: FastifyReply, updated: boolean) {
    const result = writeList(list);
    if (!result.success) return fail(reply, 500, result.error ?? "write failed");
    return updated ? { success: true as const, data: { updated: true } } : { success: true as const };
  }

  // ── Remove ───────────────────────────────────────────────────────────
  fastify.delete<{ Body: RemoveKnownServerRequest }>(
    "/api/known-servers",
    { preHandler: mutationGuard },
    async (request, reply): Promise<ApiResponse> => {
      const { host, port } = request.body ?? ({} as RemoveKnownServerRequest);
      if (!host || typeof port !== "number") {
        return { success: false, error: "host and port are required" };
      }
      return enqueueKnownServersWrite(() =>
        persist(
          readList().filter((s) => !sameAddress(s, { host, port })),
          reply,
          false,
        ),
      );
    },
  );

  // ── Accept a verified move suggestion ────────────────────────────────
  fastify.post<{ Body: AcceptKnownServerMoveRequest }>(
    "/api/known-servers/accept-move",
    { preHandler: mutationGuard },
    async (request, reply): Promise<ApiResponse> => {
      const { host, port } = request.body ?? ({} as AcceptKnownServerMoveRequest);
      if (!host || typeof port !== "number") return fail(reply, 400, "host and port are required");
      const entry = readList().find((e) => sameAddress(e, { host, port }));
      const suggestion = entry && moves?.suggestionFor(entry);
      if (!entry?.fingerprint || !suggestion) return fail(reply, 409, "no_suggestion");
      const fingerprint = entry.fingerprint;

      // Re-verify BOTH halves before touching config.
      if (provedFingerprint(await prove(entry.host, entry.port)) === fingerprint) {
        moves?.withdraw(entry, "stored address answers again");
        return fail(reply, 409, "stale_suggestion");
      }
      if (provedFingerprint(await prove(suggestion.host, suggestion.port)) !== fingerprint) {
        return fail(reply, 409, "stale_suggestion");
      }

      return enqueueKnownServersWrite((): ApiResponse => {
        const list = readList();
        const idx = list.findIndex((e) => sameAddress(e, entry) && e.fingerprint === fingerprint);
        if (idx < 0) return fail(reply, 409, "entry_removed");
        list[idx] = { ...list[idx], host: suggestion.host, port: suggestion.port };
        const result = persist(list, reply, false);
        if (result.success) {
          moves?.withdraw(entry, "accepted");
          log(`[known-servers] moved fp=${short(fingerprint)} ${entry.host}:${entry.port} -> ${suggestion.host}:${suggestion.port}`);
        }
        return result;
      });
    },
  );

  // ── Operator probe of a persisted entry ──────────────────────────────
  const probesInFlight = new Map<string, Promise<KnownServerProbeResult>>();
  const lookup = deps.lookup ?? ((h: string) => dns.promises.lookup(h));
  const doFetch = deps.fetchImpl ?? fetch;

  async function probeOnce(host: string, port: number): Promise<KnownServerProbeResult> {
    const key = normalizeHostKey(host);
    if (!net.isIP(key)) {
      try {
        const outcome = await withTimeout(lookup(key).then(() => "ok" as const), dnsMs, () => "timeout" as const);
        if (outcome === "timeout") return { status: "timeout" };
      } catch (err) {
        const code = (err as { code?: string })?.code;
        if (code === "ENOTFOUND" || code === "EAI_NONAME") return { status: "name-not-resolved" };
        if (code === "EAI_AGAIN") return { status: "timeout" };
        return { status: "error" };
      }
    }
    try {
      const res = await doFetch(`http://${formatHostPort(host, port)}/api/health`, {
        redirect: "manual",
        signal: AbortSignal.timeout(httpMs),
      });
      if (res.status !== 200) return { status: "error" };
      const body = (await res.json().catch(() => undefined)) as { ok?: unknown } | undefined;
      return { status: body?.ok === true ? "reachable" : "error" };
    } catch (err) {
      const e = err as { name?: string; cause?: { code?: string } };
      if (e?.name === "AbortError" || e?.name === "TimeoutError") return { status: "timeout" };
      if (e?.cause?.code === "ECONNREFUSED") return { status: "refused" };
      return { status: "error" };
    }
  }

  /** Pin the identity of an unpinned reachable entry (merging a duplicate holder). */
  async function backfill(entry: KnownServer): Promise<void> {
    if (entry.fingerprint) return;
    const proven = provedFingerprint(await prove(entry.host, entry.port));
    if (!proven) return;
    await enqueueKnownServersWrite(() => {
      const list = readList();
      const idx = list.findIndex((e) => sameAddress(e, entry));
      if (idx < 0 || list[idx].fingerprint) return;
      list[idx].fingerprint = proven;
      const dup = list.findIndex((e, i) => i !== idx && e.fingerprint === proven && e.port === entry.port);
      if (dup >= 0) {
        const dropped = list.splice(dup, 1)[0];
        if (!list.find((e) => e.fingerprint === proven)?.label && dropped.label) {
          list[list.findIndex((e) => e.fingerprint === proven)].label = dropped.label;
        }
        log(`[known-servers] backfill merged duplicate identity: dropped ${dropped.host}:${dropped.port}`);
      }
      writeList(list);
    });
  }

  fastify.post<{ Body: { host?: string; port?: number } }>(
    "/api/known-servers/probe",
    { preHandler: mutationGuard },
    async (request, reply): Promise<ApiResponse<KnownServerProbeResult>> => {
      const { host, port } = request.body ?? {};
      if (typeof host !== "string" || typeof port !== "number") return fail(reply, 400, "host and port are required");
      const entry = readList().find((e) => sameAddress(e, { host, port }));
      if (!entry) return fail(reply, 403, "not_a_known_server");

      const key = `${normalizeHostKey(entry.host)}:${entry.port}`;
      let pending = probesInFlight.get(key);
      if (!pending) {
        pending = (async () => {
          const result = await probeOnce(entry.host, entry.port);
          if (result.status === "reachable") await backfill(entry).catch(() => {});
          return result;
        })().finally(() => probesInFlight.delete(key));
        probesInFlight.set(key, pending);
      }
      return { success: true, data: await pending };
    },
  );

  // ── On-demand network discovery ──────────────────────────────────────
  fastify.post(
    "/api/discover-servers",
    { preHandler: networkGuard },
    async (): Promise<ApiResponse<DiscoveredServerInfo[]>> => {
      const peers = getPeerServers();
      const data: DiscoveredServerInfo[] = Array.from(peers.values()).map((s) => ({
        host: s.host,
        port: s.port,
        piPort: s.piPort,
        version: s.version,
        pid: s.pid,
        isLocal: s.isLocal,
        ...(s.fingerprint ? { fingerprint: s.fingerprint } : {}),
        ...(s.name ? { name: s.name } : {}),
      }));
      return { success: true, data };
    },
  );
}
