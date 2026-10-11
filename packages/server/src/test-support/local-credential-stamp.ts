/**
 * Test helpers that stand in for the listener edge: they stamp the local
 * credential verdict (legacy raw `X-Pi-Local-Token` accepted) on a request's
 * headers, exactly as `server.ts`'s `onRequest` hook / `upgrade` handler do.
 *
 * Production code reads the verdict via `hasLocalCredential(headers)`; an
 * unstamped request counts as having no credential, so a test that exercises an
 * exemption site with a bare header object must stamp it first.
 *
 * See change: loopback-credential-proof (D4).
 */
import type { FastifyInstance } from "fastify";
import { createLocalCredentialVerifier } from "../auth/local-credential.js";

const verifierFor = (token: string) =>
  createLocalCredentialVerifier({ token, acceptLegacyToken: true, log: () => {} });

/** Register the edge stamp as an `onRequest` hook (call before any other hook). */
export function stampLegacyHook(app: FastifyInstance, token: string): void {
  const v = verifierFor(token);
  app.addHook("onRequest", async (request) => {
    v.stamp(request.raw, { kind: "http", boundAt: 0 });
  });
}

/** Stamp a bare headers object in place (legacy raw token accepted) and return it. */
export function stampedHeaders<T extends Record<string, unknown>>(headers: T, token: string): T {
  verifierFor(token).stamp({ headers, socket: {} }, { kind: "http", boundAt: 0 });
  return headers;
}
