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
import { WebSocket, type ClientOptions } from "ws";
import {
  canonicalBinding,
  httpProofHeaders,
  httpPurpose,
  LOCAL_PROOF_HEADER,
  mintProof,
} from "@blackbelt-technology/pi-dashboard-shared/local-credential-proof.js";
import { createLocalCredentialVerifier } from "../auth/local-credential.js";
import { readLocalTokenIfPresent } from "../auth/local-token.js";

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

/**
 * Proof-based client helpers. A real caller under the strict default
 * (`requireLocalProof` true) proves local possession with a minted
 * `X-Pi-Local-Proof` header, never the deprecated raw token. Each call mints a
 * FRESH proof bound to that request's method + target (a proof is single use), so
 * these must not be hoisted into a shared header object.
 *
 * The token is read from the isolated test HOME's `~/.pi/dashboard/local/token`,
 * which the server under test created at boot. `url` must name an address
 * literal (`127.0.0.1`), never `localhost`.
 *
 * See change: close-container-loopback-impersonation (D9).
 */

/** `X-Pi-Local-Proof` header for ONE request to `url` (call per request). */
export function proofHeaders(url: string, method = "GET"): Record<string, string> {
  const token = readLocalTokenIfPresent();
  if (!token) throw new Error("proofHeaders: no local token under the test HOME — has the server under test booted?");
  return httpProofHeaders(token, url, method);
}

/** `fetch` that carries a freshly minted proof for this exact request. */
export function proofFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(proofHeaders(url, method))) headers.set(k, v);
  return fetch(url, { ...init, headers });
}

/** `ws` client whose upgrade request carries a proof (the upgrade is a `GET`). */
export function proofWebSocket(url: string, protocols?: string | string[], options: ClientOptions = {}): WebSocket {
  const target = url.replace(/^ws/, "http");
  return new WebSocket(url, protocols, { ...options, headers: { ...options.headers, ...proofHeaders(target, "GET") } });
}

/**
 * `headers` plus a fresh proof for a WS/HTTP dial of `url` — unless the headers
 * carry a forwarding header (`x-forwarded-for` / `forwarded`), which marks the
 * dial as a simulated REMOTE caller that must not be admitted by locality.
 */
export function withLocalProof(url: string, headers: Record<string, string> = {}): Record<string, string> {
  const remote = Object.keys(headers).some((k) => /^(x-forwarded-|forwarded$|via$|x-real-ip$)/i.test(k));
  return remote ? { ...headers } : { ...proofHeaders(url.replace(/^ws/, "http")), ...headers };
}

/**
 * Proof for a request whose request-target must reach the server byte-for-byte
 * (`rawTarget`, e.g. `/x/../api/y`), which the WHATWG URL parser would rewrite.
 * Binds `127.0.0.1:<port>` and `http <METHOD> <rawTarget>`.
 */
export function proofHeadersRaw(port: number, rawTarget: string, method = "GET"): Record<string, string> {
  const token = readLocalTokenIfPresent();
  if (!token) throw new Error("proofHeadersRaw: no local token under the test HOME — has the server under test booted?");
  const minted = mintProof({ token, binding: canonicalBinding("127.0.0.1", port), purpose: httpPurpose(method, rawTarget) });
  return { [LOCAL_PROOF_HEADER]: minted.header };
}
