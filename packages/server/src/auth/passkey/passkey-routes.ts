/**
 * Public passkey ceremony routes under `/auth/passkey/*` + the pre-auth pages
 * `/auth/invite` and `/auth/phone` (design D5; tasks 4B.2, 4B.3).
 *
 * Registered by the OAuth plugin (it owns the JWT secret and cookie issuance);
 * the plugin's `onRequest` hook already skips `/auth/`. Authorization is the
 * ceremony itself: an invite token, a WebAuthn assertion, or a phone request's
 * approval token. Every route is inert (`404 passkeys_disabled`) unless
 * `auth.passkeys.enabled`.
 *
 * Cross-site defence: a POST carrying an `Origin` header must come from the RP
 * origin (`403 origin_mismatch`), closing login-CSRF with a self-made
 * assertion. WebAuthn's own origin binding covers the ceremony payloads.
 *
 * See change: add-passkey-user-auth.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import QRCode from "qrcode";
import { renderInvitePage, renderPhonePage } from "./passkey-pages.js";
import { PasskeyError, type PasskeyService } from "./passkey-service.js";
import { describeRequester, rateKeyOf } from "./requester.js";
import type { DirectoryUser } from "./user-directory.js";

export interface PasskeyRouteDeps {
  service: PasskeyService;
  /** Set `pi_dash_token` for a directory user (tier from the directory). */
  issueSession: (reply: FastifyReply, user: DirectoryUser) => void;
}

let webauthnBundle: string | null = null;
function loadWebauthnBundle(): string {
  if (webauthnBundle === null) {
    const entry = createRequire(import.meta.url).resolve("@simplewebauthn/browser");
    const root = path.resolve(path.dirname(entry), "..");
    webauthnBundle = fs.readFileSync(path.join(root, "dist", "bundle", "index.umd.min.js"), "utf8");
  }
  return webauthnBundle;
}

/** QR for a URL as an `<img>`-safe data URL (no markup reaches the page). */
export async function qrDataUrl(url: string): Promise<string> {
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function headerString(v: unknown): string | undefined {
  return typeof v === "string" ? v : Array.isArray(v) && typeof v[0] === "string" ? v[0] : undefined;
}

function rateKeyFor(request: FastifyRequest): string {
  return rateKeyOf({ ip: request.ip, forwardedFor: headerString(request.headers["x-forwarded-for"]) });
}

function requesterOf(request: FastifyRequest) {
  return describeRequester({
    userAgent: headerString(request.headers["user-agent"]),
    host: headerString(request.headers.host),
    ip: request.ip,
    forwardedFor: headerString(request.headers["x-forwarded-for"]),
  });
}

function sendError(reply: FastifyReply, err: unknown) {
  if (err instanceof PasskeyError) return reply.code(err.status).send({ success: false, error: err.code });
  throw err;
}

export function registerPasskeyRoutes(fastify: FastifyInstance, deps: PasskeyRouteDeps): void {
  const { service, issueSession } = deps;
  const { phone } = service;

  /** Inert unless enabled; cross-site POSTs refused. Returns false when it replied. */
  const admit = (request: FastifyRequest, reply: FastifyReply): boolean => {
    if (!service.isEnabled()) {
      reply.code(404).send({ success: false, error: "passkeys_disabled" });
      return false;
    }
    const origin = headerString(request.headers.origin);
    if (request.method === "POST" && origin && origin !== service.rpContext().rpOrigin) {
      reply.code(403).send({ success: false, error: "origin_mismatch" });
      return false;
    }
    return true;
  };
  const body = (request: FastifyRequest): Record<string, unknown> =>
    request.body && typeof request.body === "object" ? (request.body as Record<string, unknown>) : {};

  fastify.get("/auth/passkey/status", async () => {
    const rp = service.rpContext();
    return { success: true, enabled: service.isEnabled(), stable: rp.stable, rpId: rp.rpId, ...(rp.reason ? { reason: rp.reason } : {}) };
  });

  fastify.get("/auth/passkey/webauthn.js", async (_request, reply) =>
    reply.type("application/javascript; charset=utf-8").header("cache-control", "public, max-age=3600").send(loadWebauthnBundle()),
  );

  fastify.get("/auth/invite", async (_request, reply) => reply.type("text/html").header("cache-control", "no-store").send(renderInvitePage()));
  fastify.get("/auth/phone", async (_request, reply) => reply.type("text/html").header("cache-control", "no-store").send(renderPhonePage()));

  // ── Invite enrollment ────────────────────────────────────────────────────
  fastify.post("/auth/passkey/register/options", async (request, reply) => {
    if (!admit(request, reply)) return reply;
    try {
      return { success: true, ...(await service.registrationOptions(body(request).token)) };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  fastify.post("/auth/passkey/register/verify", async (request, reply) => {
    if (!admit(request, reply)) return reply;
    const b = body(request);
    try {
      const user = await service.verifyRegistration(b.challengeId, b.token, b.response);
      issueSession(reply, user);
      return { success: true, user: { name: user.name, tier: user.tier } };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // ── Passkey login (same device / OS hybrid transport) ───────────────────
  fastify.post("/auth/passkey/login/options", async (request, reply) => {
    if (!admit(request, reply)) return reply;
    try {
      return { success: true, ...(await service.authenticationOptions()) };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  fastify.post("/auth/passkey/login/verify", async (request, reply) => {
    if (!admit(request, reply)) return reply;
    const b = body(request);
    try {
      const user = await service.verifyAuthentication(b.challengeId, b.response);
      issueSession(reply, user);
      return { success: true, user: { name: user.name, tier: user.tier } };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // ── Sign in with phone (D5) ──────────────────────────────────────────────
  fastify.post("/auth/passkey/phone/start", async (request, reply) => {
    if (!admit(request, reply)) return reply;
    try {
      const rp = service.requireStable();
      const started = phone.start(requesterOf(request), rateKeyFor(request));
      if (!started) return reply.code(429).send({ success: false, error: "too_many_requests" });
      const url = `${rp.rpOrigin}/auth/phone#${started.approvalToken}`;
      return {
        success: true,
        requestId: started.requestId,
        shortCode: started.shortCode,
        expiresAt: started.expiresAt,
        qrDataUrl: await qrDataUrl(url),
      };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  fastify.get("/auth/passkey/phone/poll/:requestId", async (request, reply) => {
    if (!admit(request, reply)) return reply;
    reply.header("cache-control", "no-store");
    const result = phone.poll((request.params as { requestId?: string }).requestId);
    if (result.status !== "approved") return { success: true, status: result.status };
    const user = service.directory.get(result.sub);
    // Revoked between approval and poll ⇒ no session.
    if (!user || service.directory.sessionTier(user.id) === null) return { success: true, status: "expired" };
    issueSession(reply, user);
    return { success: true, status: "approved" };
  });

  fastify.post("/auth/passkey/phone/lookup", async (request, reply) => {
    if (!admit(request, reply)) return reply;
    const r = phone.lookupCode(body(request).code, rateKeyFor(request));
    if (!r.ok) return reply.code(r.error === "rate_limited" ? 429 : 404).send({ success: false, error: r.error });
    return { success: true, approvalToken: r.approvalToken };
  });

  fastify.post("/auth/passkey/phone/view", async (request, reply) => {
    if (!admit(request, reply)) return reply;
    const v = phone.view(body(request).token);
    if (!v) return reply.code(410).send({ success: false, error: "expired" });
    return { success: true, ...v };
  });

  fastify.post("/auth/passkey/phone/approve", async (request, reply) => {
    if (!admit(request, reply)) return reply;
    const b = body(request);
    if (!phone.view(b.token)) return reply.code(410).send({ success: false, error: "expired" });
    try {
      const user = await service.verifyAuthentication(b.challengeId, b.response, { quiet: true });
      const r = phone.approve(b.token, user.id);
      if (!r.ok) return reply.code(410).send({ success: false, error: r.error });
      return { success: true };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  fastify.post("/auth/passkey/phone/deny", async (request, reply) => {
    if (!admit(request, reply)) return reply;
    const r = phone.deny(body(request).token);
    if (!r.ok) return reply.code(410).send({ success: false, error: "expired" });
    return { success: true };
  });
}
