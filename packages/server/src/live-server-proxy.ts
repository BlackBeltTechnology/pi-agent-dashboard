/**
 * Reverse proxy for live-server-preview targets, on the MAIN origin at
 * `/live/:id/*` (mirrors `editor-proxy`'s `/editor/:id/*`). Same-origin path
 * proxy so it survives the single-port remote tunnel (zrok). The client frames
 * it with `sandbox="allow-scripts"` and NO `allow-same-origin` (opaque origin,
 * D7), so the embedded app cannot read the dashboard token or call its APIs.
 *
 * The proxy ONLY forwards to targets the manager already validated as loopback
 * (SSRF gate lives in `validateLiveTarget`); an unregistered id → 404.
 *
 * See change: improve-content-editor (live-server-preview §6).
 */
import net from "node:net";
import type { FastifyInstance } from "fastify";
import type { LiveServerManager } from "./live-server-manager.js";

/** localhost/::1 resolve to 127.0.0.1 for the upstream TCP connect. */
function upstreamHost(host: string): string {
  return host === "::1" ? "::1" : "127.0.0.1";
}

export function registerLiveServerProxy(fastify: FastifyInstance, manager: LiveServerManager) {
  // Register the `@fastify/reply-from` proxy plugin. live-server-proxy is now
  // the SOLE consumer of the `from` decorator — the editor proxy that used to
  // provide it was deleted in change: remove-external-editor-integration, which
  // orphaned this call and produced `reply.from is not a function` on
  // `/live/:id/*`. Owning the dependency here keeps the proxy self-contained.
  // See change: improve-content-editor, fix-live-server-proxy-reply-from.
  fastify.register(import("@fastify/reply-from"));

  function resolve(url: string) {
    const match = url.match(/^\/live\/([^/?]+)(.*)$/);
    if (!match) return null;
    const target = manager.get(match[1]);
    if (!target) return null;
    const rest = match[2] || "";
    const subPath = rest.startsWith("?") ? `/${rest}` : rest.startsWith("/") ? rest : "/";
    return { target, subPath };
  }

  const forward = (request: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => {
    const resolved = resolve(request.url);
    if (!resolved) {
      return reply.code(404).send({ error: "live-server target not found" });
    }
    const { target, subPath } = resolved;
    const prefix = `/live/${target.id}`;
    const host = upstreamHost(target.host);
    reply.from(`http://${host}:${target.port}${subPath}`, {
      rewriteRequestHeaders: (_req, headers) => {
        headers.host = `${host}:${target.port}`;
        return headers;
      },
      rewriteHeaders: (headers) => {
        const location = headers.location;
        if (typeof location === "string") {
          if (location.startsWith("./")) headers.location = `${prefix}/${location.slice(2)}`;
          else if (location.startsWith("/")) headers.location = `${prefix}${location}`;
          else {
            // Rewrite an absolute redirect back to the SAME upstream
            // (`http://127.0.0.1:<port>/…`) into the proxied prefix so the
            // browser stays on the dashboard origin and the single-port tunnel
            // keeps working. Foreign absolute redirects are left untouched.
            try {
              const u = new URL(location);
              if (u.hostname === host && u.port === String(target.port)) {
                headers.location = `${prefix}${u.pathname}${u.search}`;
              }
            } catch {
              /* not an absolute URL — leave as-is */
            }
          }
        }
        return headers;
      },
    });
  };

  fastify.all("/live/:id/*", forward);
  fastify.all("/live/:id", forward);
}

/** WebSocket upgrade forwarding (HMR / dev-server sockets). */
export function handleLiveServerUpgrade(
  manager: LiveServerManager,
  request: import("node:http").IncomingMessage,
  socket: import("node:stream").Duplex,
  head: Buffer,
) {
  const match = request.url?.match(/^\/live\/([^/?]+)(.*)$/);
  if (!match) {
    socket.destroy();
    return;
  }
  const target = manager.get(match[1]);
  if (!target) {
    socket.destroy();
    return;
  }
  const rest = match[2] || "";
  const subPath = rest.startsWith("?") ? `/${rest}` : rest.startsWith("/") ? rest : "/";
  const host = upstreamHost(target.host);

  const upstream = net.connect(target.port, host, () => {
    // Clear the connect-phase timeout once the socket is established; the pipe
    // below owns the socket lifetime thereafter.
    upstream.setTimeout(0);
    const headers = Object.entries(request.headers)
      .filter(([k]) => !["host", "origin"].includes(k.toLowerCase()))
      .map(([k, v]) => `${k}: ${v}`)
      .join("\r\n");
    upstream.write(
      `${request.method} ${subPath} HTTP/1.1\r\n` +
        `Host: ${host}:${target.port}\r\n` +
        `${headers}\r\n\r\n`,
    );
    if (head.length > 0) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  // Bound the connect/upgrade handshake: a target that accepts TCP but never
  // completes the upgrade must not leak an idle socket pair forever.
  upstream.setTimeout(10_000, () => upstream.destroy());
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
  socket.on("close", () => upstream.destroy());
  upstream.on("close", () => socket.destroy());
}
