/**
 * `GET /plugin-assets/:id/:sha/*` — the content-addressed, immutable asset prefix of runtime plugin
 * clients (design D13). Serves ONLY admitted `(id, sha256)` pairs: the registry re-evaluates the
 * plugin per request (stat-cached content hash, no full rehash), so changed bytes are never served
 * under an old immutable URL (X5) and a revoked / refused / re-pinned plugin answers 404.
 *
 * Realpath-confined (`confined-static.ts`), `PLUGIN_ASSET_MIME` allowlist (no `.json`, `.map`,
 * `.html`), `.gz` negotiation. No per-app CSP: the host's baseline CSP `onSend` hook stamps the
 * response. Outside the network guard's jurisdiction and with NO auth skip: it answers exactly like
 * the host's own `/assets/*` (design Open Question 3, verified Phase 5B).
 *
 * See change: decouple-plugins-from-core (task 6.10, design D13).
 */
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { PLUGIN_ASSET_MIME, parseSegments, pickVariant } from "./confined-static.js";
import type { RuntimeClientRegistry } from "./runtime-client-registry.js";

export const PLUGIN_ASSETS_PREFIX = "/plugin-assets";
export const PLUGIN_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";

const SHA256 = /^[0-9a-f]{64}$/;

/** `(id, sha, remainder)` of `/plugin-assets/<id>/<sha>/<rest…>` straight from the raw pathname; `null` = malformed. */
function splitTarget(rawUrl: string): { id: string; sha: string; rest: string } | null {
  const pathname = rawUrl.split(/[?#]/, 1)[0];
  if (!pathname.startsWith(`${PLUGIN_ASSETS_PREFIX}/`)) return null;
  const [id, sha, ...tail] = pathname.slice(PLUGIN_ASSETS_PREFIX.length + 1).split("/");
  if (!id || !sha || !SHA256.test(sha) || !/^[A-Za-z0-9._-]+$/.test(id)) return null;
  return { id, sha, rest: tail.join("/") };
}

function notFound(reply: FastifyReply): FastifyReply {
  return reply
    .code(404)
    .header("Content-Type", "text/plain; charset=utf-8")
    .header("Cache-Control", "no-store")
    .header("X-Content-Type-Options", "nosniff")
    .send("Not found");
}

export interface PluginAssetsRouteDeps {
  /** The live registry; `undefined` before boot wiring (→ everything 404). */
  getRegistry(): Pick<RuntimeClientRegistry, "getAdmittedAssetRoot"> | undefined;
}

function handle(deps: PluginAssetsRouteDeps, request: FastifyRequest, reply: FastifyReply): FastifyReply {
  const target = splitTarget(request.url);
  if (!target) return notFound(reply);
  // Decoded segments, refused on `..`, dotfiles, `\`, NUL and any extension outside the allowlist; `rest` is
  // wrapped so `parseSegments` sees a prefixed path. An empty remainder (no file) is refused too.
  const segments = parseSegments(`/_/${target.rest}`, "/_", PLUGIN_ASSET_MIME);
  if (!segments || segments.length === 0) return notFound(reply);
  const root = deps.getRegistry()?.getAdmittedAssetRoot(target.id, target.sha);
  if (!root) return notFound(reply);

  const file = path.join(root, ...segments);
  const type = PLUGIN_ASSET_MIME[path.extname(file).toLowerCase()];
  const variant = type ? pickVariant(file, root, request.headers["accept-encoding"]) : null;
  if (!type || !variant) return notFound(reply);

  if (variant.hasVariant) {
    const vary = reply.getHeader("vary");
    reply.header("Vary", vary ? `${String(vary)}, Accept-Encoding` : "Accept-Encoding");
  }
  if (variant.gzipped) reply.header("Content-Encoding", "gzip");
  return reply
    .code(200)
    .header("Content-Type", type)
    .header("Content-Length", variant.file.size)
    .header("Cache-Control", PLUGIN_ASSET_CACHE_CONTROL)
    .header("X-Content-Type-Options", "nosniff")
    .send(fs.createReadStream(variant.file.real));
}

/** Register the route on the root instance (GET; HEAD is exposed by Fastify). */
export function registerPluginAssetsRoute(fastify: FastifyInstance, deps: PluginAssetsRouteDeps): void {
  fastify.get(`${PLUGIN_ASSETS_PREFIX}/:id/:sha/*`, (request, reply) => handle(deps, request, reply));
}
