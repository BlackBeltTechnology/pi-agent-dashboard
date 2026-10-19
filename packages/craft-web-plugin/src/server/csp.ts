/**
 * Per-request CSP of the `/apps/craft-<app>/` mounts and the forwarded-aware public origin it names.
 *
 * `'self'` is useless for an opaque-origin sandboxed frame (it matches nothing), so `script-src` and
 * `connect-src` name the ABSOLUTE mount base. Because the base includes the mount path, `connect-src`
 * also excludes `/api/*`. Fastify runs without `trustProxy` (it would rewrite `request.ip`), so the
 * origin is derived from the forwarded headers here, validated token by token before it is put into a
 * header value.
 *
 * See change: edit-office-in-pane-with-craft-web (D3).
 */
import type { IncomingHttpHeaders } from "node:http";
import { mountId } from "./apps.js";

const HOST_RE = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;

const first = (value: string | string[] | undefined): string | undefined => {
  const raw = Array.isArray(value) ? value[0] : value;
  const token = raw?.split(",", 1)[0]?.trim();
  return token ? token : undefined;
};

/**
 * `<proto>://<host>` as the browser sees it: `X-Forwarded-Host`/`-Proto` (zrok, tunnels, reverse
 * proxies) win over `Host` and `http`. Throws on a host that is not a plain `host[:port]`.
 */
export function publicOrigin(headers: IncomingHttpHeaders): string {
  const host = first(headers["x-forwarded-host"]) ?? first(headers.host);
  if (!host || !HOST_RE.test(host)) throw new Error("request carries no usable host");
  const forwardedProto = first(headers["x-forwarded-proto"])?.toLowerCase();
  const proto = forwardedProto === "https" || forwardedProto === "http" ? forwardedProto : "http";
  return `${proto}://${host}`;
}

/** Absolute mount base `<origin>/apps/craft-<app>/`. */
const mountBase = (origin: string, app: string): string => `${origin}/apps/${mountId(app)}/`;

/** The enforced policy of one response. */
export function buildCsp(origin: string, app: string): string {
  const base = mountBase(origin, app);
  return [
    "default-src 'none'",
    `script-src ${base} 'wasm-unsafe-eval'`,
    "style-src 'unsafe-inline'",
    "img-src blob: data:",
    "font-src blob: data:",
    "worker-src blob:",
    `connect-src ${base} blob:`,
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'self'",
  ].join("; ");
}
