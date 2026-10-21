/**
 * The reserved `/__pi/csp-report` endpoint under a capability prefix: the sink the
 * restricted-preview CSP's `report-uri` / `report-to` point at.
 *
 * Capability-required (the proxy only dispatches a VALID capability here), `POST`
 * only, both report media types, 64 KiB (413 above), rate limited per token (429,
 * see `live-egress.ts`). Only `blocked-uri` is read, and the result is a `runtime`
 * entry the page itself could have forged — never project-grantable. Nothing from
 * the body (it carries the capability in `document-uri`) is logged.
 *
 * See change: improve-canvas-html-and-url-ux (design D6, task 2.8).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { LiveCapabilityGrant } from "./live-capability.js";
import { CSP_REPORT_SUBPATH } from "./live-csp.js";
import { CSP_REPORT_MAX_BYTES, type PreviewEgress } from "./live-egress.js";
import { type LiveLogSink, liveLog } from "./live-log.js";

const REPORT_TYPES = ["application/csp-report", "application/reports+json"] as const;

/** Parse the two report media types as JSON (an unparseable body becomes `null`, never a throw). Idempotent. */
export function registerCspReportParsers(fastify: FastifyInstance): void {
  for (const type of REPORT_TYPES) {
    if (fastify.hasContentTypeParser(type)) continue;
    fastify.addContentTypeParser(type, { parseAs: "buffer", bodyLimit: CSP_REPORT_MAX_BYTES }, (_req, body, done) => {
      try {
        done(null, JSON.parse((body as Buffer).toString("utf8")));
      } catch {
        done(null, null);
      }
    });
  }
}

const notFound = (reply: FastifyReply) => reply.code(404).send({ error: "live-server target not found" });

export interface CspReportHandlerDeps {
  egress: PreviewEgress;
  /** The dashboard's own origin as this request reached it (reports of it are not egress). */
  ownOriginsOf?: (request: FastifyRequest) => readonly string[];
  log?: LiveLogSink;
}

/** The proxy's `reservedHandler`: serves `/__pi/csp-report`, answers 404 for the rest of `/__pi/*`. */
export function createReservedHandler(deps: CspReportHandlerDeps) {
  return (request: FastifyRequest, reply: FastifyReply, ctx: { grant: LiveCapabilityGrant; subPath: string }) => {
    const q = ctx.subPath.search(/[?#]/);
    const pathname = q >= 0 ? ctx.subPath.slice(0, q) : ctx.subPath;
    if (pathname !== CSP_REPORT_SUBPATH) return notFound(reply);
    if (request.method !== "POST") return reply.code(405).header("allow", "POST").send({ error: "method not allowed" });
    const declared = Number(request.headers["content-length"]);
    if (Number.isFinite(declared) && declared > CSP_REPORT_MAX_BYTES) {
      liveLog(deps.log, "csp-report refused", { reason: "too-large", tokenId: ctx.grant.tokenId });
      return reply.code(413).send({ error: "report too large" });
    }
    const outcome = deps.egress.report(ctx.grant, request.body, deps.ownOriginsOf?.(request));
    if (outcome === "rate-limited") {
      liveLog(deps.log, "csp-report refused", { reason: "rate-limited", tokenId: ctx.grant.tokenId });
      return reply.code(429).send({ error: "too many reports" });
    }
    return reply.code(204).send();
  };
}
