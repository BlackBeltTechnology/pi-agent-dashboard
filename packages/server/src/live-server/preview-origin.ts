/**
 * Preview-origin primitives shared by dispatch, CORS, the mutation-origin gate, host
 * admission and the capability store (D2, D3): label generation/shape, Host canonicalisation
 * and the ONE predicate {@link isPreviewShapedOrigin}, so callers cannot disagree on what a
 * preview origin is.
 *
 * See change: serve-live-previews-on-capability-origin (D2, D3).
 */
import crypto from "node:crypto";
import { isIP } from "node:net";
import type { ResolvedPreviewOrigins } from "@blackbelt-technology/pi-dashboard-shared/preview-origins.js";
import { getPreviewOriginsRuntime, getResolvedPreviewOrigins } from "../config-snapshot.js";

/** A preview host label: 26 base32 chars (128 random bits, D2). */
export const PREVIEW_LABEL_SHAPE = /^[a-z2-7]{26}$/;
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/** 128 random bits as 26 lowercase base32 characters. `bytes` is injectable for collision tests. */
export function generatePreviewLabel(bytes: (n: number) => Buffer = crypto.randomBytes): string {
  const buf = bytes(16);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** sha256 hex — the lookup index key for a label / pid / token (the plaintext is never a key). */
export const hashPreviewKey = (secret: string): string => crypto.createHash("sha256").update(secret).digest("hex");

/** First 8 hex of sha256 — the only identifier a log line may carry (`h=<hash8>`). */
export const previewLogHash = (secret: string): string => hashPreviewKey(secret).slice(0, 8);

const DEFAULT_PORT = { http: 80, https: 443 } as const;

/** IPv4-mapped IPv6 (`::ffff:a.b.c.d` or `::ffff:xxxx:xxxx`) → its IPv4, else unchanged. */
export function unmapIPv4(host: string): string {
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
  if (dotted) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (hex) {
    const hi = Number.parseInt(hex[1], 16);
    const lo = Number.parseInt(hex[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return host;
}

/** Lower-case, strip brackets and ONE trailing dot, unmap IPv4-mapped IPv6. */
export function normalizePreviewHostname(host: string): string {
  let h = host.trim().toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  if (h.endsWith(".")) h = h.slice(0, -1);
  return unmapIPv4(h);
}

/** `{hostname, port}` of a raw `Host` header; `port` is `undefined` when absent. `null` when malformed. */
export function splitHostHeader(hostHeader: string | undefined | null): { hostname: string; port?: number } | null {
  if (typeof hostHeader !== "string") return null;
  const v = hostHeader.trim();
  if (!v) return null;
  let host: string;
  let portText: string | undefined;
  if (v.startsWith("[")) {
    const end = v.indexOf("]");
    if (end === -1) return null;
    host = v.slice(0, end + 1);
    const rest = v.slice(end + 1);
    if (rest) {
      if (!/^:\d{1,5}$/.test(rest)) return null;
      portText = rest.slice(1);
    }
  } else {
    const first = v.indexOf(":");
    if (first === -1) host = v;
    else {
      if (v.indexOf(":", first + 1) !== -1) return null; // unbracketed IPv6: ambiguous, fail closed
      host = v.slice(0, first);
      portText = v.slice(first + 1);
      if (!/^\d{1,5}$/.test(portText)) return null;
    }
  }
  const hostname = normalizePreviewHostname(host);
  if (!hostname) return null;
  if (portText === undefined) return { hostname };
  const port = Number(portText);
  if (port < 1 || port > 65535) return null;
  return { hostname, port };
}

/** Canonical `host[:port]`, the default port of `scheme` elided (what `Entry.originHost` holds). */
export function canonicalHostOf(scheme: "http" | "https", hostHeader: string | undefined | null): string | null {
  const p = splitHostHeader(hostHeader);
  if (!p) return null;
  const host = p.hostname.includes(":") ? `[${p.hostname}]` : p.hostname;
  return p.port === undefined || p.port === DEFAULT_PORT[scheme] ? host : `${host}:${p.port}`;
}

/** `host[:port]` split of a canonical origin host (`originHost`). */
export function splitCanonicalHost(canonical: string): { hostname: string; port: number | undefined } {
  const p = splitHostHeader(canonical);
  return p ? { hostname: p.hostname, port: p.port } : { hostname: canonical, port: undefined };
}

/** Injectable inputs of the predicate; the defaults read the live config snapshot. */
export interface PreviewShapeDeps {
  resolved?: ResolvedPreviewOrigins;
  /** `classifyAdmittedHostname` bound to the live admission options (static-row exemption, non-IP names only). */
  classify?: (hostname: string) => string | null;
}

const IP_DASHED = /^\d{1,3}-\d{1,3}-\d{1,3}-\d{1,3}$/;

/**
 * Is `scheme://host[:port]` a preview origin (D3)?
 *  (a) an IP literal whose effective port is in the RESOLVED pool — evaluated first, never exempted
 *      by a static admission row (`classifyAdmittedHostname` admits every IP literal);
 *  (b) a non-IP name `<26-base32>.` + `localhost` | `<wildcard.suffix>` | `<a-b-c-d>.<ipDnsSuffix>` that no
 *      static admission row admits.
 * `.localhost` label hosts and every valid configured suffix / pool stay preview-shaped when
 * `enabled:false` (previewApp answers 403, so the dashboard never serves them).
 */
export function isPreviewShapedOrigin(
  scheme: "http" | "https",
  host: string,
  port?: number,
  deps: PreviewShapeDeps = {},
): boolean {
  const hostname = normalizePreviewHostname(host);
  if (!hostname) return false;
  const resolved = deps.resolved ?? getResolvedPreviewOrigins();
  if (isIP(hostname) !== 0) {
    const pool = resolved.pool;
    if (!pool) return false;
    const effective = port ?? DEFAULT_PORT[scheme];
    return effective >= pool.from && effective <= pool.to;
  }
  const dot = hostname.indexOf(".");
  if (dot <= 0) return false;
  if (!PREVIEW_LABEL_SHAPE.test(hostname.slice(0, dot))) return false;
  const rest = hostname.slice(dot + 1);
  let shaped = rest === "localhost";
  if (!shaped && resolved.wildcard && rest === resolved.wildcard.suffix) shaped = true;
  if (!shaped && resolved.ipDnsSuffix && rest.endsWith(`.${resolved.ipDnsSuffix}`)) {
    shaped = IP_DASHED.test(rest.slice(0, -(resolved.ipDnsSuffix.length + 1)));
  }
  if (!shaped) return false;
  const classify = deps.classify ?? getPreviewOriginsRuntime().classifyAdmittedHostname;
  try {
    return !(classify?.(hostname) ?? null);
  } catch {
    return true; // a throwing classifier must not route a label host to the dashboard
  }
}

/** {@link isPreviewShapedOrigin} for a raw `Host` header (scheme from the socket, never a forwarded header). */
export function isPreviewShapedHost(scheme: "http" | "https", hostHeader: string | undefined | null, deps?: PreviewShapeDeps): boolean {
  const p = splitHostHeader(hostHeader);
  return p ? isPreviewShapedOrigin(scheme, p.hostname, p.port, deps) : false;
}

/** {@link isPreviewShapedOrigin} for an `Origin` value (`scheme://host[:port]`). Non-http(s) / malformed → false. */
export function isPreviewShapedOriginUrl(origin: string | undefined | null, deps?: PreviewShapeDeps): boolean {
  if (typeof origin !== "string" || !origin) return false;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const scheme = u.protocol === "https:" ? "https" : "http";
  return isPreviewShapedOrigin(scheme, u.hostname, u.port ? Number(u.port) : undefined, deps);
}
