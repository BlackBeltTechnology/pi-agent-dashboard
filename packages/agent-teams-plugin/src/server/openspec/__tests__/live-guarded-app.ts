/**
 * A REAL listening Fastify app (`listen({ port: 0 })`) mounting the dashboard server's own guard stack exactly as
 * `server.ts` orders it — credential edge stamp (real `createLocalCredentialVerifier`, bound-at floor), host
 * gate, universal network-guard hook, route-tier gate — plus the per-route `networkGuard`, so a request must
 * carry a genuine endpoint-bound local proof to pass `requireLocalProof` writes. It also builds the server's
 * REAL `host.localRequest` service pointed at that listener, so the plugin's `createLoopbackInject` can be
 * driven end to end (design D4/D8; tasks 3.3 / 5.5; test 8.28).
 * Loaded by absolute path (see `server-src.ts`). See change: add-agent-teams-openspec.
 */
import Fastify, { type FastifyInstance } from "fastify";
import type { HostLocalRequestFn } from "../inject.js";
import { loadServer } from "./server-src.js";

export const LIVE_TOKEN = "live-guarded-app-local-token";

export interface LiveGuardedApp {
  app: FastifyInstance;
  port: number;
  /** The server's real `host.localRequest` bound to this listener. */
  service: HostLocalRequestFn;
  /** Every console line written while the app lives (verifier / guard diagnostics) — to prove no proof leaks. */
  logs: string[];
  close(): Promise<void>;
}

export interface GuardDeps {
  networkGuard: unknown;
  localTrust: unknown;
}

// biome-ignore lint/suspicious/noExplicitAny: the server modules are loaded dynamically (no compile-time dependency)
type Any = any;

/** `register` mounts the routes under test; it receives the SAME per-route `networkGuard` the server hands them. */
export async function listenGuardedApp(strict: boolean, register: (app: FastifyInstance, deps: GuardDeps) => void | Promise<void>): Promise<LiveGuardedApp> {
  const [guard, tierGate, hostGate, proof, cred, lrq]: Any[] = await Promise.all([
    loadServer("auth/localhost-guard.ts"),
    loadServer("auth/route-tier-gate.ts"),
    loadServer("auth/host-gate.ts"),
    loadServer("auth/local-proof.ts"),
    loadServer("auth/local-credential.ts"),
    loadServer("plugin-local-request.ts"),
  ]);
  const logs: string[] = [];
  const log = (l: string): void => void logs.push(l);
  let boundAt = 0;
  let port = 0;
  const localTrust = proof.createLocalTrustContext(LIVE_TOKEN, () => strict, () => port);
  const verifier = cred.createLocalCredentialVerifier({ token: LIVE_TOKEN, acceptLegacyToken: false, log });
  const app = Fastify({ logger: false });
  app.addHook("onRequest", async (request) => {
    verifier.stamp(request.raw, { kind: "http", boundAt });
  });
  app.addHook(
    "onRequest",
    hostGate.createHostGate(
      () => ({ admission: { publicBaseUrls: [], allowedHosts: [], bindHost: "127.0.0.1" }, mode: "enforce", envOverridden: false }),
      new hostGate.HostGateState(),
      () => port,
    ),
  );
  app.addHook("onRequest", guard.createNetworkGuardHook({ trustedNetworks: [], localTrust, logDenial: log }));
  app.addHook("onRequest", tierGate.createRouteTierGate({ getTrustedNetworks: () => [], localTrust, logRefusal: log }));
  await register(app, { networkGuard: guard.createNetworkGuard([], { localTrust }), localTrust });
  await cred.listenWithProofFloor(app, (at: number) => (boundAt = at), { port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  port = typeof addr === "object" && addr ? addr.port : 0;
  const service = lrq.createHostLocalRequest({ getToken: () => LIVE_TOKEN, host: "127.0.0.1", getPort: () => port }) as HostLocalRequestFn;
  return { app, port, service, logs, close: () => app.close() };
}
