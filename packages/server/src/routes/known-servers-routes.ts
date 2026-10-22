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
 * A server is its identity: an entry holds `routes[]` (addresses at which it
 * answers) and the `host`/`port` mirror of its primary route. An add that
 * proves a fingerprint attaches its route to the entry holding it (D1, D6).
 * Every challenge toward an operator-supplied host is bounded: http/https only,
 * no redirects, 2 s, 4 KiB response cap, normal TLS verification (D2).
 *
 * See change: stabilize-mdns-server-identity (D6, D7), group-servers-by-identity (D1, D2, D6, D10).
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
  KnownServerProbeRequest,
  KnownServerProbeResult,
  RemoveKnownServerRequest,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { knownServersNeedMigration, loadConfig, toStoredKnownServers } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { formatHostPort, isValidHost, normalizeHostKey } from "@blackbelt-technology/pi-dashboard-shared/host-port.js";
import { type ProveResult, proveServerIdentity } from "@blackbelt-technology/pi-dashboard-shared/server-pinning.js";
import {
  findAttachTarget,
  primaryRoute,
  ROUTE_SCHEMES,
  type Route,
  type RouteScheme,
  routeKey,
} from "@blackbelt-technology/pi-dashboard-shared/server-routes.js";
import type { HostAdmissionOptions } from "../auth/host-admission.js";
import type { LocalTrustContext } from "../auth/local-proof.js";
import { writeConfigPartial } from "../config-api.js";
import type { KnownServerMoves } from "../known-server-moves.js";
import { createOperatorGuard } from "./pairing-routes.js";

/** Bounds of the add-time / move identity challenge. */
const CHALLENGE_TIMEOUT_MS = 2000;
/**
 * Probe budgets: DNS and HTTP are separate so a slow negative `.local` lookup is not a "timeout".
 * DNS gets 6 s: measured negative `.local` answers take ~4 s in the Docker harness and
 * ~5 s via mDNSResponder, so a 3 s budget would label every dead `.local` name "timeout".
 */
const PROBE_DNS_TIMEOUT_MS = 6000;
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
  /** Identity-challenge seam (default: {@link proveServerIdentity} over `fetchImpl`, 2 s). */
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
/** `sha256:` + the first 16 characters: enough to correlate, never the whole fingerprint (D10). */
const shortFp = (fingerprint: string) => `sha256:${short(fingerprint)}`;
/** `scheme://host:port` of a route, with the host in its normalised spelling. */
const routeUrl = (r: Pick<Route, "host" | "port" | "scheme">) =>
  // Literal scheme: only the two allowlisted values ever reach the request URL.
  `${r.scheme === "https" ? "https" : "http"}://${formatHostPort(r.host, r.port)}`;
const holdsRoute = (e: KnownServer, r: Route) => e.routes.some((x) => routeKey(x) === routeKey(r));
/** Body `scheme`: absent → `http`; anything but `http` / `https` → null (`400 invalid_scheme`). */
const parseScheme = (input: unknown): RouteScheme | null =>
  input === undefined ? "http" : ROUTE_SCHEMES.includes(input as RouteScheme) ? (input as RouteScheme) : null;

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
  const proveRaw =
    deps.prove ??
    ((baseUrl: string) => proveServerIdentity(baseUrl, { timeoutMs: challengeMs, ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}) }));
  /** Bounded identity challenge over the route's own scheme: a hanging target cannot hold the request. */
  const prove = (host: string, port: number, scheme: RouteScheme): Promise<ProveResult> =>
    withTimeout(proveRaw(routeUrl({ host, port, scheme })), challengeMs, () => ({
      refused: "challenge timed out",
    }));
  const provedFingerprint = (r: ProveResult): string | undefined => ("proven" in r ? r.proven : undefined);

  const readList = (): KnownServer[] => loadConfig().knownServers.map((e) => ({ ...e, routes: e.routes.map((r) => ({ ...r })) }));
  /** The one write: always routes shape plus the `host`/`port` mirror; logs once for the first rewrite of a previous-shape file. */
  const writeList = (list: KnownServer[]): { success: boolean; error?: string } => {
    const migrating = list.length > 0 && knownServersNeedMigration();
    const result = writeConfigPartial({ knownServers: toStoredKnownServers(list) });
    if (result.success && migrating) log(`[known-servers] first written in routes shape (${list.length} entries)`);
    return result;
  };

  /**
   * `list[idx]` just proved (or newly holds) its fingerprint: fold every other entry that holds the
   * same identity on the same instance (D1 rule) into it — it keeps its routes first, then gains
   * the other's, keeps its label else takes the other's.
   */
  /**
   * One instance = a shared `http` route port, or one side has no `http` route at all (its https routes join the
   * holder, D1). Two entries on different `http` ports stay two rows even though an https route could attach to either.
   */
  function sameInstance(a: KnownServer, b: KnownServer): boolean {
    const ports = (e: KnownServer) => new Set(e.routes.filter((r) => r.scheme === "http").map((r) => r.port));
    const pa = ports(a);
    const pb = ports(b);
    return pa.size === 0 || pb.size === 0 || [...pa].some((p) => pb.has(p));
  }

  function foldDuplicates(list: KnownServer[], idx: number): void {
    const survivor = list[idx];
    if (!survivor.fingerprint) return;
    for (let j = list.length - 1; j >= 0; j--) {
      if (j === idx) continue;
      const other = list[j];
      if (other.fingerprint !== survivor.fingerprint || !sameInstance(survivor, other)) continue;
      const keys = new Set(survivor.routes.map(routeKey));
      for (const r of other.routes) if (!keys.has(routeKey(r))) survivor.routes.push(r);
      if (!survivor.label && other.label) survivor.label = other.label;
      list.splice(j, 1);
      if (j < idx) idx -= 1;
      log(`[known-servers] merged duplicate identity: folded ${other.host}:${other.port} into ${survivor.host}:${survivor.port}`);
    }
  }

  // ── List ─────────────────────────────────────────────────────────────
  fastify.get("/api/known-servers", { preHandler: networkGuard }, async (request) => {
    const data: KnownServerListEntry[] = readList().map((entry) => {
      const movedTo = moves?.suggestionFor(entry);
      return movedTo ? { ...entry, movedTo } : entry;
    });
    return { success: true, data, canManage: await isOperator(request) };
  });

  // ── Add / attach ─────────────────────────────────────────────────────
  fastify.post<{ Body: AddKnownServerRequest }>(
    "/api/known-servers",
    { preHandler: mutationGuard },
    async (request, reply): Promise<ApiResponse<{ updated?: boolean }> & Record<string, unknown>> => {
      const { host, port } = request.body ?? ({} as AddKnownServerRequest);
      const label = typeof request.body?.label === "string" ? request.body.label.trim() : "";
      if (!host || typeof host !== "string" || !Number.isInteger(port) || port < 1 || port > 65535) {
        return { success: false, error: "host and port are required" };
      }
      // Before ANY request: the scheme allowlist (the route is challenged over its own scheme) ...
      const scheme = parseScheme((request.body as { scheme?: unknown }).scheme);
      if (!scheme) return fail(reply, 400, "invalid_scheme");
      // ... and the host charset: the host is placed in an outbound URL (identity challenge), so admit only
      // DNS-name / IP-literal characters; no URL-authority trick (`@`, `/`, `#`, `?`) can redirect the request.
      if (!/^[A-Za-z0-9._:[\]-]+$/.test(host) || !isValidHost(host)) return fail(reply, 400, "invalid_host");
      const candidate: Route = { host, port, scheme, source: "saved" };
      // Snapshot BEFORE the challenge: an entry that held the route then but is gone when the
      // write runs was deleted meanwhile and must not be recreated.
      const heldBefore = readList().some((e) => holdsRoute(e, candidate));
      // `fingerprint` in the body is a hint only and is never persisted unless proven.
      const proven = provedFingerprint(await prove(host, port, scheme));

      return enqueueKnownServersWrite((): ApiResponse<{ updated?: boolean }> & Record<string, unknown> => {
        const list = readList();
        const idx = list.findIndex((e) => holdsRoute(e, candidate));
        if (heldBefore && idx < 0) return fail(reply, 409, "entry_removed");

        if (idx >= 0) {
          // A route already stored: refresh the label, pin when newly proven, fold a duplicate identity into it.
          const target = list[idx];
          if (target.fingerprint && proven && proven !== target.fingerprint) {
            log(`[known-servers] route refused: different identity at ${routeUrl(candidate)} expected=${shortFp(target.fingerprint)} proven=${shortFp(proven)}`);
            reply.code(409);
            return { success: false, error: "identity_changed", expected: target.fingerprint, proven };
          }
          if (label) target.label = label;
          if (proven && !target.fingerprint) {
            target.fingerprint = proven;
            foldDuplicates(list, idx);
          }
          return persist(list, reply, false);
        }

        // A new route: it joins the entry that holds the proven identity (D1), else starts an entry.
        const at = findAttachTarget(list, candidate, proven);
        if (at >= 0 && proven) {
          list[at].routes.push(candidate);
          if (label) list[at].label = label;
          const result = persist(list, reply, true);
          if (result.success) log(`[known-servers] route attached fp=${shortFp(proven)} ${routeUrl(candidate)}`);
          return result;
        }
        list.push({
          host,
          port,
          ...(label ? { label } : {}),
          addedAt: new Date().toISOString(),
          ...(proven ? { fingerprint: proven } : {}),
          routes: [candidate],
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
  // `{host, port, scheme?}` removes that route (and the entry with its last route);
  // `{fingerprint}` removes every entry holding that identity. Idempotent.
  fastify.delete<{ Body: RemoveKnownServerRequest }>(
    "/api/known-servers",
    { preHandler: mutationGuard },
    async (request, reply): Promise<ApiResponse> => {
      const body = (request.body ?? {}) as { host?: unknown; port?: unknown; scheme?: unknown; fingerprint?: unknown };
      if (typeof body.fingerprint === "string" && body.fingerprint) {
        const fingerprint = body.fingerprint;
        return enqueueKnownServersWrite(() => {
          const list = readList();
          const kept = list.filter((e) => e.fingerprint !== fingerprint);
          return kept.length === list.length ? { success: true as const } : persist(kept, reply, false);
        });
      }
      const { host, port } = body;
      if (!host || typeof host !== "string" || typeof port !== "number") {
        return { success: false, error: "host and port are required" };
      }
      // No scheme names the address whatever its scheme (a pre-routes client sends none).
      const scheme = body.scheme === undefined ? undefined : parseScheme(body.scheme);
      if (scheme === null) return fail(reply, 400, "invalid_scheme");
      return enqueueKnownServersWrite(() => {
        const list = readList();
        let changed = false;
        const kept: KnownServer[] = [];
        for (const e of list) {
          const routes = e.routes.filter((r) => !(sameAddress(r, { host, port }) && (scheme === undefined || r.scheme === scheme)));
          if (routes.length !== e.routes.length) changed = true;
          if (routes.length > 0) kept.push({ ...e, routes });
        }
        return changed ? persist(kept, reply, false) : { success: true as const };
      });
    },
  );

  // ── Accept a verified move suggestion ────────────────────────────────
  fastify.post<{ Body: AcceptKnownServerMoveRequest }>(
    "/api/known-servers/accept-move",
    { preHandler: mutationGuard },
    async (request, reply): Promise<ApiResponse> => {
      const { host, port } = request.body ?? ({} as AcceptKnownServerMoveRequest);
      if (!host || typeof port !== "number") return fail(reply, 400, "host and port are required");
      // `host`/`port` name the entry's primary route (the mirror); only that route moves.
      const entry = readList().find((e) => sameAddress(e, { host, port }));
      const suggestion = entry && moves?.suggestionFor(entry);
      if (!entry?.fingerprint || !suggestion) return fail(reply, 409, "no_suggestion");
      const fingerprint = entry.fingerprint;
      const primary = primaryRoute(entry.routes);
      if (!primary) return fail(reply, 409, "no_suggestion");

      // Re-verify BOTH halves before touching config: the stored primary route in its own scheme,
      // the suggested (mDNS, always http) address over http.
      if (provedFingerprint(await prove(primary.host, primary.port, primary.scheme)) === fingerprint) {
        moves?.withdraw(entry, "stored address answers again");
        return fail(reply, 409, "stale_suggestion");
      }
      if (provedFingerprint(await prove(suggestion.host, suggestion.port, "http")) !== fingerprint) {
        return fail(reply, 409, "stale_suggestion");
      }

      return enqueueKnownServersWrite((): ApiResponse => {
        const list = readList();
        const idx = list.findIndex((e) => sameAddress(e, entry) && e.fingerprint === fingerprint);
        if (idx < 0) return fail(reply, 409, "entry_removed");
        const current = primaryRoute(list[idx].routes);
        if (!current) return fail(reply, 409, "entry_removed");
        const moved: Route = { host: suggestion.host, port: suggestion.port, scheme: "http", source: current.source };
        // Only the primary route changes; a route that already holds the new address is not duplicated.
        const seen = new Set<string>();
        list[idx].routes = list[idx].routes
          .map((r) => (r === current ? moved : r))
          .filter((r) => {
            const key = routeKey(r);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
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

  /** Reachability of one stored route, over the route's own scheme (normal TLS verification, no redirects). */
  async function probeOnce(host: string, port: number, scheme: RouteScheme): Promise<KnownServerProbeResult> {
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
      const res = await doFetch(`${routeUrl({ host, port, scheme })}/api/health`, {
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

  /** Pin the identity a reachable route proved on its still-unpinned entry (folding a duplicate holder into it). */
  async function backfill(route: Route, proven: string): Promise<void> {
    await enqueueKnownServersWrite(() => {
      const list = readList();
      const idx = list.findIndex((e) => holdsRoute(e, route));
      if (idx < 0 || list[idx].fingerprint) return; // removed meanwhile (never recreated), or pinned meanwhile
      list[idx].fingerprint = proven;
      foldDuplicates(list, idx);
      const result = writeList(list);
      if (!result.success) log(`[known-servers] backfill write failed: ${result.error ?? "unknown"}`);
    });
  }

  fastify.post<{ Body: KnownServerProbeRequest }>(
    "/api/known-servers/probe",
    { preHandler: mutationGuard },
    async (request, reply): Promise<ApiResponse<KnownServerProbeResult>> => {
      const { host, port } = request.body ?? ({} as KnownServerProbeRequest);
      if (typeof host !== "string" || typeof port !== "number") return fail(reply, 400, "host and port are required");
      const scheme = parseScheme((request.body as { scheme?: unknown }).scheme);
      if (!scheme) return fail(reply, 400, "invalid_scheme");
      // SSRF guard: only a route that is still stored is ever contacted, in the stored spelling.
      const route = readList()
        .flatMap((e) => e.routes)
        .find((r) => r.scheme === scheme && sameAddress(r, { host, port }));
      if (!route) return fail(reply, 403, "not_a_known_server");

      const key = routeKey(route);
      let pending = probesInFlight.get(key);
      if (!pending) {
        pending = (async (): Promise<KnownServerProbeResult> => {
          const result = await probeOnce(route.host, route.port, route.scheme);
          if (result.status !== "reachable") return { ...result, scheme: route.scheme };
          const proven = provedFingerprint(await prove(route.host, route.port, route.scheme));
          if (!proven) return { ...result, scheme: route.scheme };
          log(`[known-servers] probe proved fp=${shortFp(proven)} ${routeUrl(route)}`);
          await backfill(route, proven).catch(() => {});
          return { ...result, scheme: route.scheme, fingerprint: proven };
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
